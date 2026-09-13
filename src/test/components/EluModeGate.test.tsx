import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { installMatchMedia, resizeTo, restoreMatchMedia } from "../utils/matchMedia";

/**
 * L'aiguillage entre l'application complète et l'espace élu.
 *
 * C'est le test qui compte : une erreur ici sert des écrans amputés à un agent,
 * ou prive l'élu de son espace sans que rien n'échoue visiblement.
 */

interface AuthState {
  user: { id: string } | null;
  profile: { is_superadmin: boolean } | null;
  membership: { role: string } | null;
}

let authState: AuthState;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState,
}));

const { EluModeGate } = await import("@/components/elu/EluModeGate");

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<EluModeGate />}>
          <Route
            element={
              <div>
                <span>shell complet</span>
                <Outlet />
              </div>
            }
          >
            <Route path="/" element={<span>tableau de bord</span>} />
            <Route path="/courrier/:id" element={<span>fiche courrier</span>} />
            <Route path="/mon-profil" element={<span>mon profil</span>} />
          </Route>
          <Route
            path="/elu"
            element={
              <div>
                <span>shell élu</span>
                <Outlet />
              </div>
            }
          >
            <Route index element={<span>accueil élu</span>} />
            <Route path="a-signer" element={<span>à signer</span>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState = { user: { id: "u1" }, profile: { is_superadmin: false }, membership: { role: "elu" } };
  localStorage.clear();
  installMatchMedia(390);
});

afterEach(() => {
  restoreMatchMedia();
  localStorage.clear();
});

describe("EluModeGate", () => {
  it("élu sur téléphone → l'accueil bascule vers l'espace élu", () => {
    renderAt("/");
    expect(screen.getByText("accueil élu")).toBeInTheDocument();
    // Le gabarit complet ne doit pas avoir été monté au passage : la
    // redirection est rendue à la place de l'Outlet, pas dans un effet.
    expect(screen.queryByText("shell complet")).not.toBeInTheDocument();
  });

  it("gestionnaire sur téléphone → rien ne change", () => {
    authState.membership = { role: "gestionnaire" };
    renderAt("/");
    expect(screen.getByText("tableau de bord")).toBeInTheDocument();
    expect(screen.queryByText("shell élu")).not.toBeInTheDocument();
  });

  it("gestionnaire qui force /elu → renvoyé vers l'application complète", () => {
    authState.membership = { role: "gestionnaire" };
    renderAt("/elu/a-signer");
    expect(screen.getByText("tableau de bord")).toBeInTheDocument();
  });

  it("élu sur grand écran → application complète", () => {
    installMatchMedia(1280);
    renderAt("/");
    expect(screen.getByText("tableau de bord")).toBeInTheDocument();
  });

  it("élu ayant demandé l'affichage complet → reste sur l'application complète", () => {
    localStorage.setItem("clara.elu-affichage:u1", "complet");
    renderAt("/");
    expect(screen.getByText("tableau de bord")).toBeInTheDocument();
  });

  it("le choix d'un autre utilisateur ne s'applique pas — téléphone partagé", () => {
    localStorage.setItem("clara.elu-affichage:u2", "complet");
    renderAt("/");
    expect(screen.getByText("accueil élu")).toBeInTheDocument();
  });

  it("élargir la fenêtre depuis un écran de l'espace élu ramène à l'accueil complet", () => {
    renderAt("/elu/a-signer");
    expect(screen.getByText("à signer")).toBeInTheDocument();

    act(() => resizeTo(1280));

    expect(screen.getByText("tableau de bord")).toBeInTheDocument();
  });

  it("un écran ouvert exprès n'est jamais arraché à l'élu", () => {
    // Lien profond d'une notification : on laisse l'écran, `AppLayout` posera
    // seulement un retour vers l'espace élu.
    renderAt("/courrier/abc");
    expect(screen.getByText("fiche courrier")).toBeInTheDocument();
    expect(screen.queryByText("accueil élu")).not.toBeInTheDocument();
  });

  it("mon profil reste accessible depuis l'espace élu", () => {
    renderAt("/mon-profil");
    expect(screen.getByText("mon profil")).toBeInTheDocument();
  });
});
