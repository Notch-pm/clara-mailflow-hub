// Libellés du fil d'une demande Iris (activité, interventions). Iris sert des
// types et des détails bruts (contrat 2.5.0) ; c'est à Clara d'écrire les
// phrases. Un type inconnu s'affiche tel quel plutôt que d'être traduit à tort.

import type { IrisTimelineEvent } from "../../supabase/functions/_shared/iris-contact-requests";
import { irisSourceLabel, irisStatusLabel } from "@/lib/iris";

const day = (v: string | number | null | undefined) =>
  typeof v === "string" && v ? new Date(v).toLocaleDateString("fr-FR") : null;
const text = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : String(v));
const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(" · ") || null;

export function describeIrisEvent(event: Pick<IrisTimelineEvent, "type" | "detail">): { title: string; detail: string | null } {
  const d = event.detail ?? {};
  switch (event.type) {
    case "created":
      return { title: "Demande reçue", detail: irisSourceLabel(text(d.source)) };
    case "request_created_from_procedure":
      return { title: "Demande créée depuis la démarche", detail: null };
    case "status_changed":
      return {
        title: "Changement de statut",
        detail: join(`${irisStatusLabel(text(d.from)) ?? "—"} → ${irisStatusLabel(text(d.to)) ?? "—"}`, text(d.motif)),
      };
    case "assigned":
      return { title: "Affectation", detail: text(d.to) };
    case "transferred":
      return { title: "Transfert", detail: d.from && d.to ? `${d.from} → ${d.to}` : text(d.to) };
    case "intervention_requested":
      return { title: "Intervention demandée", detail: join(text(d.intervenant), d.requested_for ? `pour le ${day(d.requested_for)}` : null) };
    case "intervention_completed":
      return { title: "Intervention réalisée", detail: join(text(d.intervenant), d.completed_on ? `le ${day(d.completed_on)}` : null) };
    case "piece_ajoutee":
      return { title: "Pièce ajoutée", detail: text(d.file_name) };
    case "piece_qualifiee":
      return { title: "Pièce vérifiée", detail: join(text(d.file_name), d.compliance === "conforme" ? "conforme" : d.compliance ? "non conforme" : null) };
    case "form_data_updated":
      return { title: "Formulaire modifié", detail: null };
    default:
      return { title: event.type, detail: null };
  }
}

export const INTERVENTION_STATUS_LABELS: Record<string, string> = {
  demandee: "Demandée",
  realisee: "Réalisée",
};

export function interventionStatusLabel(status: string): string {
  return INTERVENTION_STATUS_LABELS[status] ?? status;
}

export { day as formatIrisDay };
