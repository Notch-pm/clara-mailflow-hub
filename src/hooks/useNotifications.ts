import { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  type Notification,
} from "@/services/notificationService";

import { useAuth } from "@/contexts/AuthContext";

export function useNotifications() {
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000, // filet de sécurité si realtime rate un événement
  });

  // Supabase Realtime — server-side filter ensures only this user's rows are pushed
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["notifications", userId] });
      queryClient.setQueryData<Notification[]>(
        ["notifications", userId],
        (prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(userId!),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["notifications", userId] });
      queryClient.setQueryData<Notification[]>(
        ["notifications", userId],
        (prev) => prev?.map((n) => ({ ...n, read: true }))
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNotification,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["notifications", userId] });
      queryClient.setQueryData<Notification[]>(
        ["notifications", userId],
        (prev) => prev?.filter((n) => n.id !== id)
      );
    },
  });

  return {
    notifications,
    unreadCount,
    isLoading,
    markRead: (id: string) => markReadMutation.mutate(id),
    markAllRead: () => markAllReadMutation.mutate(),
    deleteNotification: (id: string) => deleteMutation.mutate(id),
  };
}

