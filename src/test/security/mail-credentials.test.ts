import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Non-régression : les mots de passe IMAP / SMTP vivent dans Vault
// (migration 20261015090000). Toute lecture passe par
// `_shared/mailCredentials.ts` ; personne ne relit le serveur d'envoi à la main
// (un `select("*")` de `smtp_settings` n'apporterait plus de mot de passe et
// ferait échouer l'envoi en silence).

const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");
/** Seuls lecteurs légitimes de `smtp_settings` : le helper et la synchronisation (comptage). */
const SMTP_READERS = new Set(["_shared/mailCredentials.ts", "sync-socle-referentiel/index.ts"]);

function walk(dir: string, rel = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) return walk(full, r);
    return name.endsWith(".ts") ? [r] : [];
  });
}

const files = walk(FUNCTIONS_DIR).map((rel) => ({ rel, src: readFileSync(join(FUNCTIONS_DIR, rel), "utf8") }));

describe("identifiants de messagerie", () => {
  it("seul le helper partagé lit smtp_settings", () => {
    const offenders = files.filter((f) => f.src.includes('from("smtp_settings")') && !SMTP_READERS.has(f.rel));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("la relève IMAP prend son mot de passe dans Vault", () => {
    const fetch = files.find((f) => f.rel === "fetch-inbound-emails/index.ts")!;
    expect(fetch.src).toContain("loadImapPassword(");
    expect(fetch.src).not.toMatch(/\bs\.password\b/);
  });

  it("le navigateur ne lit jamais imap_settings en entier", () => {
    const src = readFileSync(join(process.cwd(), "src", "services", "imapSettingsService.ts"), "utf8");
    expect(src).not.toMatch(/from\("imap_settings"\)\s*\.select\("\*"\)/);
  });
});
