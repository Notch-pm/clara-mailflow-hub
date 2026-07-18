import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";

describe("QuartierBadge", () => {
  it("affiche le nom du quartier", () => {
    render(<QuartierBadge quartier={{ id: "q-1", name: "Trinquetaille", color: "#0acf83" }} />);
    expect(screen.getByText("Trinquetaille")).toBeInTheDocument();
  });

  it("applique la couleur du référentiel avec un texte lisible", () => {
    // Vert clair Notch → texte noir ; le contraste est calculé, pas figé.
    const { rerender } = render(
      <QuartierBadge quartier={{ id: "q-1", name: "Clair", color: "#ffcd57" }} />,
    );
    expect(screen.getByText("Clair")).toHaveStyle({ backgroundColor: "#ffcd57", color: "#000" });

    rerender(<QuartierBadge quartier={{ id: "q-2", name: "Sombre", color: "#1b3a2f" }} />);
    expect(screen.getByText("Sombre")).toHaveStyle({ backgroundColor: "#1b3a2f", color: "#fff" });
  });

  it("gère les couleurs HSL du référentiel", () => {
    // La palette d'import du Socle produit du `hsl(h s% l%)` (syntaxe CSS
    // Color 4, séparée par des espaces) — pas du hex : c'est la forme que
    // reçoit réellement Clara.
    render(<QuartierBadge quartier={{ id: "q-4", name: "Malakoff", color: "hsl(212 92% 55%)" }} />);
    expect(screen.getByText("Malakoff")).toHaveStyle({ color: "#fff" });
  });

  it("rend un tiret quand le contact n'a pas de quartier", () => {
    // Cas courant : adresse hors du découpage, ou non géolocalisable.
    const { rerender } = render(<QuartierBadge quartier={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    // Fiche servie par une version de l'API antérieure au champ.
    rerender(<QuartierBadge quartier={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("tolère un quartier sans couleur", () => {
    render(<QuartierBadge quartier={{ id: "q-3", name: "Griffeuille", color: null }} />);
    expect(screen.getByText("Griffeuille")).toBeInTheDocument();
  });
});
