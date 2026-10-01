import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { listMyVisaQueue } from "@/services/courierVisaService";
import { waitingDays } from "@/lib/elu-delay";

/** Une réponse qui attend le visa de l'utilisateur courant. */
export interface EluVisaItem {
  replyId: string;
  parentCourierId: string | null;
  /** Objet du courrier parent quand il est joignable, sinon celui de la réponse. */
  title: string;
  chrono: string | null;
  /** L'usager : expéditeur du courrier reçu. */
  senderName: string | null;
  receivedAt: string | null;
  /** Nom de l'étape de visa (« Visa du DGS »). */
  stateName: string;
  /** Je suis le viseur désigné ; sinon je peux viser à la place du désigné. */
  designatedToMe: boolean;
  /** Un autre viseur est désigné sur l'étape. */
  designatedToOther: boolean;
  waitingSince: string | null;
  waitingDays: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;

function participantName(p: {
  name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string | null {
  return p.name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || null;
}

/**
 * La file des réponses en attente de MON visa, pour l'espace élu.
 *
 * La file elle-même vient de `listMyVisaQueue`, sous la clé du tableau de bord
 * (`visa-queue`) : l'écran complet et le téléphone ne peuvent pas diverger sur
 * ce qui attend un viseur. On n'ajoute ici que ce qu'une carte mobile affiche —
 * l'objet et l'expéditeur du courrier reçu, l'ancienneté.
 */
export function useEluVisaQueue() {
  const { user, membership } = useAuth();
  const { organizationId } = useOrganization();
  // L'attribut seul ne suffit pas à viser (il faut aussi le rattachement à
  // l'organisation gestionnaire), mais c'est lui qui fait d'un élu un viseur :
  // sans lui, l'onglet n'a rien à promettre.
  const isViseur = !!membership?.is_viseur;

  const { data: queue = [], isLoading } = useQuery({
    queryKey: ["visa-queue", organizationId, user?.id],
    queryFn: () => listMyVisaQueue(organizationId!, user!.id),
    enabled: !!organizationId && !!user?.id && isViseur,
    staleTime: FIVE_MINUTES,
  });

  const parentIds = useMemo(
    () => Array.from(new Set(queue.map((r) => r.parent_courier_id).filter(Boolean))) as string[],
    [queue],
  );
  const stateIds = useMemo(() => Array.from(new Set(queue.map((r) => r.state_id))), [queue]);

  // Requête à part plutôt qu'auto-jointure : voir `useEluSignatureQueue`.
  const { data: parentById } = useQuery({
    queryKey: ["elu-visa-parents", organizationId, parentIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select("id, subject, chrono, received_at, courier_participants(role, name, first_name, last_name)")
        .eq("organization_id", organizationId!)
        .in("id", parentIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((c) => [c.id, c]));
    },
    enabled: !!organizationId && parentIds.length > 0,
  });

  // Depuis quand chacune attend : la dernière entrée dans l'étape de visa, lue
  // dans l'historique du courrier PARENT (même raison que pour la signature).
  const { data: waitingSince } = useQuery({
    queryKey: ["elu-visa-waiting", organizationId, parentIds, stateIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courier_events")
        .select("courier_id, created_at, payload")
        .eq("organization_id", organizationId!)
        .eq("event_type", "reply_state_changed")
        .in("courier_id", parentIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const stateSet = new Set(stateIds);
      const byReply: Record<string, string> = {};
      for (const event of data ?? []) {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const replyId = payload.reply_id as string | undefined;
        const toStateId = payload.to_state_id as string | undefined;
        if (replyId && toStateId && stateSet.has(toStateId) && !byReply[replyId]) {
          byReply[replyId] = event.created_at as string;
        }
      }
      return byReply;
    },
    enabled: !!organizationId && parentIds.length > 0,
  });

  const items = useMemo<EluVisaItem[]>(() => {
    const now = new Date();
    return queue
      .map((row) => {
        const parent = row.parent_courier_id ? parentById?.[row.parent_courier_id] : null;
        const sender = (parent?.courier_participants ?? []).find((p: { role: string }) => p.role === "sender");
        const since = waitingSince?.[row.id] ?? null;
        return {
          replyId: row.id,
          parentCourierId: row.parent_courier_id,
          title: parent?.subject || row.subject || "Sans objet",
          chrono: parent?.chrono ?? row.chrono ?? null,
          senderName: sender ? participantName(sender) : null,
          receivedAt: parent?.received_at ?? null,
          stateName: row.state_name,
          designatedToMe: row.designated_to_me,
          designatedToOther: !!row.designated_user_id && !row.designated_to_me,
          waitingSince: since,
          waitingDays: since ? waitingDays(since, now) : 0,
        };
      })
      // Les miennes d'abord, puis les plus anciennes.
      .sort((a, b) => Number(b.designatedToMe) - Number(a.designatedToMe) || b.waitingDays - a.waitingDays);
  }, [queue, parentById, waitingSince]);

  return {
    items,
    count: items.length,
    isViseur,
    isLoading: isViseur && isLoading,
  };
}
