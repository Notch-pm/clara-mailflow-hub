import { describe, expect, it } from "vitest";
import {
  EMPTY_OUTBOX_FILTERS,
  classifyOutbound,
  countOutboxViews,
  inOutboxView,
  isOutboxView,
  matchesOutboxFilters,
  outboxStage,
  sortOutbox,
} from "@/lib/outbox";
import type { OutboxRow } from "@/services/outboxService";

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "r1",
    chrono: "2026-S-00001",
    subject: "Invitation",
    channel: "email",
    parent_courier_id: null,
    parent_chrono: null,
    parent_subject: null,
    socle_organization_id: "org-1",
    created_at: "2026-10-01T09:00:00Z",
    sent_at: null,
    state_id: "s1",
    state_name: "Brouillon",
    state_is_initial: true,
    state_is_final: false,
    state_is_send: false,
    state_requires_visa: false,
    state_requires_signature: false,
    signed_at: null,
    sent_email_at: null,
    posted_at: null,
    recipient_name: "Jeanne Martin",
    recipient_contact_id: "c-1",
    state_since: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

const visa = { state_is_initial: false, state_requires_visa: true };
const signature = { state_is_initial: false, state_requires_signature: true };
const send = { state_is_initial: false, state_is_send: true };

describe("outboxStage", () => {
  it("range chaque état dans son onglet", () => {
    expect(outboxStage(row())).toBe("redaction");
    expect(outboxStage(row(visa))).toBe("visa");
    expect(outboxStage(row(signature))).toBe("signature");
    expect(outboxStage(row(send))).toBe("envoi");
    expect(outboxStage(row({ state_is_initial: false, state_is_final: true }))).toBe("envoyes");
  });

  it("un « à corriger » ou un sortant sans état reste en rédaction", () => {
    expect(outboxStage(row({ state_is_initial: false, state_name: "A corriger" }))).toBe("redaction");
    expect(outboxStage(row({ state_id: null, state_name: null, state_is_initial: false }))).toBe("redaction");
  });

  it("parti par courriel ou posté : envoyé, quel que soit l'état", () => {
    expect(outboxStage(row({ ...send, sent_email_at: "2026-10-02T10:00:00Z" }))).toBe("envoyes");
    expect(outboxStage(row({ ...signature, posted_at: "2026-10-02" }))).toBe("envoyes");
  });

  it("`sent_at` seul ne fait pas un envoi : c'était un leurre posé à la création", () => {
    expect(outboxStage(row({ ...send, sent_at: "2026-10-01T09:00:00Z" }))).toBe("envoi");
  });

  it("signé : prêt à l'envoi, même hors étape d'envoi", () => {
    expect(outboxStage(row({ ...signature, signed_at: "2026-10-02T10:00:00Z" }))).toBe("envoi");
    expect(outboxStage(row({ state_is_initial: false, signed_at: "2026-10-02T10:00:00Z" }))).toBe("envoi");
  });
});

describe("classifyOutbound", () => {
  const now = new Date("2026-10-05T12:00:00Z");

  it("compte l'attente dans l'état courant et dit la nature du courrier", () => {
    const item = classifyOutbound(row({ ...signature, parent_courier_id: "p1", state_since: "2026-10-02T09:00:00Z" }), now);
    expect(item).toMatchObject({ stage: "signature", kind: "reply", waitingDays: 3, sentOn: null });
  });

  it("date d'envoi : courriel, sinon posté, sinon `sent_at` d'un état final", () => {
    expect(classifyOutbound(row({ sent_email_at: "2026-10-03T08:00:00Z" }), now).sentOn).toBe("2026-10-03T08:00:00Z");
    expect(classifyOutbound(row({ posted_at: "2026-10-04" }), now).sentOn).toBe("2026-10-04");
    expect(classifyOutbound(row({ state_is_final: true, sent_at: "2026-09-01T00:00:00Z" }), now)).toMatchObject({
      stage: "envoyes",
      sentOn: "2026-09-01T00:00:00Z",
      waitingDays: 0,
    });
  });
});

describe("vues", () => {
  const items = [
    row({ id: "a" }),
    row({ id: "b", ...visa }),
    row({ id: "c", ...signature }),
    row({ id: "d", ...signature }),
    row({ id: "e", ...send }),
    row({ id: "f", sent_email_at: "2026-10-02T10:00:00Z" }),
  ].map((r) => classifyOutbound(r));

  it("compte chaque onglet, et Tous", () => {
    expect(countOutboxViews(items)).toEqual({ redaction: 1, visa: 1, signature: 2, envoi: 1, envoyes: 1, tous: 6 });
  });

  it("Tous contient tout, un onglet seulement son étape", () => {
    expect(items.filter((i) => inOutboxView(i, "tous"))).toHaveLength(6);
    expect(items.filter((i) => inOutboxView(i, "signature")).map((i) => i.row.id)).toEqual(["c", "d"]);
  });

  it("reconnaît les vues de l'URL", () => {
    expect(isOutboxView("envoi")).toBe(true);
    expect(isOutboxView("retard")).toBe(false);
    expect(isOutboxView(null)).toBe(false);
  });
});

describe("matchesOutboxFilters", () => {
  const reply = classifyOutbound(
    row({ parent_courier_id: "p1", parent_subject: "Demande de réparation", channel: "paper", recipient_name: "Paul Durand" }),
  );
  const initiative = classifyOutbound(row());

  it("cherche dans l'objet, celui du courrier reçu, la référence et le destinataire, sans accents", () => {
    expect(matchesOutboxFilters(reply, { ...EMPTY_OUTBOX_FILTERS, query: "reparation" })).toBe(true);
    expect(matchesOutboxFilters(reply, { ...EMPTY_OUTBOX_FILTERS, query: "durand" })).toBe(true);
    expect(matchesOutboxFilters(initiative, { ...EMPTY_OUTBOX_FILTERS, query: "S-00001" })).toBe(true);
    expect(matchesOutboxFilters(initiative, { ...EMPTY_OUTBOX_FILTERS, query: "durand" })).toBe(false);
  });

  it("filtre par nature, canal et organisation", () => {
    expect(matchesOutboxFilters(reply, { ...EMPTY_OUTBOX_FILTERS, kinds: ["initiative"] })).toBe(false);
    expect(matchesOutboxFilters(initiative, { ...EMPTY_OUTBOX_FILTERS, kinds: ["initiative"] })).toBe(true);
    expect(matchesOutboxFilters(reply, { ...EMPTY_OUTBOX_FILTERS, channels: ["email"] })).toBe(false);
    expect(matchesOutboxFilters(reply, { ...EMPTY_OUTBOX_FILTERS, serviceId: "org-2" })).toBe(false);
  });
});

describe("sortOutbox", () => {
  const old = classifyOutbound(row({ id: "old", ...signature, created_at: "2026-09-01T00:00:00Z", state_since: "2026-09-02T00:00:00Z" }));
  const recent = classifyOutbound(row({ id: "new", ...signature, created_at: "2026-10-01T00:00:00Z", state_since: "2026-10-02T00:00:00Z" }));

  it("une file : le plus ancien dans son état d'abord", () => {
    expect(sortOutbox([recent, old], "signature").map((i) => i.row.id)).toEqual(["old", "new"]);
  });

  it("Tous : le plus récent d'abord", () => {
    expect(sortOutbox([old, recent], "tous").map((i) => i.row.id)).toEqual(["new", "old"]);
  });

  it("Envoyés : le dernier parti d'abord", () => {
    const a = classifyOutbound(row({ id: "a", sent_email_at: "2026-10-01T00:00:00Z" }));
    const b = classifyOutbound(row({ id: "b", posted_at: "2026-10-03" }));
    expect(sortOutbox([a, b], "envoyes").map((i) => i.row.id)).toEqual(["b", "a"]);
  });
});
