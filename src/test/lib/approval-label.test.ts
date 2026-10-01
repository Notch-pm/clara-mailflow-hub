import { describe, expect, it } from "vitest";
import { approvalLabel } from "@/lib/approval-label";

describe("approvalLabel", () => {
  it("reprend le nom de la transition quand il dit le geste", () => {
    expect(approvalLabel("visa", "Viser")).toBe("Viser");
    expect(approvalLabel("visa", "Visa du DGS")).toBe("Visa du DGS");
    expect(approvalLabel("sign", "Signature du maire")).toBe("Signature du maire");
    expect(approvalLabel("sign", "signer et envoyer")).toBe("signer et envoyer");
  });

  it("dit le geste devant un nom qui le tait", () => {
    expect(approvalLabel("sign", "Terminer")).toBe("Signer · Terminer");
    expect(approvalLabel("visa", "Transmettre au DGS")).toBe("Viser · Transmettre au DGS");
  });

  it("ne se laisse pas tromper par un mot qui contient le geste", () => {
    expect(approvalLabel("visa", "Réviser")).toBe("Viser · Réviser");
    expect(approvalLabel("sign", "Consigner")).toBe("Signer · Consigner");
  });

  it("rend le geste seul sans transition suivante", () => {
    expect(approvalLabel("visa", null)).toBe("Viser");
    expect(approvalLabel("sign", "  ")).toBe("Signer");
  });
});
