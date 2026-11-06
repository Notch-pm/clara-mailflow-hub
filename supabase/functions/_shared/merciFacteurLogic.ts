// Merci Facteur — logique pure du client (aucun réseau, aucun Deno.env) :
// signature, adresses, corps de `sendCourrier`, lecture des réponses.
// Partagée par l'edge function `send-postal-letter` et testée par vitest
// (`src/test/socle/merci-facteur.test.ts`).
//
// Pièges de l'API, à ne JAMAIS « corriger » (voir docs/edge-functions.md) :
//   • `adress` avec un seul « d » ; `adress` et `content` sont des CHAÎNES JSON
//     dans un corps application/x-www-form-urlencoded ;
//   • le vide s'écrit "" à tous les niveaux, jamais [] ni null ;
//   • les 11 clés d'adresse toujours présentes ;
//   • `print_sides` (avec « s ») dans `content.letter`.

export type PostalMode = "simple" | "suivi" | "recommande";

/** Type d'envoi de Clara → `modeEnvoi` de Merci Facteur. */
export const MF_MODE: Record<PostalMode, string> = {
  simple: "normal", // lettre verte
  suivi: "suivi", // lettre suivie
  recommande: "lrar", // recommandé avec accusé de réception papier
};

export const MF_ADDRESS_KEYS = [
  "civilite", "nom", "prenom", "societe",
  "adresse1", "adresse2", "adresse3",
  "cp", "ville", "pays", "reference",
] as const;

export type MfAddress = Record<(typeof MF_ADDRESS_KEYS)[number], string>;

const LIMITS: Partial<Record<keyof MfAddress, number>> = {
  civilite: 12, nom: 70, prenom: 70, societe: 90,
  adresse1: 90, adresse2: 90, adresse3: 90, cp: 12, ville: 70, reference: 30,
};

/** Les 11 clés, tronquées aux limites de l'API ; lève si l'adresse est inutilisable. */
export function normalizeMfAddress(input: Partial<Record<keyof MfAddress, string | null | undefined>>): MfAddress {
  const out = {} as MfAddress;
  for (const k of MF_ADDRESS_KEYS) {
    let v = String(input[k] ?? "").replace(/\s+/g, " ").trim();
    if (k === "reference") v = v.replace(/[^A-Za-z0-9 _-]/g, "");
    const max = LIMITS[k];
    out[k] = max ? v.slice(0, max) : v;
  }
  if (!out.pays) out.pays = "FRANCE";
  if (!out.nom && !out.societe) throw new Error("Adresse postale : nom ou organisation requis.");
  if (!out.cp || !out.ville) throw new Error("Adresse postale incomplète : code postal et ville requis.");
  return out;
}

/**
 * Une adresse en texte libre (« 3 rue X, Bât. B, 27000 Évreux ») en lignes,
 * code postal et ville : la dernière portion « 5 chiffres + ville » donne le
 * code postal ; ce qui précède, les lignes d'adresse (3 au plus).
 */
export function parseFreeTextAddress(text: string | null | undefined): {
  adresse1: string; adresse2: string; adresse3: string; cp: string; ville: string;
} | null {
  if (!text?.trim()) return null;
  const parts = text.split(/[\n,;]+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  let idx = -1;
  let cp = "";
  let ville = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = parts[i].match(/^(?:F-)?(\d{5})\s+(.+)$/i) ?? parts[i].match(/^(.+?)\s+(\d{5})$/);
    if (m) {
      idx = i;
      if (/^\d{5}$/.test(m[1])) { cp = m[1]; ville = m[2]; } else { cp = m[2]; ville = m[1]; }
      break;
    }
  }
  if (idx < 0) return null;
  const lines = parts.slice(0, idx).filter((l) => !/^france$/i.test(l));
  if (lines.length === 0) return null;
  const [adresse1 = "", adresse2 = "", ...rest] = lines;
  return { adresse1, adresse2, adresse3: rest.join(" ").slice(0, 90), cp, ville };
}

/** Fiche du Socle, telle que l'API contacts la sert (champs utiles ici). */
export interface ContactLike {
  contact_type?: string | null;
  civility?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  legal_name?: string | null;
  display_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
}

/** Participant du courrier (instantané du dépôt, ou de la création d'un sortant). */
export interface ParticipantLike {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  organization?: string | null;
  address?: string | null;
  metadata?: Record<string, unknown> | null;
}

const FOREIGN_REASON = "Destinataire hors de France : l'envoi par le prestataire ne le prend pas encore en charge.";
const NO_ADDRESS_REASON =
  "Adresse postale du destinataire introuvable ou incomplète (ligne d'adresse, code postal et ville) : complétez-la sur la fiche du référentiel.";

/**
 * L'adresse du destinataire pour le prestataire. Ordre : la fiche du Socle si
 * elle porte une adresse complète (la source de vérité), sinon l'instantané
 * décomposé du participant (`metadata.address_line1/postal_code/city`), sinon
 * son adresse en texte libre. Lève un message lisible par l'agent.
 */
export function resolveRecipientAddress(
  contact: ContactLike | null | undefined,
  participant: ParticipantLike | null | undefined,
  reference: string,
): MfAddress {
  const civ = contact?.civility === "madame" ? "Madame" : contact?.civility === "monsieur" ? "Monsieur" : "";
  const person = {
    civilite: civ,
    nom: (contact?.last_name ?? participant?.last_name ?? "") || "",
    prenom: (contact?.first_name ?? participant?.first_name ?? "") || "",
    societe: contact?.contact_type && contact.contact_type !== "personne"
      ? (contact.legal_name ?? contact.display_name ?? "")
      : (participant?.organization ?? ""),
    reference,
  };
  if (!person.nom && !person.societe) person.nom = contact?.display_name ?? participant?.name ?? "";

  const country = contact?.country?.trim();
  if (country && !/^(fr|fra|france)$/i.test(country)) throw new Error(FOREIGN_REASON);

  const meta = (participant?.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fromContact = contact?.address_line1?.trim() && contact?.postal_code?.trim() && contact?.city?.trim()
    ? { adresse1: contact.address_line1, adresse2: contact.address_line2 ?? "", adresse3: "", cp: contact.postal_code, ville: contact.city }
    : null;
  const fromSnapshot = !fromContact && str(meta.address_line1) && str(meta.postal_code) && str(meta.city)
    ? { adresse1: str(meta.address_line1), adresse2: str(meta.address_line2), adresse3: "", cp: str(meta.postal_code), ville: str(meta.city) }
    : null;
  const lines = fromContact ?? fromSnapshot ?? parseFreeTextAddress(participant?.address);
  if (!lines) throw new Error(NO_ADDRESS_REASON);
  try {
    return normalizeMfAddress({ ...person, ...lines, pays: "FRANCE" });
  } catch {
    throw new Error(NO_ADDRESS_REASON);
  }
}

/** HMAC-SHA256(serviceId + ts), clé = secret key, en hexadécimal minuscule. */
export async function mfSignature(serviceId: string, secretKey: string, ts: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secretKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${serviceId}${ts}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Base64 par tranches : une conversion d'un seul tenant déborde la pile. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** La référence stable d'un courrier : la même d'une tentative à l'autre. */
export function mfAntidoublon(courierId: string): string {
  return `clara-${courierId}`;
}

export interface MfSendInput {
  idUser: string;
  exp: MfAddress;
  dest: MfAddress;
  pdfBase64: string;
  mode: PostalMode;
  designation?: string | null;
  finalFilename?: string | null;
  antidoublon: string;
}

/** Le corps form-urlencoded de `sendCourrier`. */
export function buildSendCourrierBody(i: MfSendInput): URLSearchParams {
  const letter: Record<string, unknown> = {
    files: "",
    base64files: [i.pdfBase64.replace(/^data:.*?;base64,/, "").replace(/\s+/g, "")],
    print_sides: "recto",
  };
  if (i.finalFilename) letter.final_filename = i.finalFilename.replace(/\.pdf$/i, "").slice(0, 50);
  const body = new URLSearchParams();
  body.set("idUser", String(i.idUser));
  body.set("adress", JSON.stringify({ exp: i.exp, dest: [i.dest] }));
  body.set("content", JSON.stringify({ letter, photo: "", card: "" }));
  body.set("modeEnvoi", MF_MODE[i.mode]);
  if (i.designation) body.set("designation", i.designation.slice(0, 50));
  body.set("antidoublon", i.antidoublon.slice(0, 200));
  return body;
}

/** Le code ou le texte d'erreur d'une réponse (`error` est une chaîne ou `{code, text}`). */
export function mfErrorText(error: unknown): string {
  if (!error) return "Erreur inconnue du prestataire.";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const e = error as { code?: unknown; text?: unknown; message?: unknown };
    const parts = [e.code, e.text ?? e.message].filter((x) => typeof x === "string" && x) as string[];
    if (parts.length) return parts.join(" — ");
  }
  return JSON.stringify(error).slice(0, 300);
}

export interface MfSendOk {
  envoiId: string | null;
  priceHt: number | null;
  priceTtc: number | null;
  nbPages: number | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Lit une réponse `success: true` (envoi_id peut être un entier ou un tableau). */
export function readSendOk(data: Record<string, unknown>): MfSendOk {
  const raw = data.envoi_id;
  const ids = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const price = (data.price as { total?: { ht?: unknown; ttc?: unknown } } | undefined)?.total;
  const resume = data.resume as { nb_page?: unknown } | undefined;
  return {
    envoiId: ids.length ? ids.map(String).join(",") : null,
    priceHt: num(price?.ht),
    priceTtc: num(price?.ttc),
    nbPages: num(resume?.nb_page),
  };
}

/**
 * Issue d'une suite de tentatives de `sendCourrier`, pour décider du statut :
 *   • une réponse `success: true` → `sent` ;
 *   • une réponse `success: false` alors qu'aucune tentative n'est restée sans
 *     réponse → `failed` (rien n'est parti, rejouable) ;
 *   • une réponse `success: false` APRÈS une tentative sans réponse lisible →
 *     `to_verify` : le refus peut être l'antidoublon qui protège un premier
 *     envoi passé. On ne déclare rien, un humain tranche dans Merci Facteur Pro ;
 *   • toutes les tentatives sans réponse → `to_verify`.
 */
export type MfAttempt = { kind: "ok"; data: Record<string, unknown> } | { kind: "refused"; error: string } | { kind: "unknown"; reason: string };

export function decideOutcome(attempts: MfAttempt[]):
  | { status: "sent"; ok: MfSendOk }
  | { status: "failed"; error: string }
  | { status: "to_verify"; error: string } {
  let uncertain = false;
  for (const a of attempts) {
    if (a.kind === "ok") return { status: "sent", ok: readSendOk(a.data) };
    if (a.kind === "refused") {
      return uncertain
        ? { status: "to_verify", error: `Issue incertaine puis refus du prestataire (${a.error}) : vérifier dans Merci Facteur Pro.` }
        : { status: "failed", error: a.error };
    }
    uncertain = true;
  }
  const last = attempts[attempts.length - 1];
  return {
    status: "to_verify",
    error: `Aucune réponse lisible du prestataire${last && last.kind === "unknown" ? ` (${last.reason})` : ""} : vérifier dans Merci Facteur Pro.`,
  };
}

// ─── Webhook ────────────────────────────────────────────────────────────────
// Merci Facteur pousse les événements (imprimé, distribué, NPAI, AR signé) en
// POST, avec deux champs : `event` (type, utilisateur, date) et `detail`
// (tableau des courriers concernés). Le format exact n'est pas dans la spec
// OpenAPI : la lecture est tolérante (JSON ou formulaire, champs en objet ou
// en chaîne JSON) et conserve l'événement brut.

export interface MfWebhookItem {
  envoiId: string;
  refCourrier: string | null;
  status: string | null;
}

export interface MfWebhook {
  eventType: string;
  eventDate: string | null;
  items: MfWebhookItem[];
}

function maybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return v;
  try { return JSON.parse(t); } catch { return v; }
}

function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return null;
}

/** Lit un webhook ; `null` s'il ne porte ni type d'événement ni courrier reconnaissable. */
export function parseMfWebhook(body: Record<string, unknown>): MfWebhook | null {
  const rawEvent = maybeJson(body.event);
  const event = (rawEvent && typeof rawEvent === "object" ? rawEvent : { type: rawEvent }) as Record<string, unknown>;
  const eventType = pick(event, ["type", "event", "name", "code"]) ?? (typeof rawEvent === "string" ? rawEvent : null);
  const eventDate = pick(event, ["date", "datetime", "created_at"]);
  const rawDetail = maybeJson(body.detail);
  const list = Array.isArray(rawDetail) ? rawDetail : rawDetail && typeof rawDetail === "object" ? [rawDetail] : [];
  const items: MfWebhookItem[] = [];
  for (const d of list) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const envoiId = pick(o, ["id_envoi", "idEnvoi", "envoi_id"]);
    if (!envoiId) continue;
    items.push({ envoiId, refCourrier: pick(o, ["ref_courrier", "refCourrier"]), status: pick(o, ["statut", "status", "lastState"]) });
  }
  if (!eventType || items.length === 0) return null;
  return { eventType, eventDate, items };
}

/** Libellé lisible d'un événement ; inconnu ⇒ le type brut. */
export function mfEventLabel(eventType: string): string {
  const t = eventType.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/npai|non.?distrib|retour/.test(t)) return "Non distribué (NPAI)";
  if (/\bar\b|accuse|avis.?de.?reception|signe/.test(t)) return "Accusé de réception signé";
  if (/distrib/.test(t)) return "Distribué";
  if (/imprim|print/.test(t)) return "Courrier imprimé";
  if (/poste|la.?poste|remis|depos/.test(t)) return "Remis à La Poste";
  return eventType.slice(0, 80);
}

/** Comparaison à temps constant (jeton du webhook). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
