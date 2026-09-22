import { describe, expect, it } from "vitest";
import {
  buildSocleRequest,
  isUuid,
  parseKeyMap,
  resolveApiKey,
} from "../../../supabase/functions/_shared/socleContactsLogic";

const ORG_A = "d5227d25-f327-493a-a9a2-278397531e33";
const ORG_B = "c95812a7-4695-46d1-89a6-d11e18c7945b";
const CONTACT_ID = "0a4a9d6e-2f6a-4d0e-9f6b-3c1d2e3f4a5b";

describe("parseKeyMap", () => {
  it("parse un JSON valide et trim les clés", () => {
    const map = parseKeyMap(`{"${ORG_A}":" sk_live_abc ","${ORG_B}":"sk_live_def"}`);
    expect(map).toEqual({ [ORG_A]: "sk_live_abc", [ORG_B]: "sk_live_def" });
  });

  it("tolère les entrées invalides (map vide)", () => {
    expect(parseKeyMap(undefined)).toEqual({});
    expect(parseKeyMap("")).toEqual({});
    expect(parseKeyMap("   ")).toEqual({});
    expect(parseKeyMap("pas du json")).toEqual({});
    expect(parseKeyMap("[1,2]")).toEqual({});
    expect(parseKeyMap('"chaine"')).toEqual({});
  });

  it("ignore les valeurs non-string ou vides", () => {
    expect(parseKeyMap(`{"${ORG_A}":42,"${ORG_B}":"","x":"sk_live_ok"}`)).toEqual({ x: "sk_live_ok" });
  });
});

describe("resolveApiKey", () => {
  const map = { [ORG_A]: "sk_live_abc" };
  it("résout la clé du tenant", () => {
    expect(resolveApiKey(map, ORG_A)).toBe("sk_live_abc");
  });
  it("null si org inconnue ou absente", () => {
    expect(resolveApiKey(map, ORG_B)).toBeNull();
    expect(resolveApiKey(map, null)).toBeNull();
    expect(resolveApiKey(map, undefined)).toBeNull();
  });
});

describe("isUuid", () => {
  it("accepte un uuid, rejette le reste", () => {
    expect(isUuid(CONTACT_ID)).toBe(true);
    expect(isUuid(CONTACT_ID.toUpperCase())).toBe(true);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe("buildSocleRequest", () => {
  it("list sans filtre → GET /v1/contacts, idempotent", () => {
    const r = buildSocleRequest("list");
    expect(r).toEqual({
      ok: true,
      request: { method: "GET", path: "/v1/contacts", idempotent: true },
    });
  });

  it("list avec filtres → querystring encodée, filtres vides ignorés", () => {
    const r = buildSocleRequest("list", {
      filters: { search: "Du pont", email: "a+b@ex.org", type: "personne", status: "", limit: 20, offset: 40 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const qs = new URLSearchParams(r.request.path.split("?")[1]);
      expect(qs.get("search")).toBe("Du pont");
      expect(qs.get("email")).toBe("a+b@ex.org");
      expect(qs.get("type")).toBe("personne");
      expect(qs.get("status")).toBeNull();
      expect(qs.get("limit")).toBe("20");
      expect(qs.get("offset")).toBe("40");
    }
  });

  it("roles → GET /v1/contact-roles", () => {
    const r = buildSocleRequest("roles");
    expect(r).toEqual({
      ok: true,
      request: { method: "GET", path: "/v1/contact-roles", idempotent: true },
    });
  });

  it("get → GET /v1/contacts/{id} ; id non-uuid refusé", () => {
    expect(buildSocleRequest("get", { id: CONTACT_ID })).toEqual({
      ok: true,
      request: { method: "GET", path: `/v1/contacts/${CONTACT_ID}`, idempotent: true },
    });
    expect(buildSocleRequest("get", { id: "nope" }).ok).toBe(false);
    expect(buildSocleRequest("get", {}).ok).toBe(false);
  });

  it("match → POST /v1/contacts/match, rejouable car sans effet de bord", () => {
    const payload = { last_name: "Dupont", phones: ["0612345678"] };
    expect(buildSocleRequest("match", { payload })).toEqual({
      ok: true,
      request: { method: "POST", path: "/v1/contacts/match", body: payload, idempotent: true },
    });
    expect(buildSocleRequest("match", {}).ok).toBe(false);
    expect(buildSocleRequest("match", { payload: [1] }).ok).toBe(false);
  });

  it("create → POST non rejouable avec payload obligatoire", () => {
    const payload = { contact_type: "personne", civility: "madame", last_name: "Test" };
    expect(buildSocleRequest("create", { payload })).toEqual({
      ok: true,
      request: { method: "POST", path: "/v1/contacts", body: payload, idempotent: false },
    });
    expect(buildSocleRequest("create", {}).ok).toBe(false);
    expect(buildSocleRequest("create", { payload: [1] }).ok).toBe(false);
  });

  it("update → PATCH non rejouable, id + payload obligatoires", () => {
    const payload = { email: "new@ex.org" };
    expect(buildSocleRequest("update", { id: CONTACT_ID, payload })).toEqual({
      ok: true,
      request: { method: "PATCH", path: `/v1/contacts/${CONTACT_ID}`, body: payload, idempotent: false },
    });
    expect(buildSocleRequest("update", { payload }).ok).toBe(false);
    expect(buildSocleRequest("update", { id: CONTACT_ID }).ok).toBe(false);
  });

  it("archive / restore → POST /v1/contacts/{id}/…", () => {
    for (const action of ["archive", "restore"] as const) {
      expect(buildSocleRequest(action, { id: CONTACT_ID })).toEqual({
        ok: true,
        request: { method: "POST", path: `/v1/contacts/${CONTACT_ID}/${action}`, idempotent: false },
      });
      expect(buildSocleRequest(action, { id: "nope" }).ok).toBe(false);
    }
  });

  it("consents_record / consents_from_courier → POST /v1/contacts/{id}/consents, corps composé par le serveur", () => {
    const body = { source_app: "clara", source_reference: null, collected_at: "2026-09-22T10:00:00.000Z", consents: [] };
    for (const action of ["consents_record", "consents_from_courier"] as const) {
      expect(buildSocleRequest(action, { id: CONTACT_ID, payload: body })).toEqual({
        ok: true,
        request: { method: "POST", path: `/v1/contacts/${CONTACT_ID}/consents`, body, idempotent: false },
      });
      expect(buildSocleRequest(action, { payload: body }).ok).toBe(false);
      expect(buildSocleRequest(action, { id: CONTACT_ID }).ok).toBe(false);
    }
  });

  it("action inconnue refusée", () => {
    expect(buildSocleRequest("delete", { id: CONTACT_ID }).ok).toBe(false);
    expect(buildSocleRequest(undefined).ok).toBe(false);
  });
});
