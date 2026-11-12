import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";
import { renderWithProviders } from "../utils/renderWithProviders";
import Login from "@/pages/Login";
import { SILENT_SSO_KEY } from "@/lib/sso";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Par défaut, la tentative silencieuse a déjà eu lieu dans cet onglet.
  window.sessionStorage.clear();
  window.sessionStorage.setItem(SILENT_SSO_KEY, "done");
});

/** Le mot de passe est en secours : on déplie « Autre méthode de connexion ». */
function renderWithPassword() {
  renderWithProviders(<Login />);
  fireEvent.click(screen.getByRole("button", { name: "Autre méthode de connexion" }));
}

describe("Login", () => {
  describe("mode connexion", () => {
    it("le mot de passe est replié derrière « Autre méthode de connexion »", () => {
      renderWithProviders(<Login />);
      expect(screen.queryByLabelText(/mot de passe/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /compte de ma collectivité/i })).toBeInTheDocument();
    });

    it("affiche le titre Clara et le bouton Se connecter", () => {
      renderWithPassword();
      expect(screen.getByText("Clara")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^se connecter$/i })).toBeInTheDocument();
    });

    it("affiche les champs email et mot de passe", () => {
      renderWithPassword();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/mot de passe/i)).toBeInTheDocument();
    });

    it("appelle signInWithPassword avec les bonnes valeurs", async () => {
      mockSupabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
      renderWithPassword();

      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "agent@mairie.fr" },
      });
      fireEvent.change(screen.getByLabelText(/mot de passe/i), {
        target: { value: "secret123" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^se connecter$/i }));

      await waitFor(() => {
        expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
          email: "agent@mairie.fr",
          password: "secret123",
        });
      });
    });

    it("affiche un message d'erreur si les identifiants sont invalides", async () => {
      mockSupabase.auth.signInWithPassword.mockResolvedValue({
        data: {},
        error: { message: "Invalid login credentials" },
      });
      renderWithPassword();

      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "agent@mairie.fr" },
      });
      fireEvent.change(screen.getByLabelText(/mot de passe/i), {
        target: { value: "mauvais" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^se connecter$/i }));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.objectContaining({
            description: "Email ou mot de passe incorrect.",
            variant: "destructive",
          })
        );
      });
    });

    it("affiche le lien 'Mot de passe oublié ?'", () => {
      renderWithPassword();
      expect(screen.getByText(/mot de passe oublié/i)).toBeInTheDocument();
    });
  });

  describe("mode mot de passe oublié", () => {
    it("bascule en mode forgot au clic sur 'Mot de passe oublié ?'", () => {
      renderWithPassword();
      fireEvent.click(screen.getByText(/mot de passe oublié/i));
      expect(screen.getByRole("button", { name: /envoyer le lien/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/mot de passe/i)).not.toBeInTheDocument();
    });

    it("appelle resetPasswordForEmail avec le bon email", async () => {
      mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
      renderWithPassword();

      fireEvent.click(screen.getByText(/mot de passe oublié/i));
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "agent@mairie.fr" },
      });
      fireEvent.click(screen.getByRole("button", { name: /envoyer le lien/i }));

      await waitFor(() => {
        expect(mockSupabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
          "agent@mairie.fr",
          expect.objectContaining({ redirectTo: expect.stringContaining("/reset-password") })
        );
      });
    });

    it("revient en mode login après envoi réussi", async () => {
      mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
      renderWithPassword();

      fireEvent.click(screen.getByText(/mot de passe oublié/i));
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "agent@mairie.fr" },
      });
      fireEvent.click(screen.getByRole("button", { name: /envoyer le lien/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^se connecter$/i })).toBeInTheDocument();
      });
    });

    it("revient en mode login au clic sur 'Retour à la connexion'", () => {
      renderWithPassword();
      fireEvent.click(screen.getByText(/mot de passe oublié/i));
      fireEvent.click(screen.getByText(/retour à la connexion/i));
      expect(screen.getByRole("button", { name: /^se connecter$/i })).toBeInTheDocument();
    });
  });

  describe("connexion avec le compte de la collectivité (Keycloak, lot 4)", () => {
    it("le bouton part vers Keycloak avec le scope openid et revient sur /connexion", async () => {
      renderWithProviders(<Login />);
      fireEvent.click(screen.getByRole("button", { name: /compte de ma collectivité/i }));
      await waitFor(() => {
        expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
          provider: "keycloak",
          options: { scopes: "openid", redirectTo: `${window.location.origin}/connexion` },
        });
      });
      expect(mockSupabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it("au retour d'un agent non provisionné : message clair, et l'URL est nettoyée", () => {
      window.history.replaceState(
        null,
        "",
        "/connexion?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance",
      );
      renderWithProviders(<Login />);
      expect(screen.getByRole("alert").textContent).toMatch(/n'a pas accès à Clara/);
      expect(window.location.search).toBe("");
      window.history.replaceState(null, "", "/");
    });

    it("si le départ vers Keycloak échoue, on le dit et on propose le mot de passe", async () => {
      mockSupabase.auth.signInWithOAuth.mockResolvedValueOnce({ data: {}, error: { message: "provider is not enabled" } });
      renderWithProviders(<Login />);
      fireEvent.click(screen.getByRole("button", { name: /compte de ma collectivité/i }));
      expect((await screen.findByRole("alert")).textContent).toMatch(/mot de passe/);
    });

    it("absent du mode « mot de passe oublié »", () => {
      renderWithPassword();
      fireEvent.click(screen.getByText(/mot de passe oublié/i));
      expect(screen.queryByRole("button", { name: /compte de ma collectivité/i })).not.toBeInTheDocument();
    });
  });
});


describe("Login — connexion silencieuse (session Keycloak d'une autre application)", () => {
  it("première arrivée de l'onglet : demande à Keycloak sans écran (prompt=none)", async () => {
    window.sessionStorage.clear();
    renderWithProviders(<Login />);
    expect(screen.getByText("Connexion…")).toBeInTheDocument();
    await waitFor(() => expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "keycloak",
        options: expect.objectContaining({ queryParams: { prompt: "none" } }),
      }),
    );
    expect(window.sessionStorage.getItem(SILENT_SSO_KEY)).toBe("pending");
  });

  it("retour sans session Keycloak : la page s'affiche, sans message d'erreur", () => {
    window.sessionStorage.setItem(SILENT_SSO_KEY, "pending");
    window.history.replaceState(null, "", "/connexion#error=login_required");
    renderWithProviders(<Login />);
    expect(screen.getByRole("button", { name: /compte de ma collectivité/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockSupabase.auth.signInWithOAuth).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SILENT_SSO_KEY)).toBe("done");
    window.history.replaceState(null, "", "/");
  });
});
