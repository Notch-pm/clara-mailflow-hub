import { describe, expect, it } from "vitest";
import { formatEuros, monthTotalTtc, parseDailyCap, postalSendingStatusLabel } from "@/lib/postal-sending";
import { describeCourierEvent } from "@/lib/courier-history";

describe("envois papiers réels", () => {
  it("nomme les statuts", () => {
    expect(postalSendingStatusLabel("sent")).toBe("Envoyé");
    expect(postalSendingStatusLabel("to_verify")).toBe("À vérifier");
    expect(postalSendingStatusLabel("inconnu")).toBe("inconnu");
  });

  it("écrit les montants à la française", () => {
    expect(formatEuros(1.23).replace(/\s/g, " ")).toBe("1,23 €");
    expect(formatEuros("2.5").replace(/\s/g, " ")).toBe("2,50 €");
    expect(formatEuros(null)).toBe("—");
  });

  it("totalise les envois partis dans le mois, et eux seuls", () => {
    const now = new Date(2026, 10, 15);
    const rows = [
      { status: "sent", price_ttc: 1.2, sent_at: new Date(2026, 10, 2).toISOString() },
      { status: "sent", price_ttc: "6.85", sent_at: new Date(2026, 10, 14).toISOString() },
      { status: "sent", price_ttc: 3, sent_at: new Date(2026, 9, 30).toISOString() },
      { status: "failed", price_ttc: 9, sent_at: null },
      { status: "to_verify", price_ttc: null, sent_at: null },
    ];
    expect(monthTotalTtc(rows, now)).toEqual({ count: 2, total: 8.05 });
  });

  it("borne le plafond quotidien", () => {
    expect(parseDailyCap("50")).toBe(50);
    expect(parseDailyCap("0")).toBe(0);
    expect(parseDailyCap("1001")).toBeNull();
    expect(parseDailyCap("-3")).toBeNull();
    expect(parseDailyCap("abc")).toBeNull();
  });
});

describe("historique des envois papiers réels", () => {
  it("dit qui a posté, quand, comment et pour combien", () => {
    const d = describeCourierEvent("outbound_posted", {
      provider: "merci_facteur", posted_on: new Date(2026, 10, 6, 14, 5).toISOString(), posted_mode: "suivi", price_ttc: 1.6,
    });
    expect(d.title).toBe("Courrier sortant posté");
    expect(d.detail?.replace(/\s/g, " ")).toBe("Par le prestataire · le 06/11/2026 à 14:05 · Suivie · 1,60 € TTC");
  });

  it("dit l'échec et le suivi", () => {
    expect(describeCourierEvent("outbound_postal_failed", { status: "to_verify", reason: "délai" }).detail).toBe("À vérifier chez le prestataire · délai");
    expect(describeCourierEvent("outbound_postal_event", { label: "Distribué" })).toEqual({ title: "Suivi du courrier papier", detail: "Distribué" });
  });
});
