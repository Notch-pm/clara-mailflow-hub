import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import AdvanceBlockedButton from "@/components/courier/AdvanceBlockedButton";

const RAISON = "Aucune transition « Suivante » depuis « Nouveau courrier ».";

function renderButton() {
  return render(
    <TooltipProvider delayDuration={0}>
      <AdvanceBlockedButton reason={RAISON}>Instruire</AdvanceBlockedButton>
    </TooltipProvider>,
  );
}

describe("AdvanceBlockedButton", () => {
  it("le bouton reste désactivé", () => {
    renderButton();
    expect(screen.getByRole("button", { name: "Instruire" })).toBeDisabled();
  });

  it("l'infobulle n'est PAS portée par le bouton désactivé", () => {
    // La régression à empêcher : un `title` sur un bouton `disabled` n'est
    // jamais affiché (`disabled:pointer-events-none` + pas d'événement souris
    // sur un contrôle désactivé dans Chrome). Le message serait calculé pour
    // personne.
    renderButton();
    expect(screen.getByRole("button", { name: "Instruire" })).not.toHaveAttribute("title");
  });

  it("un élément focalisable intercalé porte l'infobulle", () => {
    const { container } = renderButton();
    const trigger = container.querySelector("span[tabindex]");
    expect(trigger).not.toBeNull();
    expect(trigger).toHaveAttribute("tabindex", "0");
    // C'est bien le porteur du bouton, pas un élément voisin.
    expect(trigger).toContainElement(screen.getByRole("button", { name: "Instruire" }));
  });

  it("la raison s'affiche au focus clavier", async () => {
    const { container } = renderButton();
    fireEvent.focus(container.querySelector("span[tabindex]")!);
    await waitFor(() => {
      expect(screen.getAllByText(RAISON).length).toBeGreaterThan(0);
    });
  });
});
