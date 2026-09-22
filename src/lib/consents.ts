/**
 * Consentements RGPD côté écran.
 *
 * Le catalogue (deux finalités, phrases, garde serveur) vit dans
 * `supabase/functions/_shared/consents/catalog.ts` : un seul module, partagé
 * avec les edge functions par chemin relatif (convention Clara, comme les
 * tests de `src/test/socle/`), pour que l'écran affiche EXACTEMENT la phrase
 * que le serveur consignera.
 *
 * Ce qui est affiché ici est l'état du RÉFÉRENTIEL : le Socle est propriétaire
 * du consentement d'une personne, et le dérive du recueil le plus récent.
 * Clara ne le modifie que par `POST /v1/contacts/{id}/consents` (report d'une
 * trace de dépôt, ou consignation manuelle par un agent).
 */
import type { SocleConsent, SocleContact } from "@/services/socleContactService";
import {
  CONSENTS,
  consentDef,
  consentStatement,
  isConsentKind,
  type ConsentKind,
} from "../../supabase/functions/_shared/consents/catalog";

export {
  CONSENTS,
  DEFAULT_ORGANISM,
  consentDef,
  consentStatement,
  consentsSatisfied,
  defaultConsentAnswers,
  isConsentKind,
  parseConsentRecords,
  type ConsentDef,
  type ConsentKind,
  type ConsentRecord,
} from "../../supabase/functions/_shared/consents/catalog";

/** État d'un consentement du catalogue pour une fiche donnée. */
export interface ConsentView {
  kind: ConsentKind;
  label: string;
  purpose: string;
  required: boolean;
  granted: boolean;
  /** Recueil le plus récent (ISO), null si la question n'a jamais été posée. */
  at: string | null;
  /**
   * Jamais recueilli. ⚠️ À distinguer d'un refus : une fiche antérieure au
   * 2026-09-13, ou jamais passée par un dépôt, porte `granted: false` sans que
   * personne ne lui ait rien demandé. Afficher « Refusé » serait un mensonge —
   * et sur un consentement, un mensonge coûteux.
   */
  neverCollected: boolean;
  /** Phrase soumise au dernier recueil ; celle du catalogue à défaut. */
  statement: string;
}

/** Lecture de l'état courant, dans l'ordre du catalogue (l'obligatoire d'abord). */
export function consentViews(contact: SocleContact, organismName?: string | null): ConsentView[] {
  const history = parseSocleConsents(contact.consents);
  return CONSENTS.map((def) => {
    const granted = def.kind === "traitement"
      ? contact.consent_traitement === true
      : contact.consent_partage === true;
    const at = (def.kind === "traitement" ? contact.consent_traitement_at : contact.consent_partage_at) ?? null;
    const last = history.find((h) => h.kind === def.kind);
    return {
      kind: def.kind,
      label: def.label,
      purpose: def.purpose,
      required: def.required,
      granted,
      at,
      // Le référentiel peut porter l'état sans que l'historique ait été chargé
      // (liste, rapprochement) : la DATE seule tranche, jamais l'historique.
      neverCollected: at === null,
      statement: last?.statement ?? consentStatement(def.kind, organismName),
    };
  });
}

/** Une ligne d'historique, prête à afficher. */
export interface ConsentHistoryRow {
  kind: ConsentKind;
  label: string;
  granted: boolean;
  at: string | null;
  /** Application qui a recueilli — telle quelle, le catalogue ne lui appartient pas. */
  source: string | null;
  /** Dépôt d'origine tel que l'application le désigne (id de courrier, référence libre). */
  reference: string | null;
  statement: string;
}

/**
 * Historique relu du Socle — tolérant : un `kind` hors catalogue (une version
 * ultérieure du référentiel, un partenaire inventif) est IGNORÉ plutôt que
 * rendu tel quel, pour qu'aucun écran ne se retrouve à afficher une phrase
 * dont il ne sait pas ce qu'elle engage.
 */
export function parseSocleConsents(rows: SocleConsent[] | undefined | null): ConsentHistoryRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ConsentHistoryRow[] = [];
  for (const row of rows) {
    if (!isConsentKind(row?.kind)) continue;
    const def = consentDef(row.kind)!;
    out.push({
      kind: row.kind,
      label: def.label,
      granted: row.granted === true,
      at: row.collected_at ?? null,
      source: row.source_app && row.source_app.trim() !== "" ? row.source_app.trim() : null,
      reference: row.source_reference && row.source_reference.trim() !== "" ? row.source_reference.trim() : null,
      statement: row.statement && row.statement.trim() !== ""
        ? row.statement.trim()
        : consentStatement(row.kind),
    });
  }
  // Le plus récent d'abord — le Socle trie déjà ainsi, mais un écran ne se
  // repose pas sur l'ordre d'une réponse HTTP.
  return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/** Résumé d'une carte : « Traitement accordé · Partage refusé », ou l'absence. */
export function consentsSummary(views: ConsentView[]): string {
  if (views.every((v) => v.neverCollected)) {
    return "Aucun consentement recueilli à ce jour";
  }
  return views
    .map((v) => v.neverCollected
      ? `${v.label} : jamais demandé`
      : `${v.label} : ${v.granted ? "accordé" : "refusé"}`)
    .join(" · ");
}
