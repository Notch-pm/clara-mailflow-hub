import { supabase } from "@/integrations/supabase/client";
import type { CourierChannel } from "@/types/courier";

export interface Notification {
  id: string;
  organization_id: string;
  user_id: string;
  type: string;
  title: string | null;
  resource_id: string | null;
  read: boolean;
  created_at: string;
  /** Canal d'entrée du courrier visé, lu sur le courrier : la notification ne le porte pas. */
  channel: CourierChannel | null;
}

export async function getNotifications(userId: string): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = data ?? [];

  // Toutes les notifications visent un courrier (resource_id). Un courrier
  // supprimé ou hors de portée laisse simplement la notification sans canal.
  const ids = [...new Set(rows.map((n) => n.resource_id).filter((id): id is string => !!id))];
  const channels = new Map<string, CourierChannel | null>();
  if (ids.length) {
    const { data: couriers, error: couriersError } = await supabase
      .from("couriers")
      .select("id, channel")
      .in("id", ids);
    if (couriersError) throw couriersError;
    for (const c of couriers ?? []) channels.set(c.id, c.channel);
  }
  return rows.map((n) => ({ ...n, channel: n.resource_id ? (channels.get(n.resource_id) ?? null) : null }));
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true } as never)
    .eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true } as never)
    .eq("user_id", userId)
    .eq("read", false);
  if (error) throw error;
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) throw error;
}

