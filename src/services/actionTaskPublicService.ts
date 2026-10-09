// Page publique /tache/:token — appels à l'edge function `action-task-public`,
// sans session : l'autorisation est le jeton du lien reçu par mail.

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/action-task-public`;

export interface PublicTask {
  title: string | null;
  description: string | null;
  status: "open" | "done";
  completed_at: string | null;
  completed_via: "app" | "lien" | null;
  completion_note: string | null;
  assignee_name: string | null;
  author_name: string | null;
  courier_chrono: string | null;
  /** Renseigné seulement si l'affecté est membre de Clara : lien « Ouvrir dans Clara ». */
  courier_id: string | null;
}

export interface PublicTaskView {
  task: PublicTask;
  organization: { name: string | null; primary_color: string | null; logo_url: string | null };
}

export class PublicTaskError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call(body: Record<string, unknown>): Promise<PublicTaskView> {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PublicTaskError(
      (data as { error?: string }).error ?? "Une erreur est survenue. Réessayez plus tard.",
      res.status,
    );
  }
  return data as PublicTaskView;
}

export const getPublicTask = (token: string) => call({ action: "get", token });

export const completePublicTask = (token: string, note: string) =>
  call({ action: "complete", token, note });
