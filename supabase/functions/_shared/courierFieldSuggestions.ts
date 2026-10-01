// Fragments partagés entre `extract-courier-info` et `analyze-courier` pour la
// suggestion de champs structurés (titre, expéditeur, destinataire). Le service
// instructeur a son propre module depuis le 2026-10-01 (`serviceSuggestion.ts`) :
// il se choisit dans un catalogue décrit, par identifiant
// à partir du contenu d'un courrier. Les deux edge functions utilisent le même
// agent Mistral et le même idiome de tool-calling : toutes les propriétés sont
// `required`, avec une chaîne vide comme sentinelle "absent" (plus fiable que
// `null`/optionnel avec cette API de tool-calling).

import { cleanCivility, type SenderCivility } from "./senderMatchLogic.ts";

export const SUGGESTED_FIELDS_PROPERTIES: Record<string, { type: "string"; description: string }> = {
  suggested_subject: {
    type: "string",
    description: "Titre court et factuel résumant l'objet du courrier — une proposition, pas une copie du corps (chaîne vide si indéterminable)",
  },
  sender_civility: {
    type: "string",
    description: "Civilité de l'expéditeur : \"madame\", \"monsieur\", ou chaîne vide si le courrier ne l'indique pas",
  },
  sender_first_name: { type: "string", description: "Prénom de l'expéditeur (chaîne vide si absent)" },
  sender_last_name: { type: "string", description: "Nom de l'expéditeur (chaîne vide si absent)" },
  sender_email: { type: "string", description: "Email de l'expéditeur (chaîne vide si absent)" },
  sender_phone: { type: "string", description: "Téléphone de l'expéditeur (chaîne vide si absent)" },
  recipient_name: { type: "string", description: "Nom du destinataire (chaîne vide si absent)" },
};

export const SUGGESTED_FIELDS_KEYS = Object.keys(SUGGESTED_FIELDS_PROPERTIES);

export const SUGGESTED_FIELDS_PROMPT_RULES = `- suggested_subject : titre court et factuel résumant l'objet du courrier. Une proposition, pas une copie du corps.
- Pour le destinataire (recipient_name) : la personne ou le service à qui s'adresse le courrier (ex: "Monsieur le Maire", "Direction des Travaux").
- Pour l'expéditeur (sender_*) : l'auteur/signataire du courrier. Prénom et nom dans leurs champs respectifs, jamais réunis dans sender_last_name.
- sender_civility : seulement si le courrier l'indique (« Madame X », « M. X », formule de signature) — ne la déduis pas du prénom.`;

/** Normalise la sentinelle "chaîne vide" du tool-calling en `null`. */
export function nullIfEmpty(v: string | null | undefined): string | null {
  return v?.trim() ? v.trim() : null;
}

/** Valide une valeur suggérée par le LLM contre une liste de noms autorisés
 *  (insensible à la casse). Retourne le nom exact de la liste, ou `null`. */
export function validateAgainstNames(value: string | null | undefined, names: string[]): string | null {
  if (!value?.trim()) return null;
  const lower = value.trim().toLowerCase();
  return names.find((n) => n.toLowerCase() === lower) ?? null;
}

export interface RawSenderFields {
  sender_civility?: string;
  sender_first_name?: string;
  sender_last_name?: string;
  sender_email?: string;
  sender_phone?: string;
}

export interface CleanSender {
  civility: SenderCivility | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

export function cleanSenderFields(raw: RawSenderFields): CleanSender {
  return {
    civility: cleanCivility(raw.sender_civility),
    first_name: nullIfEmpty(raw.sender_first_name),
    last_name: nullIfEmpty(raw.sender_last_name),
    email: nullIfEmpty(raw.sender_email),
    phone: nullIfEmpty(raw.sender_phone),
  };
}

export function hasSenderData(sender: CleanSender): boolean {
  return !!(sender.first_name || sender.last_name || sender.email || sender.phone);
}
