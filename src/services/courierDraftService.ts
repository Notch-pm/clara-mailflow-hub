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
