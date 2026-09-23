// Libellé et détail d'un événement de courrier (`courier_events`) — partagé par
// l'onglet Historique du poste de travail et le bas de page du courrier dans
// l'espace élu, pour qu'un même fait se lise de la même façon partout.

export const COURIER_EVENT_LABELS: Record<string, string> = {
  courier_created: "Création du courrier",
  instruction_started: "Début d'instruction",
  note_added: "Note ajoutée",
  note_updated: "Note modifiée",
  note_deleted: "Note supprimée",
  document_added: "Document ajouté",
  document_updated: "Document modifié",
  document_deleted: "Document supprimé",
  service_changed: "Changement de service",
  service_transferred: "Transfert de service",
  state_changed: "Changement d'état",
  reply_created: "Réponse créée",
  reply_deleted: "Réponse supprimée",
  reply_state_changed: "Changement d'état de la réponse",
  reply_sent: "Réponse envoyée",
  reply_signed: "Réponse signée",
  reply_unsigned: "Signature retirée",
  reply_send_reset: "Envoi annulé",
  ticket_created: "Ticket créé",
  ticket_updated: "Ticket mis à jour",
  ticket_deleted: "Ticket supprimé",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- payload libre de courier_events
type Payload = Record<string, any> | null | undefined;

export function describeCourierEvent(type: string, payload: Payload): { title: string; detail: string | null } {
  const p = payload ?? {};
  let detail: string | null = null;
  switch (type) {
    case "service_changed":
      detail = p.from ? `${p.from ?? "—"} → ${p.to ?? "—"}` : p.to ? `→ ${p.to}` : null;
      break;
    case "service_transferred":
      detail = p.from && p.to ? `${p.from} → ${p.to}` : p.to ?? null;
      break;
    case "state_changed":
      detail = p.to_name ? `${p.from_name ?? "—"} → ${p.to_name}` : null;
      break;
    case "note_added":
    case "note_updated":
      if (p.preview) detail = `« ${p.preview} »`;
      break;
    case "document_added":
    case "document_deleted":
    case "document_updated":
      detail = [p.file_name, p.document_type].filter(Boolean).join(" · ") || null;
      break;
  }
  return { title: COURIER_EVENT_LABELS[type] ?? type, detail };
}
