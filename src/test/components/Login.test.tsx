import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";
import { renderWithProviders } from "../utils/renderWithProviders";
import Login from "@/pages/Login";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Login", () => {
  describe("mode connexion", () => {
    it("affiche le titre Clara et le bouton Se connecter", () => {
      renderWithProviders(<Login />);
      expect(screen.getByText("Clara")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /se connecter/i })).toBeInTheDocument();
    });

    it("affiche les champs email et mot de passe", () => {
      renderWithProviders(<Login />);
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/mot de passe/i)).toBeInTheDocument();
    });

    it("appelle signInWithPassword avec les bonnes valeurs", async () => {
      mockSupabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
      renderWithProviders(<Login />);

      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "agent@mairie.fr" },
      });
      fireEvent.change(screen.getByLabelText(/mot de passe/i), {
        target: { value: "secret123" },
      });
      fireEvent.click(screen.getByRole("button", { name: /se connecter/i }));

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
      renderWithProviders(<Login />);

      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "agent@mairie.fr" },
      });
      fireEvent.change(screen.getByLabelText(/mot de passe/i), {
        target: { value: "mauvais" },
      });
      fireEvent.click(screen.getByRole("button", { name: /se connecter/i }));

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
      renderWithProviders(<Login />);
      expect(screen.getByText(/mot de passe oublié/i)).toBeInTheDocument();
    });
  });

  describe("mode mot de passe oublié", () => {
    it("bascule en mode forgot au clic sur 'Mot de passe oublié ?'", () => {
      renderWithProviders(<Login />);
      fireEvent.click(screen.getByText(/mot de passe oublié/i));
      expect(screen.getByRole("button", { name: /envoyer le lien/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/mot de passe/i)).not.toBeInTheDocument();
    });

    it("appelle resetPasswordForEmail avec le bon email", async () => {
      mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
      renderWithProviders(<Login />);

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
      renderWithProviders(<Login />);

      fireEvent.click(screen.getByText(/mot de passe oublié/i));
      fireEvent.change(screen.getByLabelText(/email/i), {
        target: { value: "agent@mairie.fr" },
      });
      fireEvent.click(screen.getByRole("button", { name: /envoyer le lien/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /se connecter/i })).toBeInTheDocument();
      });
    });

    it("revient en mode login au clic sur 'Retour à la connexion'", () => {
      renderWithProviders(<Login />);
      fireEvent.click(screen.getByText(/mot de passe oublié/i));
      fireEvent.click(screen.getByText(/retour à la connexion/i));
      expect(screen.getByRole("button", { name: /se connecter/i })).toBeInTheDocument();
    });
  });
});
