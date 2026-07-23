import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildHawkAuthorizationHeader,
  resolveHawkCredentials,
} from "../../supabase/functions/_shared/arpege";

describe("resolveHawkCredentials", () => {
  it("priorise client_id/client_secret", () => {
    expect(
      resolveHawkCredentials({
        client_id: "cid",
        client_secret: "csecret",
        access_token: "legacy-token",
      }),
    ).toEqual({ hawkId: "cid", hawkKey: "csecret" });
  });

  it("replie sur access_token quand client_id/client_secret sont absents (ligne legacy)", () => {
    expect(
      resolveHawkCredentials({
        client_id: null,
        client_secret: null,
        access_token: "legacy-token",
      }),
    ).toEqual({ hawkId: "legacy-token", hawkKey: "legacy-token" });
  });

  it("replie champ par champ (client_id présent seul, client_secret absent)", () => {
    expect(
      resolveHawkCredentials({
        client_id: "cid",
        client_secret: null,
        access_token: "legacy-token",
      }),
    ).toEqual({ hawkId: "cid", hawkKey: "legacy-token" });
  });

  it("config incomplète (aucun champ) → identifiants vides", () => {
    expect(resolveHawkCredentials({})).toEqual({ hawkId: "", hawkKey: "" });
    expect(
      resolveHawkCredentials({ client_id: null, client_secret: null, access_token: null }),
    ).toEqual({ hawkId: "", hawkKey: "" });
  });

  it("ignore les chaînes vides (falsy) comme un champ absent", () => {
    expect(
      resolveHawkCredentials({ client_id: "", client_secret: "", access_token: "legacy-token" }),
    ).toEqual({ hawkId: "legacy-token", hawkKey: "legacy-token" });
  });
});

describe("buildHawkAuthorizationHeader", () => {
  /** Oracle indépendant (node:crypto) reproduisant le protocole Hawk v1. */
  function expectedHeader(input: {
    url: string;
    method: string;
    id: string;
    key: string;
    ts: string;
    nonce: string;
    contentType?: string;
    payload?: string;
  }): string {
    const { url, method, id, key, ts, nonce, contentType = "", payload = "" } = input;
    const u = new URL(url);
    const resource = u.pathname + u.search;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    const hash = createHash("sha256")
      .update(`hawk.1.payload\n${contentType}\n${payload}\n`)
      .digest("base64");
    const normalized =
      `hawk.1.header\n${ts}\n${nonce}\n${method.toUpperCase()}\n${resource}\n${u.hostname}\n${port}\n${hash}\n\n`;
    const mac = createHmac("sha256", key).update(normalized).digest("base64");
    return `Hawk id="${id}", ts="${ts}", nonce="${nonce}", hash="${hash}", mac="${mac}"`;
  }

  it("construit l'en-tête Hawk attendu pour un GET sans corps (ts/nonce déterministes)", async () => {
    const input = {
      url: "https://www.espace-citoyens.net/portail/v2/Hello",
      method: "GET",
      id: "hawk-id-123",
      key: "hawk-secret-abc",
      ts: "1700000000",
      nonce: "AbCdEf",
    };
    const header = await buildHawkAuthorizationHeader(input);
    expect(header).toBe(expectedHeader(input));
    expect(header).toMatch(
      /^Hawk id="hawk-id-123", ts="1700000000", nonce="AbCdEf", hash="[^"]+", mac="[^"]+"$/,
    );
  });

  it("construit l'en-tête Hawk attendu pour un POST avec corps JSON", async () => {
    const input = {
      url: "https://www.espace-citoyens.net/portail/v2/Demandes?scope=data_formulaire",
      method: "POST",
      id: "hawk-id-123",
      key: "hawk-secret-abc",
      ts: "1700000042",
      nonce: "Nonce1",
      contentType: "application/json",
      payload: JSON.stringify({ Titre: "Demande test" }),
    };
    const header = await buildHawkAuthorizationHeader(input);
    expect(header).toBe(expectedHeader(input));
  });

  it("un ts/nonce différent change le hash mac (pas de collision triviale)", async () => {
    const base = {
      url: "https://www.espace-citoyens.net/portail/v2/Hello",
      method: "GET",
      id: "hawk-id-123",
      key: "hawk-secret-abc",
    };
    const headerA = await buildHawkAuthorizationHeader({ ...base, ts: "1", nonce: "aaaaaa" });
    const headerB = await buildHawkAuthorizationHeader({ ...base, ts: "2", nonce: "bbbbbb" });
    expect(headerA).not.toBe(headerB);
  });
});
