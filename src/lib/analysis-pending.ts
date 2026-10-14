/**
 * Propositions de l'analyse IA qui attendent encore une décision de l'agent.
 *
 * Le détail de l'analyse (titre suggéré, tags proposés, organisation proposée)
 * vit derrière « Détail de l'analyse », sur la fiche courrier. Sans signal, une
 * proposition utile restait invisible : ce décompte alimente la pastille du
 * bouton. Un élément compte tant qu'il n'est pas appliqué — titre différent de
 * l'objet, tag absent du courrier, organisation que l'agent peut affecter ou
 * vers laquelle il peut transférer.
 */
import { serviceSuggestionKind } from "@/lib/service-suggestion";

export type PendingKind = "title" | "tag" | "service";

export interface PendingItem {
  kind: PendingKind;
  /** Libellé court, pour l'infobulle de la pastille. */
  label: string;
}

export interface PendingAnalysisArgs {
  analysis: {
    suggested_subject: string | null;
    intents: string[];
    suggested_socle_organization_id: string | null;
    suggested_service_name?: string | null;
  } | null;
  /** Objet actuel du courrier. */
  subject: string | null;
  /** Tags déjà posés sur le courrier. */
  appliedTags: readonly string[];
  /** Pour l'organisation : mêmes règles que `ServiceSuggestion`. */
  service: {
    currentId: string | null;
    isInitialState: boolean;
    assignableIds: readonly string[];
    transferableIds: readonly string[];
  };
}

export function pendingAnalysisItems({ analysis, subject, appliedTags, service }: PendingAnalysisArgs): PendingItem[] {
  if (!analysis) return [];
  const items: PendingItem[] = [];

  const suggested = analysis.suggested_subject?.trim();
  if (suggested && suggested !== (subject ?? "").trim()) {
    items.push({ kind: "title", label: "Titre proposé" });
  }

  const applied = new Set(appliedTags.map((t) => t.toLowerCase()));
  for (const tag of analysis.intents ?? []) {
    if (!applied.has(tag.toLowerCase())) items.push({ kind: "tag", label: `Tag « ${tag} »` });
  }

  const kind = serviceSuggestionKind({
    suggestedId: analysis.suggested_socle_organization_id,
    currentId: service.currentId,
    isInitialState: service.isInitialState,
    assignableIds: service.assignableIds,
    transferableIds: service.transferableIds,
  });
  if (kind === "assign" || kind === "reassign" || kind === "transfer") {
    items.push({
      kind: "service",
      label: `Organisation « ${analysis.suggested_service_name ?? "proposée"} »`,
    });
  }

  return items;
}
