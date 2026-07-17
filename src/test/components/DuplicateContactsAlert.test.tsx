import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import "../mocks/supabase";
import { renderWithProviders } from "../utils/renderWithProviders";
import DuplicateContactsAlert from "@/components/contacts/DuplicateContactsAlert";
import { findPotentialDuplicates } from "@/services/socleContactService";
import type { ContactDraft } from "@/lib/contact-duplicates";

vi.mock("@/services/socleContactService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/socleContactService")>()),
  findPotentialDuplicates: vi.fn(),
}));

const mockFind = vi.mocked(findPotentialDuplicates);
const ORG_ID = "org-1";

const existing = {
  id: "c1",
  contact_type: "personne",
  display_name: "Dupont Jean",
  email: "jean.dupont@example.fr",
  mobile_phone: "06 12 34 56 78",
} as Awaited<ReturnType<typeof findPotentialDuplicates>>[number]["contact"];

const draft: ContactDraft = { first_name: "Jean", last_name: "Dupond", email: "jean.dupont@example.fr" };

function renderAlert(props: Partial<React.ComponentProps<typeof DuplicateContactsAlert>> = {}) {
  return renderWithProviders(
    <DuplicateContactsAlert organizationId={ORG_ID} draft={draft} onSelect={vi.fn()} {...props} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFind.mockResolvedValue([{ contact: existing, reasons: ["email", "name_similar"], score: 137 }]);
});

describe("DuplicateContactsAlert", () => {
  it("propose le doublon détecté avec ses motifs", async () => {
    renderAlert();

    expect(await screen.findByText("Dupont Jean")).toBeInTheDocument();
    expect(screen.getByText("Même email")).toBeInTheDocument();
    expect(screen.getByText("Nom très proche")).toBeInTheDocument();
    expect(screen.getByText("jean.dupont@example.fr")).toBeInTheDocument();
  });

  it("reste invisible tant qu'aucun doublon ne ressort", async () => {
    mockFind.mockResolvedValue([]);
    const { container } = renderAlert();

    await waitFor(() => expect(mockFind).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("n'interroge pas le référentiel sur une saisie sans signal", async () => {
    renderAlert({ draft: {} });

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("remonte la fiche choisie à l'appelant", async () => {
    const onSelect = vi.fn();
    renderAlert({ onSelect });

    fireEvent.click(await screen.findByRole("button", { name: "Sélectionner" }));

    expect(onSelect).toHaveBeenCalledWith(existing);
  });

  it("permet d'écarter une proposition sans quitter la saisie", async () => {
    renderAlert();

    fireEvent.click(await screen.findByRole("button", { name: /Ignorer/ }));

    await waitFor(() => expect(screen.queryByText("Dupont Jean")).not.toBeInTheDocument());
  });

  it("laisse l'appelant nommer l'action proposée", async () => {
    renderAlert({ selectLabel: "Associer" });

    expect(await screen.findByRole("button", { name: "Associer" })).toBeInTheDocument();
  });

  it("transmet les fiches à exclure et la limite au service", async () => {
    renderAlert({ excludeIds: ["c9"], limit: 2 });

    await waitFor(() =>
      expect(mockFind).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ last_name: "Dupond" }), {
        excludeIds: ["c9"],
        limit: 2,
      }),
    );
  });
});
