// Assistant IA du tenant : correspondance API Socle → miroir Clara.
// Logique pure, testée par Vitest (src/test/socle/socle-assistant-mirror.test.ts) —
// aucune dépendance Deno.
//
// Le Socle est la source de vérité (`GET /v1/organizations/{id}/assistant`,
// public-api 1.39.0, scope `read`). Clara n'en reprend qu'UN booléen,
// `voice_enabled` → `organizations.ai_voice_enabled` : il décide si la DICTÉE
// vocale d'un courrier est proposée (2026-10-09). Même interrupteur que le mode
// dialogue du portail — c'est la collectivité qui ouvre la voix, parce que la
// dépense se paie sur son crédit.
//
// ⚠️ Couplage hérité du Socle : `voice_enabled` n'y est jamais vrai sous un
// assistant de PORTAIL fermé. Une collectivité qui n'ouvre pas l'assistant de
// son portail ne dicte donc pas dans Clara. À dissocier au Socle si le besoin
// apparaît — pas ici.
//
// Comme `/branding`, l'appel porte sur le `socle_org_id` DU TENANT : la route
// résout l'héritage elle-même.

/** Réponse de `GET /v1/organizations/{id}/assistant` (contrat public Socle). */
export interface SocleAssistantDto {
  enabled?: boolean | null;
  deposit_enabled?: boolean | null;
  voice_enabled?: boolean | null;
}

export interface AssistantMirror {
  ai_voice_enabled: boolean;
}

/**
 * Ce que Clara mirrore. Au doute, FERMÉ : seul un `true` explicite ouvre la
 * voix — une forme inattendue ne doit pas dépenser le crédit d'une collectivité.
 * Le commutateur du Socle est déjà appliqué (`voice_enabled` ⇒ `enabled`), mais
 * le refaire ne coûte rien et protège d'un Socle antérieur.
 */
export function assistantMirror(dto: SocleAssistantDto | null | undefined): AssistantMirror {
  return { ai_voice_enabled: dto?.enabled === true && dto?.voice_enabled === true };
}

/** Champs à réécrire, ou `null` si le miroir est déjà aligné. */
export function planAssistantUpdate(
  current: Partial<AssistantMirror>,
  dto: SocleAssistantDto | null | undefined,
): Partial<AssistantMirror> | null {
  const wanted = assistantMirror(dto);
  return (current.ai_voice_enabled ?? false) === wanted.ai_voice_enabled ? null : wanted;
}

/**
 * Avertissement d'un tenant dont l'assistant n'a pas pu être relu. Journalisé
 * dans `socle_sync_runs.counters.warnings` : il doit dire quoi faire.
 */
export function assistantWarning(organizationName: string, status: number): string {
  const prefix = `assistant IA (${organizationName})`;
  if (status === 403) {
    return `${prefix} : la clé Socle ne porte pas le scope « read » — miroir inchangé.`;
  }
  if (status === 404) {
    return `${prefix} : organisation hors périmètre de la clé, ou API Socle antérieure à la route /assistant (1.39.0) — miroir inchangé.`;
  }
  return `${prefix} : réponse ${status} du Socle — miroir inchangé.`;
}
