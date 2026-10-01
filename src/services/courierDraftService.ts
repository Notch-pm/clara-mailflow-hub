import { supabase } from "@/integrations/supabase/client";
import { edgeError } from "@/lib/edge-error";

export interface DraftReplyParams {
  courierId: string;
  orgId: string;
  responseType: string;
  additionalInstructions?: string;
  /** Objet en cours dans l'éditeur : l'assistant le reprend ou le corrige. */
  currentSubject?: string | null;
}

export interface DraftReplyResult {
  html: string;
  /** Objet proposé ; null quand l'assistant n'en a pas rendu d'exploitable. */
  subject: string | null;
}

export async function draftReply(params: DraftReplyParams): Promise<DraftReplyResult> {
  const { data, error } = await supabase.functions.invoke("draft-reply", {
    body: params,
  });
  // Le motif rédigé par la fonction (guichet IA saturé, Socle non raccordé…)
  // est dans le corps de la réponse, pas dans `error.message`.
  if (error) throw await edgeError(error, "Rédaction impossible");
  if (data?.error) throw new Error(data.error);
  return {
    html: data?.html ?? "",
    subject: typeof data?.subject === "string" && data.subject.trim() ? data.subject.trim() : null,
  };
}

/**
 * « Améliorer mon message » : la langue, jamais le sens (edge `improve-reply`).
 * Le corps part tel qu'il est dans l'éditeur, enregistré ou non ; rien n'est
 * écrit en base. Un résultat qui aurait perdu une donnée ou une mise en forme
 * est refusé par le serveur, avec un message à relayer tel quel.
 */
export async function improveReply(params: {
  courierId: string;
  orgId: string;
  html: string;
  /** Objet en cours : relu avec le corps, sous les mêmes garde-fous. */
  subject?: string | null;
}): Promise<{ html: string; subject: string | null }> {
  const { data, error } = await supabase.functions.invoke("improve-reply", { body: params });
  if (error) throw await edgeError(error, "Amélioration impossible");
  if (data?.error) throw new Error(data.error);
  return {
    html: data?.html ?? "",
    subject: typeof data?.subject === "string" && data.subject.trim() ? data.subject.trim() : null,
  };
}
