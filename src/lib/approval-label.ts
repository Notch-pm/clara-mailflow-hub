/**
 * Libellé du bouton qui vise ou signe une réponse, puis suit sa transition.
 *
 * Le bouton porte le nom de la transition, comme tous les autres : c'est le
 * mot de la collectivité. Mais viser ou signer engage le nom de qui clique —
 * et une signature ne se reprend pas. Quand le nom de la transition ne dit pas
 * le geste (« Terminer » depuis « À signer »), on le dit devant :
 * « Signer · Terminer ». Sans transition suivante, le geste seul.
 */

export type ApprovalGesture = "visa" | "sign";

const GESTURE_WORD: Record<ApprovalGesture, string> = { visa: "Viser", sign: "Signer" };

// Début de mot, accents retirés : « Viser », « Visa du DGS », « Signature »
// disent le geste ; « Réviser » ou « Consigner » ne le disent pas.
const GESTURE_PATTERN: Record<ApprovalGesture, RegExp> = { visa: /\bvis/, sign: /\bsign/ };

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function approvalLabel(gesture: ApprovalGesture, transitionName: string | null | undefined): string {
  const name = transitionName?.trim();
  if (!name) return GESTURE_WORD[gesture];
  if (GESTURE_PATTERN[gesture].test(normalize(name))) return name;
  return `${GESTURE_WORD[gesture]} · ${name}`;
}
