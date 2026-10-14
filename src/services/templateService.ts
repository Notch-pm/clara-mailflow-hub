import { supabase } from "@/integrations/supabase/client";

// ─── HTML template ───────────────────────────────────────────────────────────

export async function getOrgHtmlTemplate(
  orgId: string,
): Promise<{ html: string | null; design: object | null }> {
  const { data, error } = await supabase
    .from("organizations")
    .select("reply_template_html, reply_template_design")
    .eq("id", orgId)
    .single();
  if (error) return { html: null, design: null };
  return {
    html: (data as any)?.reply_template_html ?? null,
    design: (data as any)?.reply_template_design ?? null,
  };
}

export async function saveOrgHtmlTemplate(
  orgId: string,
  html: string,
  design: object,
): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({ reply_template_html: html, reply_template_design: design } as never)
    .eq("id", orgId);
  if (error) throw error;
}

export async function removeOrgHtmlTemplate(orgId: string): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({ reply_template_html: null, reply_template_design: null } as never)
    .eq("id", orgId);
  if (error) throw error;
}
