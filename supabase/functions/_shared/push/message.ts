// Composition d'une notification PUSH — module PUR (aucune dépendance Deno,
// aucun réseau), testé par vitest depuis `src/test/functions/push-message.test.ts`.
//
// ⚠️ CE QUI SORT DE CLARA. Un push s'affiche sur un écran VERROUILLÉ, lisible
// par qui tient le téléphone — un agent dans le bus, son voisin par-dessus
// l'épaule. On s'en tient donc à ce qui rend la carte actionnable :
//
//   ✅ le motif, l'objet du courrier (ou le libellé de l'action), le nom de la
//      collectivité, le permalien vers la fiche (RLS à l'ouverture).
//   ❌ le corps du courrier, son analyse IA, l'expéditeur, les pièces, les
//      notes internes.
//
// L'objet du courrier EST repris : c'est la seule chose qui distingue une
// carte d'une autre, et il quitte déjà Clara par les e-mails de notification
// (`send-assignment-notification`). Le rendre muet ici sans le rendre muet
// là-bas n'achèterait aucune confidentialité — seulement des cartes inutiles.
//
// Le texte voyage chiffré de bout en bout (RFC 8291) : le service de push
// (Google, Mozilla, Apple) ne le lit pas.

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Regroupement côté appareil : une carte par courrier, la plus récente remplace. */
  tag?: string;
}

export interface PushMessageInput {
  type: string;
  /** Le `title` de la ligne `notifications` : déjà une phrase, souvent préfixée. */
  title: string | null;
  resourceId: string | null;
  organizationName: string | null;
  /** Origine de l'application (`APP_ORIGIN`). */
  appUrl: string;
}

/** Titres alignés sur les pastilles de `NotificationBell.tsx`. */
export const PUSH_TITLES: Record<string, string> = {
  new_courier: "Nouveau courrier",
  courier_transferred: "Courrier transféré",
  courier_returned: "Courrier à réorienter",
  courier_reminder: "Relance du service courrier",
  action_assigned: "Action affectée",
  action_unassigned: "Affectation retirée",
};

/** Repli pour un type inconnu — une version ultérieure ne doit pas casser la carte. */
export const PUSH_TITLE_FALLBACK = "Notification";

/**
 * Préfixes que les producteurs posent dans `title` et que la cloche retire à
 * l'affichage (`NotificationBell.tsx`) : la carte porte déjà le motif dans son
 * titre, les répéter dans le corps mangerait la place utile.
 */
const TITLE_PREFIXES: Record<string, RegExp> = {
  courier_transferred: /^Transféré\s*:\s*/,
  courier_returned: /^Renvoyé\s*:\s*/,
  courier_reminder: /^Relance\s*:\s*/,
  action_assigned: /^Action affectée\s*:\s*/,
  action_unassigned: /^Affectation retirée\s*:\s*/,
};

/** Corps par défaut quand la ligne n'a pas de `title` exploitable. */
const EMPTY_BODY: Record<string, string> = {
  new_courier: "Un courrier vient d'arriver.",
  courier_transferred: "Un courrier vous a été transféré.",
  courier_returned: "Un service vous a renvoyé un courrier à réorienter.",
  courier_reminder: "Le service courrier vous relance sur un courrier.",
  action_assigned: "Une action vous a été affectée.",
  action_unassigned: "Une affectation vous a été retirée.",
};

/** Longueur maximale du corps : au-delà, les systèmes tronquent eux-mêmes, mal. */
export const PUSH_BODY_MAX = 140;
/** Au-delà, le nom d'une communauté d'agglomération mangerait tout le titre. */
export const PUSH_ORG_MAX = 40;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Tronque proprement sur un espace, avec une ellipse. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Retire le préfixe de motif — même geste que la cloche. */
export function strippedTitle(type: string, title: string | null): string {
  const raw = text(title);
  const prefix = TITLE_PREFIXES[type];
  return prefix ? raw.replace(prefix, "").trim() : raw;
}

/**
 * Permalien identique à celui de la cloche (`handleNotificationClick`) et des
 * e-mails d'affectation : une action ouvre l'onglet « Actions liées » de la
 * fiche, tout le reste ouvre le courrier dans la boîte aux lettres.
 */
export function notificationPath(type: string, resourceId: string | null): string {
  const id = text(resourceId);
  if (!id) return "/";
  if (type === "action_assigned" || type === "action_unassigned") {
    return `/courrier/${id}?tab=actions`;
  }
  return `/boite-aux-lettres?open=${id}`;
}

/** `appUrl` invalide ⇒ chemin relatif : le service worker le résout sur son origine. */
function permalink(appUrl: string, path: string): string {
  const base = text(appUrl).replace(/\/+$/, "");
  return /^https?:\/\//.test(base) ? `${base}${path}` : path;
}

export function pushMessage(input: PushMessageInput): PushMessage {
  const head = PUSH_TITLES[input.type] ?? PUSH_TITLE_FALLBACK;
  const org = truncate(text(input.organizationName), PUSH_ORG_MAX);
  const subject = strippedTitle(input.type, input.title);
  const body = subject || EMPTY_BODY[input.type] || "Une notification vous attend dans Clara.";
  const id = text(input.resourceId);
  return {
    title: org ? `${head} · ${org}` : head,
    body: truncate(body, PUSH_BODY_MAX),
    url: permalink(input.appUrl, notificationPath(input.type, input.resourceId)),
    ...(id ? { tag: `clara:${id}` } : {}),
  };
}
