import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

interface AuthState {
  profile: { is_superadmin: boolean } | null;
  membership: { role: string; is_viseur?: boolean; is_signataire?: boolean } | null;
}

let authState: AuthState;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState }));

const { EluTabBar } = await import("@/components/elu/EluTabBar");

function renderBar(count = 0, path = "/elu") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EluTabBar signatureCount={count} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState = { profile: { is_superadmin: false }, membership: { role: "elu" } };
});

describe("EluTabBar", () => {
  it("porte les quatre onglets de l'espace", () => {
    renderBar();
    for (const label of ["Accueil", "À signer", "Rechercher", "Indicateurs"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("ne montre le compteur qu'à partir d'un courrier", () => {
    const { unmount } = renderBar(0);
    expect(screen.queryByText("3")).not.toBeInTheDocument();
    unmount();

    renderBar(3);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("masque les indicateurs quand le rôle n'y a pas droit", () => {
    // Le gestionnaire est volontairement exclu des statistiques ; l'onglet
    // renverrait sur une page qui redirige, donc sur une boucle.
    authState.membership = { role: "gestionnaire" };
    renderBar();
    expect(screen.queryByRole("link", { name: /Indicateurs/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Accueil/ })).toBeInTheDocument();
  });

  it("signale l'onglet courant aux technologies d'assistance", () => {
    renderBar(0, "/elu/a-signer");
    expect(screen.getByRole("link", { name: /À signer/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Accueil/ })).not.toHaveAttribute("aria-current");
  });

  it("l'accueil ne reste pas actif sur les autres écrans de l'espace", () => {
    // Sans `end`, `/elu` serait actif partout sous `/elu/*`.
    renderBar(0, "/elu/recherche");
    expect(screen.getByRole("link", { name: /Accueil/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /Rechercher/ })).toHaveAttribute("aria-current", "page");
  });

  it("« À viser » n'apparaît qu'au viseur, avec son propre compteur", () => {
    const { unmount } = renderBar();
    expect(screen.queryByRole("link", { name: /À viser/ })).not.toBeInTheDocument();
    unmount();

    // Viseur ET signataire : les deux onglets cohabitent.
    authState.membership = { role: "elu", is_viseur: true };
    render(
      <MemoryRouter initialEntries={["/elu"]}>
        <EluTabBar signatureCount={1} visaCount={4} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /À signer/ })).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: /À viser/ })).toHaveTextContent("4");
  });

  it("un viseur gestionnaire non signataire n'a pas d'onglet « À signer » vide", () => {
    authState.membership = { role: "gestionnaire", is_viseur: true };
    const { unmount } = renderBar();
    expect(screen.getByRole("link", { name: /À viser/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /À signer/ })).not.toBeInTheDocument();
    unmount();

    authState.membership = { role: "gestionnaire", is_viseur: true, is_signataire: true };
    renderBar();
    expect(screen.getByRole("link", { name: /À signer/ })).toBeInTheDocument();
  });
});
