import { supabase } from "@/integrations/supabase/client";
import { edgeError } from "@/lib/edge-error";

export interface DraftReplyParams {
  courierId: string;
  orgId: string;
  responseType: string;
  additionalInstructions?: string;
}

export async function draftReply(params: DraftReplyParams): Promise<string> {
  const { data, error } = await supabase.functions.invoke("draft-reply", {
    body: params,
  });
  // Le motif rédigé par la fonction (guichet IA saturé, Socle non raccordé…)
  // est dans le corps de la réponse, pas dans `error.message`.
  if (error) throw await edgeError(error, "Rédaction impossible");
  if (data?.error) throw new Error(data.error);
  return data?.html ?? "";
}

/**
 * « Améliorer mon message » : la langue, jamais le sens (edge `improve-reply`).
 * Le corps part tel qu'il est dans l'éditeur, enregistré ou non ; rien n'est
 * écrit en base. Un résultat qui aurait perdu une donnée ou une mise en forme
 * est refusé par le serveur, avec un message à relayer tel quel.
 */
export async function improveReply(params: { courierId: string; orgId: string; html: string }): Promise<string> {
  const { data, error } = await supabase.functions.invoke("improve-reply", { body: params });
  if (error) throw await edgeError(error, "Amélioration impossible");
  if (data?.error) throw new Error(data.error);
  return data?.html ?? "";
}
