import { supabase } from "@/integrations/supabase/client";

export interface CourierNote {
  id: string;
  organization_id: string;
  courier_id: string;
  content: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listNotes(courierId: string): Promise<CourierNote[]> {
  const { data, error } = await supabase
    .from("courier_notes" as any)
    .select("*")
    .eq("courier_id", courierId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CourierNote[];
}

export async function createNote(
  orgId: string,
  courierId: string,
  content: string,
): Promise<CourierNote> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("courier_notes" as any)
    .insert({
      organization_id: orgId,
      courier_id: courierId,
      content: content.trim(),
      created_by: user?.id ?? null,
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CourierNote;
}

export async function updateNote(id: string, content: string): Promise<CourierNote> {
  const { data, error } = await supabase
    .from("courier_notes" as any)
    .update({ content: content.trim() } as any)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CourierNote;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from("courier_notes" as any).delete().eq("id", id);
  if (error) throw error;
}
