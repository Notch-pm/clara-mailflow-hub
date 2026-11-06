// Le mode d'envoi d'un courrier sortant et ce qu'il exige du destinataire.
// Pur : partagé par la création et le composeur, testé par vitest.

import {
  POSTED_DATE_REASON,
  POSTED_MODE_REASON,
  POSTED_TIME_REQUIRED_REASON,
} from "../../supabase/functions/_shared/outboundInitiativeGuard";

export type OutboundChannel = "email" | "paper";

/** Ce que l'on sait du destinataire : une fiche du référentiel ou son instantané. */
export interface OutboundRecipientInfo {
  email?: string | null;
  address_line1?: string | null;
  postal_code?: string | null;
  city?: string | null;
  preferred_channel?: "email" | "telephone" | "courrier" | null;
}

/**
 * Le mode proposé d'office : celui que l'usager préfère s'il est praticable,
 * sinon le courriel s'il a une adresse électronique, sinon le courrier.
 */
export function defaultChannel(r: OutboundRecipientInfo | null | undefined): OutboundChannel {
  if (!r) return "paper";
  if (r.preferred_channel === "courrier") return "paper";
  if (r.preferred_channel === "email" && emailBlocker(r) === null) return "email";
  return emailBlocker(r) === null ? "email" : "paper";
}

/** Pourquoi on ne peut pas écrire à ce destinataire par courriel, ou `null`. */
export function emailBlocker(r: OutboundRecipientInfo | null | undefined): string | null {
  if (!r?.email?.trim()) return "Ce destinataire n'a pas d'adresse électronique dans le référentiel.";
  return null;
}

/** Pourquoi on ne peut pas lui écrire par courrier postal, ou `null`. */
export function postalBlocker(r: OutboundRecipientInfo | null | undefined): string | null {
  const missing = [
    !r?.address_line1?.trim() && "l'adresse",
    !r?.postal_code?.trim() && "le code postal",
    !r?.city?.trim() && "la ville",
  ].filter(Boolean) as string[];
  if (missing.length === 0) return null;
  return `Adresse postale incomplète : il manque ${joinFr(missing)}.`;
}

/** Le pavé d'adresse, ligne par ligne (lignes vides retirées). */
export function addressLines(r: (OutboundRecipientInfo & { address_line2?: string | null }) | null | undefined): string[] {
  if (!r) return [];
  const cityLine = [r.postal_code?.trim(), r.city?.trim()].filter(Boolean).join(" ");
  return [r.address_line1?.trim(), r.address_line2?.trim(), cityLine].filter((l): l is string => !!l);
}

function joinFr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

/** Aujourd'hui en date locale (`YYYY-MM-DD`) : date proposée et borne haute de « posté le ». */
export function todayIso(now: Date = new Date()): string {
  const d = now;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** L'heure locale (`HH:MM`) : heure proposée pour « posté à ». */
export function nowTimeIso(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

// ─── Envoi postal : type d'envoi et horodatage ─────────────────────────

/**
 * Le type d'envoi d'un courrier postal (`metadata.posted_mode`) : lettre verte,
 * lettre suivie, ou recommandé avec accusé de réception. Mêmes valeurs en base
 * (garde `couriers_enforce_outbound_initiative`, `postal_sendings.mode`).
 */
export type PostalMode = "simple" | "suivi" | "recommande";

export const POSTAL_MODES: { value: PostalMode; label: string; short: string }[] = [
  { value: "simple", label: "Simple", short: "Simple" },
  { value: "suivi", label: "Suivie", short: "Suivie" },
  { value: "recommande", label: "Recommandé avec accusé de réception", short: "Recommandé AR" },
];

export function isPostalMode(mode: unknown): mode is PostalMode {
  return POSTAL_MODES.some((m) => m.value === mode);
}

/** Libellé court (badge, historique), ou `null` pour une valeur inconnue. */
export function postalModeLabel(mode: string | null | undefined): string | null {
  return POSTAL_MODES.find((m) => m.value === mode)?.short ?? null;
}

/** Qui poste la lettre : le prestataire (envoi papier réel), ou l'agent lui-même. */
export type PostalVia = "provider" | "self";

/** Date et heure locales saisies → horodatage ISO (UTC), ou `null` si illisibles. */
export function postedAtIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Pourquoi la déclaration d'envoi postal est refusée, ou `null`. Mêmes règles
 * et mêmes mots que la base (`couriers_enforce_outbound_initiative`) : date et
 * heure exigées, ni futures, ni antérieures à la création ; type d'envoi exigé.
 */
export function postDeclarationError(
  input: { date: string; time: string; mode: PostalMode | null | undefined; via?: PostalVia },
  createdAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  // Par le prestataire, l'horodatage est celui de l'acceptation de la lettre :
  // rien à saisir, seul le type d'envoi est exigé.
  if (input.via === "provider") return isPostalMode(input.mode) ? null : POSTED_MODE_REASON;
  const iso = postedAtIso(input.date, input.time);
  if (!iso) return POSTED_TIME_REQUIRED_REASON;
  const at = new Date(iso).getTime();
  // Saisie à la minute : on compare la création tronquée à la minute.
  const created = createdAt ? Math.floor(new Date(createdAt).getTime() / 60_000) * 60_000 : null;
  if (at > now.getTime() + 60_000 || (created !== null && at < created)) return POSTED_DATE_REASON;
  if (!isPostalMode(input.mode)) return POSTED_MODE_REASON;
  return null;
}

/** « 06/11/2026 à 14:32 » ; une déclaration ancienne (date seule) garde la date seule. */
export function formatPostedAt(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}
