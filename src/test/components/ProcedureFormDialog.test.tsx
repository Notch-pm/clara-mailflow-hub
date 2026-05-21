import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import "../mocks/supabase";
import { renderWithProviders } from "../utils/renderWithProviders";
import { ProcedureFormDialog } from "@/components/ProcedureFormDialog";

vi.mock("@/services/procedureService", () => ({
  createProcedure: vi.fn().mockResolvedValue({ id: "p-1", name: "Test" }),
  updateProcedure: vi.fn().mockResolvedValue({ id: "p-1", name: "Test modifié" }),
}));

const ORG_ID = "org-1";
const onOpenChange = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProcedureFormDialog", () => {
  it("affiche le titre 'Nouvelle démarche' en mode création", () => {
    renderWithProviders(
      <ProcedureFormDialog open={true} onOpenChange={onOpenChange} orgId={ORG_ID} procedure={null} />
    );
    expect(screen.getByText("Nouvelle démarche")).toBeInTheDocument();
  });

  it("affiche le titre 'Modifier la démarche' en mode édition", () => {
    const procedure = { id: "p-1", name: "Passeport", description: null, color: "#0acf83", icon: null, is_displayed: true, external_source: null, created_at: "", updated_at: "", organization_id: ORG_ID, created_by: null };
    renderWithProviders(
      <ProcedureFormDialog open={true} onOpenChange={onOpenChange} orgId={ORG_ID} procedure={procedure} />
    );
    expect(screen.getByText("Modifier la démarche")).toBeInTheDocument();
  });

  it("bloque la soumission si le champ nom est vide", async () => {
    const { createProcedure } = await import("@/services/procedureService");
    renderWithProviders(
      <ProcedureFormDialog open={true} onOpenChange={onOpenChange} orgId={ORG_ID} procedure={null} />
    );

    fireEvent.click(screen.getByRole("button", { name: /enregistrer/i }));
    await waitFor(() => {
      expect(createProcedure).not.toHaveBeenCalled();
    });
  });

  it("appelle createProcedure avec le bon nom à la soumission", async () => {
    const { createProcedure } = await import("@/services/procedureService");
    renderWithProviders(
      <ProcedureFormDialog open={true} onOpenChange={onOpenChange} orgId={ORG_ID} procedure={null} />
    );

    fireEvent.change(screen.getByLabelText(/nom/i), { target: { value: "Carte d'identité" } });
    fireEvent.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(() => {
      expect(createProcedure).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ name: "Carte d'identité" })
      );
    });
  });

  it("ferme le dialog au clic sur Annuler", () => {
    renderWithProviders(
      <ProcedureFormDialog open={true} onOpenChange={onOpenChange} orgId={ORG_ID} procedure={null} />
    );
    fireEvent.click(screen.getByRole("button", { name: /annuler/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
