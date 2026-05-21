import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import "../mocks/supabase";
import { renderWithProviders } from "../utils/renderWithProviders";
import { EditUserDialog } from "@/components/EditUserDialog";

vi.mock("@/services/userService", () => ({
  updateOrgMember: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/avatarService", () => ({
  uploadUserAvatar: vi.fn().mockResolvedValue("https://example.com/avatar.jpg"),
  removeUserAvatar: vi.fn().mockResolvedValue(undefined),
}));

const ORG_ID = "org-1";
const onClose = vi.fn();

const fakeMember = {
  id: "user-1",
  email: "jean@example.com",
  first_name: "Jean",
  last_name: "Dupont",
  role: "gestionnaire" as const,
  is_active: true,
  membership_id: "mem-1",
  membership_active: true,
  avatar_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EditUserDialog", () => {
  it("affiche le titre 'Modifier l'utilisateur' quand un membre est fourni", () => {
    renderWithProviders(
      <EditUserDialog member={fakeMember} organizationId={ORG_ID} onClose={onClose} />
    );
    expect(screen.getByText("Modifier l'utilisateur")).toBeInTheDocument();
  });

  it("ne rend pas le contenu si member est null", () => {
    renderWithProviders(
      <EditUserDialog member={null} organizationId={ORG_ID} onClose={onClose} />
    );
    expect(screen.queryByText("Modifier l'utilisateur")).not.toBeInTheDocument();
  });

  it("pré-remplit le formulaire avec les données du membre", () => {
    renderWithProviders(
      <EditUserDialog member={fakeMember} organizationId={ORG_ID} onClose={onClose} />
    );
    expect(screen.getByDisplayValue("Jean")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Dupont")).toBeInTheDocument();
  });

  it("bloque la soumission si le prénom est vidé", async () => {
    const { updateOrgMember } = await import("@/services/userService");
    renderWithProviders(
      <EditUserDialog member={fakeMember} organizationId={ORG_ID} onClose={onClose} />
    );

    const firstNameInput = screen.getByDisplayValue("Jean");
    fireEvent.change(firstNameInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(() => {
      expect(updateOrgMember).not.toHaveBeenCalled();
    });
  });

  it("bloque la soumission si le nom est vidé", async () => {
    const { updateOrgMember } = await import("@/services/userService");
    renderWithProviders(
      <EditUserDialog member={fakeMember} organizationId={ORG_ID} onClose={onClose} />
    );

    const lastNameInput = screen.getByDisplayValue("Dupont");
    fireEvent.change(lastNameInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(() => {
      expect(updateOrgMember).not.toHaveBeenCalled();
    });
  });

  it("appelle updateOrgMember avec les bons arguments à la soumission", async () => {
    const { updateOrgMember } = await import("@/services/userService");
    renderWithProviders(
      <EditUserDialog member={fakeMember} organizationId={ORG_ID} onClose={onClose} />
    );

    fireEvent.change(screen.getByDisplayValue("Jean"), { target: { value: "Pierre" } });
    fireEvent.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(() => {
      expect(updateOrgMember).toHaveBeenCalledWith(
        ORG_ID,
        "user-1",
        "mem-1",
        expect.objectContaining({ first_name: "Pierre", last_name: "Dupont" })
      );
    });
  });

  it("ferme le dialog après une soumission réussie", async () => {
    renderWithProviders(
      <EditUserDialog member={fakeMember} organizationId={ORG_ID} onClose={onClose} />
    );

    fireEvent.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("affiche le bouton 'Ajouter une photo' si pas d'avatar", () => {
    renderWithProviders(
      <EditUserDialog member={fakeMember} organizationId={ORG_ID} onClose={onClose} />
    );
    expect(screen.getByText(/ajouter une photo/i)).toBeInTheDocument();
  });

  it("affiche 'Remplacer la photo' et 'Supprimer' si avatar présent", () => {
    const memberWithAvatar = { ...fakeMember, avatar_url: "https://example.com/avatar.jpg" };
    renderWithProviders(
      <EditUserDialog member={memberWithAvatar} organizationId={ORG_ID} onClose={onClose} />
    );
    expect(screen.getByText(/remplacer la photo/i)).toBeInTheDocument();
    expect(screen.getByText(/supprimer/i)).toBeInTheDocument();
  });
});
