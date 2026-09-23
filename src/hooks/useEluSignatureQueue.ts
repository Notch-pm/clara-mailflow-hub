import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { waitingDays } from "@/lib/elu-delay";

/** Une réponse qui attend la signature de l'utilisateur courant. */
export interface EluSignatureItem {
  replyId: string;
  parentCourierId: string | null;
  /** Objet du courrier parent quand il est joignable, sinon celui de la réponse. */
  title: string;
  chrono: string | null;
  /** L'usager : expéditeur du courrier reçu, à défaut destinataire de la réponse. */
  senderName: string | null;
  senderContactId: string | null;
  /** Date de réception du courrier auquel cette réponse répond. */
  receivedAt: string | null;
  service: string | null;
  waitingSince: string;
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
 * La file des réponses en attente de MA signature, avec depuis quand.
 *
 * Le badge de l'onglet et l'écran consomment ce même hook : une seule série de
 * requêtes, un seul cache.
 */
export function useEluSignatureQueue() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();

  // 1. Ma fiche de signataire. Sans elle, la file est vide — mais l'onglet
  //    reste visible : élu et signataire sont deux qualités indépendantes.
  const { data: signatory, isLoading: signatoryLoading } = useQuery({
    queryKey: ["elu-signatory", organizationId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signatories")
        .select("id, first_name, last_name, signature_storage_key")
        .eq("organization_id", organizationId!)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!organizationId && !!user?.id,
    staleTime: FIVE_MINUTES,
  });

  // 2. Les états qui EXIGENT une signature. On lit la colonne `requires_signature`
  //    plutôt que de deviner sur le nom : c'est elle que `ReplyComposer` teste
  //    pour décider de signer, et un état entrant nommé « signature » ne doit
  //    pas entrer dans la file.
  const { data: signatureStateIds } = useQuery({
    queryKey: ["elu-signature-states", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflow_states")
        .select("id")
        .eq("organization_id", organizationId!)
        .eq("requires_signature", true);
      if (error) throw error;
      return (data ?? []).map((s) => s.id);
    },
    enabled: !!organizationId,
    staleTime: FIVE_MINUTES,
  });

  // 3. Les réponses qui m'attendent. Le filtre par signataire passe en SQL :
  //    inutile de rapatrier la file de tous les signataires du tenant pour
  //    n'en garder qu'une part.
  const { data: replies, isLoading: repliesLoading } = useQuery({
    queryKey: ["elu-signature-queue", organizationId, signatory?.id, signatureStateIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select(
          "id, subject, chrono, created_at, parent_courier_id, assigned_service, courier_participants(role, name, first_name, last_name)",
        )
        .eq("organization_id", organizationId!)
        .eq("direction", "outbound")
        .in("workflow_state_id", signatureStateIds!)
        .eq("metadata->>signatory_id", signatory!.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId && !!signatory?.id && (signatureStateIds?.length ?? 0) > 0,
  });

  const parentIds = useMemo(
    () => Array.from(new Set((replies ?? []).map((r) => r.parent_courier_id).filter(Boolean))) as string[],
    [replies],
  );

  // 4. L'objet du courrier parent. Requête à part, et non jointure imbriquée :
  //    l'auto-jointure `couriers!parent_courier_id` rend `null` à l'exécution,
  //    et l'on afficherait alors le « Re: … » de la réponse — dont l'objet a pu
  //    être recopié avant que le parent ne soit renommé.
  const { data: parentById } = useQuery({
    queryKey: ["elu-signature-parents", organizationId, parentIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select(
          "id, subject, chrono, received_at, courier_participants(role, name, first_name, last_name, socle_contact_id)",
        )
        .eq("organization_id", organizationId!)
        .in("id", parentIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((c) => [c.id, c]));
    },
    enabled: !!organizationId && parentIds.length > 0,
  });

  // 5. Depuis quand chacune attend. `couriers.updated_at` ne peut pas servir :
  //    un trigger le repousse à CHAQUE écriture, donc à chaque sauvegarde du
  //    brouillon. La date vit dans l'historique — et l'événement d'une réponse
  //    est journalisé sur son courrier PARENT.
  const { data: waitingSince } = useQuery({
    queryKey: ["elu-signature-waiting", organizationId, parentIds, signatureStateIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courier_events")
        .select("courier_id, created_at, payload")
        .eq("organization_id", organizationId!)
        .eq("event_type", "reply_state_changed")
        .in("courier_id", parentIds)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const stateSet = new Set(signatureStateIds ?? []);
      const byReply: Record<string, string> = {};
      for (const event of data ?? []) {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const replyId = payload.reply_id as string | undefined;
        const toStateId = payload.to_state_id as string | undefined;
        // Les lignes arrivent de la plus récente à la plus ancienne : la
        // première rencontrée est la dernière entrée en signature.
        if (replyId && toStateId && stateSet.has(toStateId) && !byReply[replyId]) {
          byReply[replyId] = event.created_at as string;
        }
      }
      return byReply;
    },
    enabled: !!organizationId && parentIds.length > 0 && (signatureStateIds?.length ?? 0) > 0,
  });

  const items = useMemo<EluSignatureItem[]>(() => {
    const now = new Date();
    return (replies ?? [])
      .map((reply) => {
        const parentRow = reply.parent_courier_id
          ? parentById?.[reply.parent_courier_id]
          : null;
        const recipient = (reply.courier_participants ?? []).find((p) => p.role === "recipient");
        // L'usager, c'est l'EXPÉDITEUR du courrier reçu. Le destinataire de la
        // réponse le recopie à la création, mais il manque dès que la réponse a
        // été créée à la main.
        const parentSender = (parentRow?.courier_participants ?? []).find(
          (p: { role: string }) => p.role === "sender",
        );
        // Repli assumé sur la création de la réponse : une réponse créée
        // directement dans l'état signature n'a pas d'événement, et
        // `logEvent` avale ses erreurs — le cas se produit.
        const since = waitingSince?.[reply.id] ?? (reply.created_at as string);
        return {
          replyId: reply.id,
          parentCourierId: reply.parent_courier_id,
          title: parentRow?.subject || reply.subject || "Sans objet",
          chrono: parentRow?.chrono ?? reply.chrono ?? null,
          senderName:
            (parentSender ? participantName(parentSender) : null) ??
            (recipient ? participantName(recipient) : null),
          senderContactId: parentSender?.socle_contact_id ?? null,
          receivedAt: parentRow?.received_at ?? null,
          service: reply.assigned_service ?? null,
          waitingSince: since,
          waitingDays: waitingDays(since, now),
        };
      })
      .sort((a, b) => b.waitingDays - a.waitingDays);
  }, [replies, waitingSince, parentById]);

  return {
    items,
    count: items.length,
    /** L'utilisateur a-t-il une fiche de signataire dans cette organisation ? */
    isSignatory: !!signatory?.id,
    /** A-t-il déposé une signature manuscrite ? Sans elle, il ne pourra pas signer. */
    hasSignature: !!signatory?.signature_storage_key,
    signatoryId: signatory?.id ?? null,
    isLoading: signatoryLoading || repliesLoading,
  };
}
