/**
 * Tâches (actions internes affectées) côté écran.
 *
 * Les règles vivent dans `supabase/functions/_shared/actionTask.ts`, partagé
 * avec les edge functions `action-task-mail` / `action-task-public` par chemin
 * relatif (même convention que `src/lib/consents.ts`) : l'écran valide une
 * adresse et borne une note exactement comme le serveur.
 */
export {
  isValidTaskEmail,
  TASK_COMPLETION_NOTE_MAX,
} from "../../supabase/functions/_shared/actionTask";

/** Libellé de l'agent affecté d'une tâche : nom saisi, sinon l'adresse. */
export function taskAssigneeLabel(t: {
  assignee_name: string | null;
  assignee_email: string | null;
}): string {
  return t.assignee_name?.trim() || t.assignee_email?.trim() || "—";
}
