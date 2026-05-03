import { supabase } from "@/integrations/supabase/client";

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
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data?.html ?? "";
}
