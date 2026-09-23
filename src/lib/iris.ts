// Affichage des demandes déposées dans Iris.
//
// Les CLÉS de statut sont contractuelles (liste fermée servie par l'API Iris) ;
// les LIBELLÉS, eux, ne le sont pas — c'est à Clara de les écrire pour ses
// agents. On ne dérive donc jamais un affichage d'une chaîne inconnue : un
// statut hors liste s'affiche tel quel plutôt que d'être traduit à tort.

export const IRIS_STATUS_LABELS: Record<string, string> = {
  a_traiter: "À traiter",
  en_instruction: "En instruction",
  en_attente: "En attente",
  annulee: "Annulée",
  resolue_positive: "Accordée",
  resolue_negative: "Refusée",
  archivee: "Archivée",
};

/** Statuts qui closent la demande — utile pour la teinte du badge. */
const CLOSED = new Set(["annulee", "resolue_positive", "resolue_negative", "archivee"]);

export function irisStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return IRIS_STATUS_LABELS[status] ?? status;
}

/** Variante de badge shadcn : une demande close se distingue d'une demande en cours. */
export function irisStatusVariant(
  status: string | null | undefined,
): "default" | "secondary" | "outline" | "destructive" {
  if (!status) return "outline";
  if (status === "resolue_negative" || status === "annulee") return "destructive";
  if (CLOSED.has(status)) return "secondary";
  return "default";
}

/**
 * Canal d'arrivée d'une demande, d'après le code de sa source Iris. Le registre
 * des sources est ouvert (chaque collectivité peut en déclarer) : un code
 * inconnu s'affiche tel quel.
 */
const IRIS_SOURCE_LABELS: Record<string, string> = {
  clara: "Courrier",
  iris: "Guichet",
  "portail-citoyen": "Portail",
};

export function irisSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return IRIS_SOURCE_LABELS[source] ?? source;
}
