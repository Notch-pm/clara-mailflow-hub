/**
 * Les edge functions (Deno) échappent à `tsc` et à Vitest : une erreur de
 * syntaxe n'y apparaît qu'au démarrage du worker, en production. Le
 * 2026-09-23, `socle-contacts` refusait de démarrer depuis la veille
 * (`Identifier 'socleBody' has already been declared`) — annuaire, sélecteur
 * d'usager, rapprochement et création de contact tombaient tous sur un
 * « Failed to send a request to the Edge Function », sans rien dans le dépôt
 * pour le signaler.
 *
 * Chaque fichier passe par esbuild (déjà présent via Vite) : pas de contrôle
 * de types, mais tout ce qui empêcherait le worker de démarrer — double
 * déclaration, syntaxe invalide. esbuild refuse de tourner sous jsdom
 * (invariant TextEncoder) : il est lancé dans un processus Node à part.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "../../supabase/functions");

const SCRIPT = `
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");
const { transformSync } = require("esbuild");
const root = process.argv[1];
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : n.endsWith(".ts") ? [p] : [];
});
const files = walk(root);
const failures = [];
for (const f of files) {
  try { transformSync(readFileSync(f, "utf-8"), { loader: "ts", format: "esm" }); }
  catch (e) { failures.push(relative(root, f) + " : " + (e.errors?.[0]?.text ?? e.message)); }
}
process.stdout.write(JSON.stringify({ count: files.length, failures }));
`;

describe("edge functions : syntaxe valide au démarrage du worker", () => {
  it("aucune source ne ferait planter le démarrage", () => {
    const out = execFileSync(process.execPath, ["-e", SCRIPT, ROOT], {
      cwd: join(__dirname, "../.."),
      encoding: "utf-8",
    });
    const { count, failures } = JSON.parse(out) as { count: number; failures: string[] };
    expect(count).toBeGreaterThan(10);
    expect(failures).toEqual([]);
  });
});
