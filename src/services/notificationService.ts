import { supabase } from "@/integrations/supabase/client";

export interface Notification {
  id: string;
  organization_id: string;
  user_id: string;
  type: string;
  title: string | null;
  resource_id: string | null;
  read: boolean;
  created_at: string;
}

export async function getNotifications(userId: string): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as Notification[];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications" as never)
    .update({ read: true })
    .eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications" as never)
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) throw error;
}
