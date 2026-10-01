import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { edgeError } from "@/lib/edge-error";
import { transitionReplyState } from "@/services/courierReplyService";
import { signAndAdvance as signReplyAndAdvance, signatureBlocker, visaAndAdvance as visaReplyAndAdvance } from "@/services/replyApprovalService";
import { isFreeExitFromVisa, type VisaGraphTransition } from "@/lib/reply-visa";
import type { EluTransitionChoice } from "@/hooks/useEluReply";
import type { WorkflowState } from "@/types/courier";

export interface EluSignatory {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  user_id: string | null;
  signature_storage_key: string | null;
}

export interface EluSignContext {
  organizationId: string | null;
  parentCourierId: string | null;
  replyId: string | undefined;
  bodyHtml: string;
  currentState: WorkflowState | null;
  outgoing: EluTransitionChoice[];
  signatory: EluSignatory | null;
  currentUserId: string | null;
  channel: string;
  isSigned: boolean;
  isSent: boolean;
  canEmail: boolean;
  /** L'étape courante est une étape de visa. */
  isVisaState?: boolean;
  /** Un visa est en vigueur sur l'étape courante. */
  hasActiveVisa?: boolean;
  /** L'utilisateur est viseur de l'organisation gestionnaire. */
  canVisa?: boolean;
  /** Transitions du workflow réponse : un renvoi « À corriger » se reconnaît à sa suite nominale. */
  workflowTransitions?: readonly VisaGraphTransition[];
  /** Libellés de l'action principale, quand l'écran les veut autres (« Signer et suivant »). */
  labels?: { visa?: string; sign?: string };
  /** Message après signature ; par défaut « Courrier signé et envoyé » (espace élu). */
  signedToast?: string;
  onDone: () => void;
}

export interface EluAction {
  id: string;
  label: string;
  /** Le visa reçoit le commentaire saisi dans la feuille de confirmation. */
  run: (comment?: string) => void;
  /** Renseignée, elle explique pourquoi l'action est grisée. */
  disabledReason?: string | null;
}

/**
 * Les actions du pied de l'écran de détail.
 *
 * L'arbitrage reproduit celui de `ReplyComposer` — signature, envoi, ou simple
 * transition — plutôt qu'un « Signer et envoyer » écrit en dur : deux écrans
 * qui décideraient différemment finiraient par produire deux courriers
 * différents pour la même réponse.
 *
 * Les actions secondaires sont les AUTRES transitions sortantes du workflow,
 * avec le libellé que la collectivité leur a donné. « Renvoyer au service »
 * n'est donc pas un bouton du produit : c'est une transition que chaque
 * collectivité modélise, ou non — s'il n'y en a aucune, il n'y a aucun bouton.
 *
 * Dans une étape de visa pas encore visée, l'action principale est « Viser »
 * (visa puis transition nominale, comme « Viser et avancer » du composeur), et
 * les secondaires se limitent aux sorties que la base laisse passer sans visa
 * — retour, abandon, renvoi pour correction (`isFreeExitFromVisa`).
 */
export function useSignAndAdvance(ctx: EluSignContext): {
  primary: EluAction | null;
  secondary: EluAction[];
  isPending: boolean;
} {
  const queryClient = useQueryClient();

  const nextEntry = useMemo(() => ctx.outgoing.find((t) => t.kind === "next") ?? null, [ctx.outgoing]);
  const prevEntry = useMemo(() => ctx.outgoing.find((t) => t.kind === "previous") ?? null, [ctx.outgoing]);
  const others = useMemo(() => {
    const nominal = new Set([nextEntry?.transitionId, prevEntry?.transitionId].filter(Boolean));
    return ctx.outgoing.filter((t) => !nominal.has(t.transitionId));
  }, [ctx.outgoing, nextEntry, prevEntry]);

  function settle() {
    if (ctx.parentCourierId) {
      void queryClient.invalidateQueries({ queryKey: ["courier-replies", ctx.parentCourierId] });
      void queryClient.invalidateQueries({ queryKey: ["courier-events", ctx.parentCourierId] });
    }
    void queryClient.invalidateQueries({ queryKey: ["elu-reply"] });
    void queryClient.invalidateQueries({ queryKey: ["elu-signature-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["elu-signature-waiting"] });
    void queryClient.invalidateQueries({ queryKey: ["reply-visas"] });
    void queryClient.invalidateQueries({ queryKey: ["visa-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["elu-visa-waiting"] });
    void queryClient.invalidateQueries({ queryKey: ["parapheur-done"] });
    void queryClient.invalidateQueries({ queryKey: ["mailbox-couriers"] });
  }

  async function advance(target: EluTransitionChoice["target"]) {
    await transitionReplyState(
      ctx.organizationId!,
      ctx.parentCourierId!,
      ctx.replyId!,
      target.id,
      target.name,
      target.category,
    );
  }

  const signAndAdvance = useMutation({
    mutationFn: async () => {
      if (!nextEntry) throw new Error("Aucune transition suivante définie.");
      await signReplyAndAdvance({
        organizationId: ctx.organizationId!,
        parentCourierId: ctx.parentCourierId!,
        replyId: ctx.replyId!,
        stateId: ctx.currentState?.id ?? null,
        bodyHtml: ctx.bodyHtml,
        signatory: ctx.signatory!,
        next: nextEntry.target,
      });
    },
    onSuccess: () => {
      toast.success(ctx.signedToast ?? "Courrier signé et envoyé");
      ctx.onDone();
    },
    onError: (error: Error) => toast.error(error.message || "La signature a échoué."),
    onSettled: settle,
  });

  const sendAndAdvance = useMutation({
    mutationFn: async () => {
      if (!nextEntry) throw new Error("Aucune transition suivante définie.");
      const { error } = await supabase.functions.invoke("send-courier-reply", {
        body: { reply_id: ctx.replyId, organization_id: ctx.organizationId },
      });
      // La fonction répond 409 quand la réponse est déjà partie : l'élu doit
      // lire une phrase, pas un code. Le statut se lit sur la réponse
      // (`edgeError`) : le message du client Supabase ne le contient jamais.
      if (error) {
        const err = await edgeError(error, "L'envoi a échoué. Réessayez dans un instant.");
        if (err.status === 409) throw new Error("Cette réponse a déjà été envoyée.");
        throw err;
      }
      await advance(nextEntry.target);
    },
    onSuccess: () => {
      toast.success("Courrier envoyé");
      ctx.onDone();
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: settle,
  });

  // Le serveur refuse le visa d'un non-viseur, et toute sortie vers l'avant
  // sans visa : l'écran ne fait que proposer.
  const visaAndAdvance = useMutation({
    mutationFn: async (comment: string | undefined) => {
      if (!ctx.currentState) throw new Error("Étape de visa introuvable.");
      await visaReplyAndAdvance({
        organizationId: ctx.organizationId!,
        parentCourierId: ctx.parentCourierId!,
        replyId: ctx.replyId!,
        stateId: ctx.currentState.id,
        next: nextEntry?.target ?? null,
        comment: comment ?? null,
      });
    },
    onSuccess: () => {
      toast.success("Réponse visée");
      ctx.onDone();
    },
    onError: (error: Error) => toast.error(error.message || "Le visa a échoué."),
    onSettled: settle,
  });

  const transition = useMutation({
    mutationFn: async (target: EluTransitionChoice["target"]) => advance(target),
    onSuccess: () => ctx.onDone(),
    onError: (error: Error) => toast.error(error.message || "Le changement d'état a échoué."),
    onSettled: settle,
  });

  const isPending =
    signAndAdvance.isPending || sendAndAdvance.isPending || visaAndAdvance.isPending || transition.isPending;

  const visaPending = !!ctx.isVisaState && !ctx.hasActiveVisa;

  const primary = useMemo<EluAction | null>(() => {
    // Viser n'exige pas de transition suivante : sans elle, le visa est tout de
    // même consigné et la réponse reste dans l'étape.
    if (visaPending) {
      return {
        id: "visa",
        label: ctx.labels?.visa ?? "Viser",
        disabledReason: ctx.canVisa ? null : "Vous n'êtes pas viseur de l'organisation gestionnaire.",
        run: (comment) => visaAndAdvance.mutate(comment),
      };
    }

    if (!nextEntry) return null;

    const requiresSignature = !!ctx.currentState?.requires_signature && !ctx.isSigned;
    const requiresSend =
      !!ctx.currentState?.is_send && !ctx.isSent &&
      ctx.channel === "email";

    if (requiresSignature) {
      const reason = signatureBlocker(ctx.signatory, ctx.currentUserId);
      return {
        id: "sign",
        label: ctx.labels?.sign ?? "Signer et envoyer",
        disabledReason: reason,
        run: () => signAndAdvance.mutate(),
      };
    }

    if (requiresSend) {
      return {
        id: "send",
        label: "Envoyer",
        disabledReason: ctx.canEmail ? null : "L'usager n'a pas d'adresse électronique.",
        run: () => sendAndAdvance.mutate(),
      };
    }

    return {
      id: nextEntry.transitionId,
      label: nextEntry.label,
      run: () => transition.mutate(nextEntry.target),
    };
  }, [nextEntry, ctx, visaPending, signAndAdvance, sendAndAdvance, visaAndAdvance, transition]);

  const secondary = useMemo<EluAction[]>(
    () =>
      // Le retour en tête : c'est là que la plupart des collectivités
      // modéliseront « renvoyer au service ».
      [...(prevEntry ? [prevEntry] : []), ...others]
        .filter(
          (choice) =>
            !visaPending ||
            isFreeExitFromVisa(
              choice,
              ctx.currentState
                ? { visaStateId: ctx.currentState.id, transitions: ctx.workflowTransitions ?? [] }
                : undefined,
            ),
        )
        .map((choice) => ({
          id: choice.transitionId,
          label: choice.label,
          run: () => transition.mutate(choice.target),
        })),
    [prevEntry, others, transition, visaPending, ctx.currentState, ctx.workflowTransitions],
  );

  return { primary, secondary, isPending };
}
