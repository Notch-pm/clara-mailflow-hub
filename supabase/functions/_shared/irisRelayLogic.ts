// Logique pure (testable en Vitest) d'une « demande complexe » relayée par un
// agent d'Iris (`iris-courrier`). Aucune dépendance Deno ni Supabase ici — les
// écritures sont celles du dépôt partagé (`portalIntake.ts`).
//
// Ce qui diffère d'un dépôt d'usager (`portalIntakeLogic.ts`) :
//   • le contenu peut n'être QUE des fichiers — un agent qui transmet un
//     dossier scanné n'a rien à écrire, l'analyse IA fera le reste ;
//   • l'objet est facultatif : Iris ne le demande pas, il se tire du texte ;
//   • l'usager a été identifié par l'agent dans le Socle : sa fiche arrive
//     RATTACHÉE (`sender_socle_contact_id`), et ni courriel ni téléphone ne sont
//     exigés — une personne venue au guichet n'en a pas toujours ;
//   • l'agent qui relaie est nommé (`relayed_by_*`) : c'est lui qu'on rappelle.

import { SENDER_CATEGORIES, isUuid, type SenderCategory } from "./portalIntakeLogic.ts";

export const IRIS_MAX_FILES = 5;
export const IRIS_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo
export const IRIS_SUBJECT_MAX = 500;
export const IRIS_BODY_MAX = 50_000;
/** Longueur d'un objet tiré du texte (même règle que `relaySubject` de l'espace élu). */
export const IRIS_DERIVED_SUBJECT_MAX = 90;
export const IRIS_DEFAULT_SUBJECT = "Demande complexe relayée par un agent";

export interface IrisRelayFields {
  subject: string | null;
  body: string | null;
  senderCategory: string | null;
  senderCivilite: string | null;
  senderFirstName: string | null;
  senderLastName: string | null;
  senderEmail: string | null;
  senderPhone: string | null;
  senderSocleContactId: string | null;
  relayedByName: string | null;
  relayedByEmail: string | null;
}

export function irisFieldsFromForm(get: (field: string) => unknown): IrisRelayFields {
  const str = (k: string) => {
    const v = get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  return {
    subject: str("subject"),
    body: str("body"),
    senderCategory: str("sender_category"),
    senderCivilite: str("sender_civilite"),
    senderFirstName: str("sender_first_name"),
    senderLastName: str("sender_last_name"),
    senderEmail: str("sender_email"),
    senderPhone: str("sender_phone"),
    senderSocleContactId: str("sender_socle_contact_id"),
    relayedByName: str("relayed_by_name"),
    relayedByEmail: str("relayed_by_email"),
  };
}

/** Le motif du refus d'un relais, ou `null` s'il est recevable. */
export function irisRelayError(f: IrisRelayFields, files: { name: string; size: number }[]): string | null {
  if (!f.body && files.length === 0) return "Texte ou fichier obligatoire";
  if (f.subject && f.subject.length > IRIS_SUBJECT_MAX) return `Objet trop long (${IRIS_SUBJECT_MAX} caractères au plus)`;
  if (f.body && f.body.length > IRIS_BODY_MAX) return `Texte trop long (${IRIS_BODY_MAX} caractères au plus)`;
  const category = f.senderCategory ?? "citoyen";
  if (!(SENDER_CATEGORIES as readonly string[]).includes(category)) return "Catégorie invalide";
  if (!f.senderLastName) return category === "citoyen" ? "Nom de l'usager obligatoire" : "Raison sociale obligatoire";
  if (f.senderSocleContactId && !isUuid(f.senderSocleContactId)) return "Fiche usager invalide";
  if (!f.relayedByName) return "Agent relais obligatoire";
  if (files.length > IRIS_MAX_FILES) return `Maximum ${IRIS_MAX_FILES} fichiers autorisés`;
  for (const file of files) {
    if (file.size > IRIS_MAX_FILE_SIZE) return `Le fichier "${file.name}" dépasse la limite de 10 Mo`;
  }
  return null;
}

/**
 * L'objet du courrier : celui transmis, sinon la première ligne du texte
 * (coupée au mot), sinon un libellé fixe — un dépôt de fichiers seuls.
 * L'analyse IA pourra le reformuler.
 */
export function irisSubject(f: Pick<IrisRelayFields, "subject" | "body">): string {
  if (f.subject) return f.subject;
  const firstLine = (f.body ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
  if (!firstLine) return IRIS_DEFAULT_SUBJECT;
  if (firstLine.length <= IRIS_DERIVED_SUBJECT_MAX) return firstLine;
  const cut = firstLine.slice(0, IRIS_DERIVED_SUBJECT_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * La ligne `courier_participants` de l'usager. RATTACHÉE au Socle quand Iris
 * l'a identifié — l'agent d'Iris l'a déjà choisi ou créé dans le référentiel,
 * personne n'a à refaire ce geste dans Clara.
 */
export function irisSenderParticipant(f: IrisRelayFields) {
  const category = (f.senderCategory ?? "citoyen") as SenderCategory;
  const isCitoyen = category === "citoyen";
  const firstName = isCitoyen ? f.senderFirstName : null;
  const lastName = f.senderLastName ?? "";
  return {
    role: "sender" as const,
    name: isCitoyen ? [firstName, lastName].filter(Boolean).join(" ") : lastName,
    first_name: firstName,
    last_name: lastName,
    email: f.senderEmail,
    phone: f.senderPhone,
    socle_contact_id: f.senderSocleContactId,
    metadata: {
      category,
      ...(isCitoyen && f.senderCivilite ? { civilite: f.senderCivilite } : {}),
    },
  };
}

/**
 * L'agent d'Iris qui a relayé : participant `cc`, comme l'élu d'un `relaye_elu`
 * — c'est lui qu'un agent de Clara rappelle. Texte libre : jamais un id Iris,
 * qui ne désignerait rien ici.
 */
export function irisAgentParticipant(f: IrisRelayFields) {
  const name = f.relayedByName ?? "";
  return {
    role: "cc" as const,
    name,
    first_name: null,
    last_name: name,
    email: f.relayedByEmail,
    phone: null,
    socle_contact_id: null,
    metadata: { relayed_by_agent: true, app: "iris" },
  };
}
