import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EluSignFooter } from "@/components/elu/EluSignFooter";
import type { EluAction } from "@/hooks/useSignAndAdvance";

/**
 * Le pied d'action est le seul endroit d'où un élu engage la collectivité.
 * Ce qui se teste ici : qu'il ne propose que ce que le workflow autorise, qu'il
 * DIT pourquoi il refuse, et qu'un double-tap ne signe pas deux fois.
 */

const signAction = (over: Partial<EluAction> = {}): EluAction => ({
  id: "sign",
  label: "Signer et envoyer",
  run: vi.fn(),
  ...over,
});

describe("EluSignFooter", () => {
  it("sans transition secondaire, aucun bouton secondaire", () => {
    // « Renvoyer au service » n'est pas un bouton du produit : si la
    // collectivité n'a modélisé aucune autre transition, il n'y a rien à offrir.
    render(<EluSignFooter primary={signAction()} secondary={[]} isPending={false} />);

    expect(screen.getByRole("button", { name: /signer et envoyer/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("affiche chaque transition secondaire avec le libellé de la collectivité", () => {
    const secondary: EluAction[] = [
      { id: "t1", label: "Renvoyer au service", run: vi.fn() },
      { id: "t2", label: "Classer sans suite", run: vi.fn() },
      { id: "t3", label: "Demander un avis juridique", run: vi.fn() },
    ];

    render(<EluSignFooter primary={signAction()} secondary={secondary} isPending={false} />);

    expect(screen.getByRole("button", { name: "Renvoyer au service" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Classer sans suite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Demander un avis juridique" })).toBeInTheDocument();
  });

  it("déclenche la transition secondaire sans passer par la confirmation", () => {
    const run = vi.fn();
    render(
      <EluSignFooter
        primary={signAction()}
        secondary={[{ id: "t1", label: "Renvoyer au service", run }]}
        isPending={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Renvoyer au service" }));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("dit pourquoi il refuse, et ne se contente pas de griser", () => {
    const run = vi.fn();
    render(
      <EluSignFooter
        primary={signAction({ run, disabledReason: "Vous n'êtes pas le signataire désigné." })}
        secondary={[]}
        isPending={false}
      />,
    );

    // Le motif est du texte lisible, pas une infobulle : il n'y a pas de survol
    // sur un téléphone.
    expect(screen.getByText("Vous n'êtes pas le signataire désigné.")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /signer et envoyer/i });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByText(/Confirmer la signature/)).not.toBeInTheDocument();
  });

  it("la signature demande confirmation avant de partir chez l'usager", () => {
    const run = vi.fn();
    render(<EluSignFooter primary={signAction({ run })} secondary={[]} isPending={false} />);

    fireEvent.click(screen.getByRole("button", { name: /signer et envoyer/i }));

    expect(screen.getByText("Confirmer la signature ?")).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Oui, signer" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("« Annuler » referme sans rien signer", () => {
    const run = vi.fn();
    render(<EluSignFooter primary={signAction({ run })} secondary={[]} isPending={false} />);

    fireEvent.click(screen.getByRole("button", { name: /signer et envoyer/i }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));

    expect(run).not.toHaveBeenCalled();
  });

  it("une signature en cours verrouille le bouton de confirmation", () => {
    // 300 ms de latence tactile : sans ce verrou, un double-tap lance deux
    // transitions, et `transitionReplyState` n'est pas idempotente.
    const run = vi.fn();
    const { rerender } = render(
      <EluSignFooter primary={signAction({ run })} secondary={[]} isPending={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /signer et envoyer/i }));
    rerender(<EluSignFooter primary={signAction({ run })} secondary={[]} isPending />);

    const confirm = screen.getByRole("button", { name: /signature…/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(run).not.toHaveBeenCalled();
  });

  it("une transition ordinaire part sans confirmation", () => {
    const run = vi.fn();
    render(
      <EluSignFooter
        primary={{ id: "t-next", label: "Mettre à la signature", run }}
        secondary={[]}
        isPending={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mettre à la signature" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Confirmer la signature ?")).not.toBeInTheDocument();
  });

  it("sans aucune action, le pied ne s'affiche pas du tout", () => {
    const { container } = render(<EluSignFooter primary={null} secondary={[]} isPending={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("le visa demande confirmation et transmet le commentaire saisi", () => {
    const run = vi.fn();
    render(
      <EluSignFooter primary={{ id: "visa", label: "Viser", run }} secondary={[]} isPending={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Viser" }));
    expect(screen.getByText("Viser cette réponse ?")).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: /commentaire/i }), {
      target: { value: "Vu, conforme." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Oui, viser" }));

    expect(run).toHaveBeenCalledWith("Vu, conforme.");
  });

  it("la feuille de signature ne propose pas de commentaire", () => {
    render(<EluSignFooter primary={signAction()} secondary={[]} isPending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /signer et envoyer/i }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
