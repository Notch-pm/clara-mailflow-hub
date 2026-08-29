import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AiQuotaExceededError,
  AiRateLimitedError,
  deriveAiApiBaseUrl,
  fitMessage,
  mapSocleAiFailure,
  MAX_MESSAGE_CHARS,
  parseJsonAnswer,
  SocleAiError,
} from "../../../supabase/functions/_shared/socleAiLogic";
import {
  jsonSchemaInstruction,
  objectSchema,
} from "../../../supabase/functions/_shared/jsonSchemaPrompt";

// ---------------------------------------------------------------------------
// Traduction des refus du guichet
// ---------------------------------------------------------------------------

const err = (code: string, message: string, quota?: Record<string, unknown>) => ({
  error: { code, message },
  ...(quota ? { quota } : {}),
});

describe("mapSocleAiFailure", () => {
  // ⚠️ C'est le seul cas où l'utilisateur apprend que le problème vient du
  // référentiel — parce que c'est actionnable pour lui : le reste du traitement
  // du courrier n'est pas affecté.
  it("pas de réponse ⇒ le référentiel est nommé, et le courrier rassuré", () => {
    const failure = mapSocleAiFailure(null, null, null);
    expect(failure.code).toBe("socle_unreachable");
    expect(failure.status).toBe(502);
    expect(failure.message).toContain("Le traitement du courrier n'est pas affecté");
  });

  // ⚠️ LA SEULE PHRASE RELAYÉE MOT POUR MOT. Elle nomme la date de
  // renouvellement, que seul le Socle connaît : la recomposer ici recréerait
  // le jumeau que la centralisation vient de supprimer.
  it("plafond atteint : le message du Socle est relayé tel quel", () => {
    const message = "Le plafond est atteint. Le crédit sera renouvelé le 1ᵉʳ septembre 2026.";
    const failure = mapSocleAiFailure(
      429,
      err("ai_quota_exceeded", message, { renews_at: "2026-09-01" }),
      null,
    );
    expect(failure).toBeInstanceOf(AiQuotaExceededError);
    expect(failure.message).toBe(message);
    expect((failure as AiQuotaExceededError).renewsAt).toBe("2026-09-01");
  });

  it("plafond sans date jointe : `renewsAt` reste nul plutôt qu'inventé", () => {
    const failure = mapSocleAiFailure(429, err("ai_quota_exceeded", "Plafond atteint."), null);
    expect((failure as AiQuotaExceededError).renewsAt).toBe(null);
  });

  // ⚠️ DEUX REFUS PARTAGENT LE 429, ET LES CONFONDRE COÛTERAIT UN MOIS : le
  // crédit est intact, c'est le rythme qui ne l'est pas.
  it("cadence dépassée : erreur distincte, avec le délai d'attente", () => {
    const failure = mapSocleAiFailure(429, err("ai_rate_limited", "Trop vite."), "12");
    expect(failure).toBeInstanceOf(AiRateLimitedError);
    expect(failure).not.toBeInstanceOf(AiQuotaExceededError);
    expect((failure as AiRateLimitedError).retryAfterSeconds).toBe(12);
  });

  it("cadence sans en-tête Retry-After : un défaut raisonnable, jamais zéro", () => {
    const failure = mapSocleAiFailure(429, err("ai_rate_limited", "Trop vite."), null);
    expect((failure as AiRateLimitedError).retryAfterSeconds).toBeGreaterThan(0);
  });

  // ⚠️ UNE ERREUR D'AUTHENTIFICATION N'EST JAMAIS RELAYÉE : un 401/403 dit que
  // la clé de Clara est mauvaise ou sans le scope « ai ». C'est une panne de
  // configuration, pas un problème de l'agent qui a cliqué — et un 401 relayé
  // le ferait déconnecter.
  it("401/403 : jamais relayés en 401, jamais détaillés", () => {
    for (const status of [401, 403]) {
      const failure = mapSocleAiFailure(status, err("forbidden", "scope ai manquant"), null);
      expect(failure.status).toBe(502);
      expect(failure.code).toBe("socle_auth_failed");
      expect(failure.message).not.toContain("scope");
      expect(failure.message).toContain("administrateur");
    }
  });

  // ⚠️ UN 400 DU SOCLE EST NOTRE BUG : Clara compose le payload. L'utilisateur
  // reçoit une erreur interne, pas un reproche qu'il ne peut pas corriger.
  it("400/404 : notre bug, pas celui de l'utilisateur", () => {
    for (const status of [400, 404]) {
      const failure = mapSocleAiFailure(status, err("bad_request", "Clés non autorisées : tools."), null);
      expect(failure.status).toBe(500);
      expect(failure.code).toBe("internal_error");
      expect(failure.message).not.toContain("tools");
    }
  });

  it("503 : la plateforme n'a pas de fournisseur", () => {
    const failure = mapSocleAiFailure(503, err("not_configured", "…"), null);
    expect(failure.status).toBe(503);
    expect(failure.code).toBe("not_configured");
  });

  it("502 et le reste : fournisseur muet, message unique", () => {
    for (const status of [500, 502, 504]) {
      const failure = mapSocleAiFailure(status, null, null);
      expect(failure.code).toBe("ai_unavailable");
      expect(failure.status).toBe(502);
    }
  });

  it("toutes les traductions restent des SocleAiError", () => {
    for (const status of [null, 400, 401, 429, 500, 502, 503]) {
      expect(mapSocleAiFailure(status, null, null)).toBeInstanceOf(SocleAiError);
    }
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe("deriveAiApiBaseUrl", () => {
  // Les edge functions d'un même projet Supabase ne diffèrent que par leur
  // dernier segment : un seul secret d'URL à poser, pas un par API.
  it("dérive l'URL du guichet de celle du référentiel", () => {
    expect(deriveAiApiBaseUrl("https://socle.test/functions/v1/public-api"))
      .toBe("https://socle.test/functions/v1/ai-api");
    expect(deriveAiApiBaseUrl("https://socle.test/functions/v1/contacts-api/"))
      .toBe("https://socle.test/functions/v1/ai-api");
  });

  it("une URL explicite l'emporte", () => {
    expect(deriveAiApiBaseUrl(
      "https://socle.test/functions/v1/public-api",
      "https://autre.test/functions/v1/ai-api",
    )).toBe("https://autre.test/functions/v1/ai-api");
  });

  // ⚠️ Sans configuration, la chaîne est vide — jamais une URL fantaisiste vers
  // laquelle on partirait appeler quelque chose.
  it("sans configuration, la chaîne est vide", () => {
    expect(deriveAiApiBaseUrl(undefined)).toBe("");
    expect(deriveAiApiBaseUrl("")).toBe("");
    expect(deriveAiApiBaseUrl("   ", "  ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Le JSON, du côté de Clara
// ---------------------------------------------------------------------------

describe("parseJsonAnswer", () => {
  it("parse une réponse propre", () => {
    expect(parseJsonAnswer<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  // Le seul écart jamais observé malgré la contrainte du mode JSON.
  it("retire une clôture markdown", () => {
    expect(parseJsonAnswer('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonAnswer('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("isole l'objet quand le modèle glisse une phrase autour", () => {
    expect(parseJsonAnswer('Voici le résultat : {"a":1} — voilà.')).toEqual({ a: 1 });
  });

  it("préserve l'imbrication", () => {
    expect(parseJsonAnswer('{"a":{"b":[1,2]}}')).toEqual({ a: { b: [1, 2] } });
  });

  // ⚠️ Un JSON illisible est une panne d'assistant, pas une erreur interne :
  // le geste utile pour l'utilisateur est de relancer.
  it("un JSON irrécupérable donne une erreur actionnable", () => {
    expect(() => parseJsonAnswer("désolé, je ne peux pas")).toThrow(SocleAiError);
    try {
      parseJsonAnswer("désolé, je ne peux pas");
    } catch (e) {
      expect((e as SocleAiError).code).toBe("ai_invalid_json");
      expect((e as SocleAiError).message).toContain("réessayez");
    }
  });
});

describe("fitMessage", () => {
  // ⚠️ LA BORNE EST CELLE DU SOCLE (40 000 caractères par message). Les anciens
  // plafonds de Clara (30 000 pour le corps + 60 000 pour les pièces jointes,
  // dans le MÊME message) la dépassaient : un dépassement vaut un 400, donc —
  // après traduction — une « erreur interne » pour l'utilisateur.
  it("laisse passer ce qui tient", () => {
    expect(fitMessage("court")).toBe("court");
    expect(fitMessage("x".repeat(MAX_MESSAGE_CHARS))).toHaveLength(MAX_MESSAGE_CHARS);
  });

  it("tronque au budget, marqueur compris", () => {
    const out = fitMessage("x".repeat(MAX_MESSAGE_CHARS + 5_000));
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(out).toContain("tronqué");
  });

  it("le budget est réglable pour un appel plus étroit", () => {
    const out = fitMessage("x".repeat(500), 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });
});

describe("jsonSchemaInstruction", () => {
  const schema = objectSchema({ summary: { type: "string" } }, ["summary"]);

  // ⚠️ LE MOT « JSON » DOIT S'Y TROUVER : le mode JSON du fournisseur l'exige
  // dans le prompt, et le guichet refuse l'appel en 400 s'il ne l'y trouve pas
  // — avant toute dépense. Ce bloc est ce qui garantit sa présence pour tous
  // les appelants à la fois.
  it("contient le mot « json », que le guichet exige", () => {
    expect(jsonSchemaInstruction(schema).toLowerCase()).toContain("json");
  });

  it("transmet le schéma intégralement, enums et required compris", () => {
    const rich = objectSchema(
      {
        sentiment: { type: "string", enum: ["neutre", "urgent"] },
        intents: { type: "array", items: { type: "string", enum: ["Voirie"] } },
      },
      ["sentiment", "intents"],
    );
    const block = jsonSchemaInstruction(rich);
    expect(block).toContain('"neutre"');
    expect(block).toContain('"Voirie"');
    expect(block).toContain('"required"');
  });

  it("interdit explicitement le texte autour et la clôture markdown", () => {
    const block = jsonSchemaInstruction(schema);
    expect(block).toContain("Aucun texte avant ou après");
    expect(block).toContain("markdown");
  });
});

// ---------------------------------------------------------------------------
// LA RÉGRESSION QUI COMPTE
// ---------------------------------------------------------------------------

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** On scanne le CODE, pas la prose : les en-têtes expliquent ce qu'ils interdisent. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("aucune edge function n'appelle un fournisseur IA en direct", () => {
  const files = tsFilesUnder(join(process.cwd(), "supabase", "functions"));

  // ⚠️ LE GARDE-FOU DE TOUTE LA BASCULE. Depuis le 2026-08-29, la clé du
  // fournisseur et la comptabilité des jetons vivent dans le Socle. Un appel
  // direct rouvrirait un SECOND COMPTEUR : le total par collectivité que la
  // centralisation existe pour produire redeviendrait faux, et personne ne
  // s'en apercevrait — un tableau qui s'affiche n'éveille pas la méfiance.
  it("aucun appel à api.mistral.ai", () => {
    for (const file of files) {
      expect(stripComments(readFileSync(file, "utf8")), file).not.toContain("api.mistral.ai");
    }
  });

  // Le corollaire : plus aucune clé de fournisseur n'est lue dans ce dépôt.
  // `SOCLE_API_KEY` (scope « ai ») est la seule clé IA de Clara désormais.
  it("aucune clé de fournisseur n'est lue", () => {
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source, file).not.toContain("MISTRAL_API_KEY");
      expect(source, file).not.toMatch(/MISTRAL_\w*AGENT_ID/);
    }
  });

  // Le plafond local a été supprimé (migration 20260829140000) : appeler ses
  // RPC échouerait en base, et les recréer rouvrirait le second compteur.
  it("plus aucune RPC de plafond local", () => {
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      expect(source, file).not.toContain("reserve_ai_usage");
      expect(source, file).not.toContain("settle_ai_usage");
    }
  });

  // Le Socle refuse `tools`/`tool_choice` par principe : les renvoyer vaudrait
  // un 400, donc — après traduction — une « erreur interne » à l'utilisateur.
  it("aucun tool-calling résiduel dans les appels IA", () => {
    for (const file of files) {
      expect(stripComments(readFileSync(file, "utf8")), file).not.toContain("tool_choice");
    }
  });
});
