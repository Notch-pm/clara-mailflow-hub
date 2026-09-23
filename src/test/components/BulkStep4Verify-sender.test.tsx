import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import "../mocks/supabase";
import { renderWithProviders } from "../utils/renderWithProviders";
import BulkStep4Verify from "@/components/courier/bulk/BulkStep4Verify";
import {
  emptyDraft,
  linkedSenderContact,
  refreshFlags,
  type DraftCourier,
} from "@/components/courier/bulk/types";
import { matchSender, type SocleContact } from "@/services/socleContactService";

vi.mock("@/services/socleContactService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/socleContactService")>()),
  matchSender: vi.fn(),
}));

vi.mock("@/contexts/OrganizationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/OrganizationContext")>()),
  useOrganization: () => ({ organizationId: "org-1" }),
}));

const mockMatch = vi.mocked(matchSender);

const madeleine = {
  id: "c-madeleine",
  contact_type: "personne",
  first_name: "Madeleine",
  last_name: "Lefevre",
  display_name: "Lefevre Madeleine",
  email: "m.lefevre@example.fr",
  mobile_phone: null,
  landline_phone: null,
} as unknown as SocleContact;

function draft(over: Partial<DraftCourier> = {}): DraftCourier {
  return refreshFlags([{ ...emptyDraft(), serviceId: "s1", serviceName: "Cabinet", ...over }])[0];
}

let latest: DraftCourier[] = [];

function Harness({ initial }: { initial: DraftCourier[] }) {
  const [drafts, setDrafts] = useState(initial);
  latest = drafts;
  return (
    <BulkStep4Verify
      drafts={drafts}
      files={[]}
      services={[]}
      orgTags={[]}
      onChange={setDrafts}
      onPreview={vi.fn()}
      onFileReject={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brouillon d'import en masse — expéditeur", () => {
  it("rattache un contact reconnu, crée sinon, et exige la civilité pour créer", () => {
    const matched = draft({
      senderLastName: "Lefevre",
      senderMatch: { status: "matched", contact: madeleine, reasons: ["name_exact"], conflicts: [] },
    });
    expect(linkedSenderContact(matched)?.id).toBe("c-madeleine");
    expect(matched.flags).not.toContain("missing-civility");

    const unknown = draft({ senderLastName: "Inconnue", senderMatch: { status: "none", contact: null, reasons: [], conflicts: [] } });
    expect(linkedSenderContact(unknown)).toBeNull();
    expect(unknown.flags).toContain("missing-civility");
    expect(draft({ ...unknown, senderCivility: "madame" }).flags).not.toContain("missing-civility");
  });

  it("un nom proche n'est rattaché qu'après confirmation de l'agent", () => {
    const suggested = draft({
      senderCivility: "madame",
      senderLastName: "Lefevre",
      senderMatch: { status: "suggested", contact: madeleine, reasons: ["name_similar"], conflicts: [] },
    });
    expect(linkedSenderContact(suggested)).toBeNull();
    expect(linkedSenderContact({ ...suggested, senderDecision: "use" })?.id).toBe("c-madeleine");
  });

  it("écarter le contact reconnu fait créer une nouvelle fiche", () => {
    const d = draft({
      senderLastName: "Lefevre",
      senderMatch: { status: "matched", contact: madeleine, reasons: ["name_exact"], conflicts: ["email"] },
      senderDecision: "create",
    });
    expect(linkedSenderContact(d)).toBeNull();
    expect(d.flags).toContain("missing-civility");
  });
});

describe("BulkStep4Verify — expéditeur", () => {
  it("présente prénom et nom dans deux champs distincts", () => {
    renderWithProviders(<Harness initial={[draft({ senderFirstName: "Madeleine", senderLastName: "Lefevre" })]} />);
    expect(screen.getByLabelText("Prénom de l'expéditeur")).toHaveValue("Madeleine");
    expect(screen.getByLabelText("Nom de l'expéditeur")).toHaveValue("Lefevre");
    expect(screen.getByLabelText("Téléphone de l'expéditeur")).toBeInTheDocument();
  });

  it("relance le rapprochement après saisie et affiche l'alerte de divergence", async () => {
    mockMatch.mockResolvedValue({
      status: "matched",
      contact: madeleine,
      reasons: ["name_exact"],
      conflicts: ["email"],
    });
    renderWithProviders(<Harness initial={[draft()]} />);

    fireEvent.change(screen.getByLabelText("Prénom de l'expéditeur"), { target: { value: "Madeleine" } });
    const last = screen.getByLabelText("Nom de l'expéditeur");
    fireEvent.change(last, { target: { value: "Lefevre" } });
    fireEvent.blur(last);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("email différent de la fiche"));
    expect(mockMatch).toHaveBeenCalledWith("org-1", expect.objectContaining({ first_name: "Madeleine", last_name: "Lefevre" }));

    fireEvent.click(screen.getByText("Créer plutôt un nouveau contact"));
    expect(latest[0].senderDecision).toBe("create");
    expect(screen.getByText("Civilité requise pour créer le contact")).toBeInTheDocument();
  });

  it("annonce la création quand le référentiel ne connaît pas l'expéditeur", async () => {
    mockMatch.mockResolvedValue({ status: "none", contact: null, reasons: [], conflicts: [] });
    renderWithProviders(<Harness initial={[draft()]} />);
    const last = screen.getByLabelText("Nom de l'expéditeur");
    fireEvent.change(last, { target: { value: "Inconnue" } });
    fireEvent.blur(last);
    await waitFor(() => expect(screen.getByText("Sera créé dans le référentiel")).toBeInTheDocument());
  });
});
