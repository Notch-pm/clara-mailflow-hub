import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENTS_BYTES,
  planOutboundAttachments,
  storageKeyBelongsTo,
  type OutboundDocument,
} from "../../../supabase/functions/_shared/outboundAttachments";

const CTX = { courierId: "s-1", organizationId: "org-1" };
const doc = (over: Partial<OutboundDocument> = {}): OutboundDocument => ({
  id: "d-1",
  organization_id: "org-1",
  courier_id: "s-1",
  file_name: "convocation.pdf",
  mime_type: "application/pdf",
  file_size: 100_000,
  storage_key: "org_org-1/s-1/convocation.pdf",
  ...over,
});

describe("storageKeyBelongsTo", () => {
  it("accepte le préfixe du tenant, nouveau et ancien format", () => {
    expect(storageKeyBelongsTo("org_org-1/x.pdf", "org-1")).toBe(true);
    expect(storageKeyBelongsTo("org-1/x.pdf", "org-1")).toBe(true);
  });

  it("refuse un autre tenant, une remontée de dossier, une clé absente", () => {
    expect(storageKeyBelongsTo("org_org-2/x.pdf", "org-1")).toBe(false);
    expect(storageKeyBelongsTo("org_org-1/../org_org-2/x.pdf", "org-1")).toBe(false);
    expect(storageKeyBelongsTo(null, "org-1")).toBe(false);
  });
});

describe("planOutboundAttachments", () => {
  it("emporte les documents du sortant", () => {
    const plan = planOutboundAttachments([doc(), doc({ id: "d-2", file_name: "plan.png" })], CTX);
    expect(plan.refusal).toBeNull();
    expect(plan.items.map((d) => d.id)).toEqual(["d-1", "d-2"]);
  });

  it("écarte ce qui n'est pas à lui : autre courrier, autre tenant, clé étrangère", () => {
    const plan = planOutboundAttachments(
      [
        doc({ id: "autre-courrier", courier_id: "s-2" }),
        doc({ id: "autre-tenant", organization_id: "org-2" }),
        doc({ id: "cle-etrangere", storage_key: "org_org-2/x.pdf" }),
        doc({ id: "ok" }),
      ],
      CTX,
    );
    expect(plan.items.map((d) => d.id)).toEqual(["ok"]);
  });

  it("au-delà du poids permis, l'envoi est refusé en entier — jamais partiel", () => {
    const plan = planOutboundAttachments(
      [doc({ file_size: MAX_ATTACHMENTS_BYTES }), doc({ id: "d-2", file_size: 1 })],
      CTX,
    );
    expect(plan.items).toEqual([]);
    expect(plan.refusal).toMatch(/trop lourdes \(10,0 Mo\)/);
  });

  it("au-delà du nombre permis, refus aussi", () => {
    const docs = Array.from({ length: 3 }, (_, i) => doc({ id: `d-${i}` }));
    const plan = planOutboundAttachments(docs, CTX, { maxCount: 2 });
    expect(plan.items).toEqual([]);
    expect(plan.refusal).toMatch(/Trop de pièces jointes \(3\)/);
  });

  it("sans document, rien à joindre et rien à refuser", () => {
    expect(planOutboundAttachments([], CTX)).toEqual({ items: [], refusal: null });
  });
});
