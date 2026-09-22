/**
 * Le motif réel d'un échec d'edge function.
 *
 * `functions.invoke` ne rend qu'un « Edge Function returned a non-2xx status
 * code » : le message que la fonction a pris soin de rédiger — plafond IA
 * atteint, pièce illisible, relais d'envoi absent, utilisateur introuvable —
 * dort dans le corps de la réponse, que seul `error.context` donne encore à
 * lire. Sans cette lecture, l'agent voit la même phrase opaque quelle que soit
 * la panne.
 *
 * Écrit pour l'analyse de courrier, partagé depuis le 2026-09-22 : une
 * réinitialisation de mot de passe échouait en 400 sans que rien ne le dise, et
 * il a fallu descendre dans les journaux GoTrue pour lire le vrai motif
 * (`converting NULL to string is unsupported` sur un compte de démo). Tout
 * appel à `functions.invoke` devrait passer par ici.
 *
 * `details` porte les échecs partiels que seule l'extraction OCR renvoie
 * (`ocr_failures`) : les autres appelants n'y trouvent rien, et c'est sans
 * conséquence.
 */
export async function edgeError(error: unknown, fallback: string) {
  const ctx = (error as { context?: Response }).context;
  const err = new Error(fallback) as Error & {
    status?: number;
    code?: string;
    details?: string[];
  };
  const generic = (error as { message?: string }).message;
  if (generic && !generic.includes("non-2xx")) err.message = generic;
  if (ctx?.status) err.status = ctx.status;
  try {
    // `clone()` : le corps ne se lit qu'une fois, et l'appelant peut vouloir le
    // relire.
    const body = await ctx?.clone().json();
    if (body?.error) err.message = String(body.error);
    if (body?.code) err.code = String(body.code);
    if (Array.isArray(body?.ocr_failures)) err.details = body.ocr_failures.map(String);
  } catch {
    // Corps vide ou illisible : le message générique fera l'affaire.
  }
  return err;
}
