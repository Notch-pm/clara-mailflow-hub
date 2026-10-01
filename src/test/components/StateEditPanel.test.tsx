import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../utils/renderWithProviders";
import { StateEditPanel } from "@/components/workflow/StateEditPanel";

function renderPanel(props: Partial<Parameters<typeof StateEditPanel>[0]> = {}) {
  const onUpdate = vi.fn();
  renderWithProviders(
    <StateEditPanel
      stateId="s-1"
      name="À viser"
      category="processing"
      isInitial={false}
      isFinal={false}
      workflowType="reply"
      onUpdate={onUpdate}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );
  return onUpdate;
}

describe("StateEditPanel — étape de visa", () => {
  it("propose l'étape de visa sur un workflow réponse et l'active", () => {
    const onUpdate = renderPanel();
    fireEvent.click(screen.getByRole("switch", { name: /étape de visa/i }));
    expect(onUpdate).toHaveBeenCalledWith({ requires_visa: true });
  });

  it("n'offre pas le visa sur un workflow entrant", () => {
    renderPanel({ workflowType: "inbound" });
    expect(screen.queryByRole("switch", { name: /étape de visa/i })).not.toBeInTheDocument();
  });

  it("visa et signature s'excluent mutuellement", () => {
    renderPanel({ requiresVisa: true });
    expect(screen.getByRole("switch", { name: /état de signature/i })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /état d'envoi/i })).toBeDisabled();
  });

  it("une étape de signature ne peut pas devenir étape de visa", () => {
    renderPanel({ requiresSignature: true });
    expect(screen.getByRole("switch", { name: /étape de visa/i })).toBeDisabled();
  });

  it("ni l'état initial ni l'état final ne peuvent être des étapes de visa", () => {
    renderPanel({ isInitial: true });
    expect(screen.getByRole("switch", { name: /étape de visa/i })).toBeDisabled();
  });
});
