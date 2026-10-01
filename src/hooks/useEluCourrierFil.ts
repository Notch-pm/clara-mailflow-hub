import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { describeCourierEvent } from "@/lib/courier-history";
import { listNotes } from "@/services/courierNoteService";
import { listRepliesForCourier } from "@/services/courierReplyService";

export interface FilReply {
  id: string;
  subject: string | null;
  stateName: string | null;
  at: string | null;
  signed: boolean;
  sent: boolean;
}

export interface FilNote {
  id: string;
  content: string;
  at: string;
  by: string | null;
}

export interface FilActivity {
  id: string;
  title: string;
  detail: string | null;
  at: string;
  by: string | null;
}

/**
 * Bas de page d'un courrier dans l'espace élu : réponses apportées,
 * commentaires internes, activité. Mêmes sources et mêmes libellés que les
 * onglets du poste de travail (`describeCourierEvent`).
 */
export function useEluCourrierFil(courierId: string | undefined) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["elu-courrier-fil", organizationId, courierId],
    enabled: !!organizationId && !!courierId,
    queryFn: async () => {
      const [replies, notes, events] = await Promise.all([
        listRepliesForCourier(organizationId!, courierId!),
        listNotes(courierId!),
        supabase
          .from("courier_events")
          .select("id, event_type, payload, created_by, created_at")
          .eq("courier_id", courierId!)
          .order("created_at", { ascending: false })
          .limit(200)
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          }),
      ]);

      const stateIds = [...new Set(replies.map((r) => r.workflow_state_id).filter((v): v is string => !!v))];
      const userIds = [
        ...new Set([...notes.map((n) => n.created_by), ...events.map((e) => e.created_by)].filter((v): v is string => !!v)),
      ];
      const [states, users] = await Promise.all([
        stateIds.length
          ? supabase.from("workflow_states").select("id, name").in("id", stateIds).then(({ data, error }) => {
              if (error) throw error;
              return data ?? [];
            })
          : Promise.resolve([] as Array<{ id: string; name: string }>),
        userIds.length
          ? supabase.from("users").select("id, first_name, last_name, email").in("id", userIds).then(({ data, error }) => {
              if (error) throw error;
              return data ?? [];
            })
          : Promise.resolve([] as Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }>),
      ]);
      const stateName = new Map(states.map((s) => [s.id, s.name]));
      const userName = new Map(
        users.map((u) => [u.id, [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || "Utilisateur"]),
      );

      return {
        replies: replies
          .map<FilReply>((r) => ({
            id: r.id,
            subject: r.subject,
            stateName: r.workflow_state_id ? stateName.get(r.workflow_state_id) ?? null : null,
            at: r.created_at ?? null,
            signed: !!r.metadata?.signed_at,
            sent: !!r.metadata?.sent_email_at,
          }))
          .reverse(),
        notes: notes.map<FilNote>((n) => ({
          id: n.id,
          content: n.content,
          at: n.created_at,
          by: n.created_by ? userName.get(n.created_by) ?? null : null,
        })),
        activity: events.map<FilActivity>((e) => ({
          id: e.id,
          ...describeCourierEvent(e.event_type, e.payload as Record<string, unknown> | null),
          at: e.created_at,
          by: e.created_by ? userName.get(e.created_by) ?? null : "Système",
        })),
      };
    },
  });
}
