/**
 * Objet d'un courrier relayé par un élu.
 *
 * L'élu ne saisit pas d'objet — on ne lui demande que la requête de l'usager.
 * Les listes et la boîte aux lettres ont pourtant besoin d'un titre : on prend
 * la première ligne non vide de la requête, coupée à un mot entier. Le service
 * courrier le corrige au besoin (l'analyse en propose un, applicable d'un clic).
 */
export const RELAY_SUBJECT_MAX = 90;

export function relaySubject(request: string, max: number = RELAY_SUBJECT_MAX): string {
  const firstLine =
    request
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/\s+/g, " "))
      .find((l) => l.length > 0) ?? "";
  if (!firstLine) return "Demande relayée par un élu";
  if (firstLine.length <= max) return firstLine;
  const cut = firstLine.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Pas de coupe au mot si elle sacrifie plus d'un tiers : mieux vaut un mot tronqué.
  const base = lastSpace > max * 0.66 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,;:.!?-]+$/, "")}…`;
}
