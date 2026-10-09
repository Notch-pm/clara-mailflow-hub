// Tâches (actions internes affectées) : logique pure partagée entre les edge
// functions `action-task-mail` / `action-task-public` et l'écran (tests Vitest
// par chemin relatif). Aucun import Deno ici.

/** Longueur maximale de la note laissée en marquant une tâche terminée. */
export const TASK_COMPLETION_NOTE_MAX = 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidTaskEmail(value: string | null | undefined): boolean {
  return !!value && EMAIL_RE.test(value.trim());
}

/** Jeton du lien envoyé par mail : 32 octets aléatoires, base64url sans bourrage. */
export function generateTaskToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Forme attendue d'un jeton — filtre ce qui ne peut pas en être un avant toute requête. */
export function isWellFormedTaskToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** SHA-256 hexadécimal : seule forme sous laquelle un jeton est stocké. */
export async function hashTaskToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Note de clôture nettoyée : vide → null, tronquée à la limite. */
export function normalizeCompletionNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, TASK_COMPLETION_NOTE_MAX) : null;
}

/** Objet du mail. La référence du courrier seulement : jamais son objet (contenu minimal). */
export function taskMailSubject(mode: "notify" | "remind", taskTitle: string): string {
  return mode === "remind" ? `Relance — tâche : ${taskTitle}` : `Tâche à réaliser : ${taskTitle}`;
}
