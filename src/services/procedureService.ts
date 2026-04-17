import { supabase } from "@/integrations/supabase/client";

export interface Procedure {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  external_reference_id: string | null;
  external_source: string | null;
  is_displayed: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export async function listProcedures(orgId: string): Promise<Procedure[]> {
  const { data, error } = await supabase
    .from("procedures" as any)
    .select("*")
    .eq("organization_id", orgId)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Procedure[];
}

export async function createProcedure(
  orgId: string,
  payload: { name: string; description?: string | null; icon?: string | null; color?: string | null },
): Promise<Procedure> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("procedures" as any)
    .insert({
      organization_id: orgId,
      name: payload.name.trim(),
      description: payload.description?.trim() || null,
      icon: payload.icon || null,
      color: payload.color || null,
      created_by: user?.id ?? null,
    } as any)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Procedure;
}

export async function updateProcedure(
  id: string,
  payload: Partial<Pick<Procedure, "name" | "description" | "icon" | "color" | "is_displayed" | "display_order">>,
): Promise<Procedure> {
  const update: Record<string, unknown> = { ...payload };
  if (typeof update.name === "string") update.name = (update.name as string).trim();
  if (typeof update.description === "string") {
    update.description = (update.description as string).trim() || null;
  }
  const { data, error } = await supabase
    .from("procedures" as any)
    .update(update as any)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Procedure;
}

export async function deleteProcedure(id: string): Promise<void> {
  const { error } = await supabase.from("procedures" as any).delete().eq("id", id);
  if (error) throw error;
}
