import { supabase } from "@/integrations/supabase/client";
import { logEvent } from "./courierEventService";

export interface CourierNote {
  id: string;
  organization_id: string;
  courier_id: string;
  content: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function preview(text: string, max = 80): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export async function listNotes(courierId: string): Promise<CourierNote[]> {
  const { data, error } = await supabase
    .from("courier_notes")
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
    .from("courier_notes")
    .insert({
      organization_id: orgId,
      courier_id: courierId,
      content: content.trim(),
      created_by: user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  await logEvent(orgId, courierId, "note_added", { preview: preview(content) });
  return data as unknown as CourierNote;
}

export async function updateNote(id: string, content: string): Promise<CourierNote> {
  const { data, error } = await supabase
    .from("courier_notes")
    .update({ content: content.trim() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const row = data as unknown as CourierNote;
  await logEvent(row.organization_id, row.courier_id, "note_updated", {
    preview: preview(content),
  });
  return row;
}

export async function deleteNote(id: string): Promise<void> {
  const { data: existing } = await supabase
    .from("courier_notes")
    .select("organization_id, courier_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("courier_notes").delete().eq("id", id);
  if (error) throw error;
  if (existing) {
    const row = existing as unknown as { organization_id: string; courier_id: string };
    await logEvent(row.organization_id, row.courier_id, "note_deleted");
  }
}
