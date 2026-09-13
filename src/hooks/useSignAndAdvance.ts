import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { signReply, transitionReplyState } from "@/services/courierReplyService";
import { getSignatureDataUrl } from "@/services/signatoryService";
import { appendSignature, buildSignatureBlock } from "@/lib/reply-signature";
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
  onDone: () => void;
}

export interface EluAction {
  id: string;
  label: string;
  run: () => void;
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
      const signatory = ctx.signatory!;
      const signatureDataUrl = await getSignatureDataUrl(signatory.signature_storage_key!);
      const fullName = `${signatory.first_name} ${signatory.last_name}`.trim();
      const signedBody = appendSignature(
        ctx.bodyHtml,
        buildSignatureBlock({ fullName, title: signatory.title, signatureDataUrl }),
      );
      await signReply(ctx.organizationId!, ctx.parentCourierId!, ctx.replyId!, {
        bodyHtml: signedBody,
        signedBy: signatory.id,
        signedStateId: ctx.currentState?.id ?? null,
      });
      await advance(nextEntry.target);
    },
    onSuccess: () => {
      toast.success("Courrier signé et envoyé");
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
      // lire une phrase, pas un code.
      if (error) {
        throw new Error(
          /409/.test(String(error.message))
            ? "Cette réponse a déjà été envoyée."
            : "L'envoi a échoué. Réessayez dans un instant.",
        );
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

  const transition = useMutation({
    mutationFn: async (target: EluTransitionChoice["target"]) => advance(target),
    onSuccess: () => ctx.onDone(),
    onError: (error: Error) => toast.error(error.message || "Le changement d'état a échoué."),
    onSettled: settle,
  });

  const isPending = signAndAdvance.isPending || sendAndAdvance.isPending || transition.isPending;

  const primary = useMemo<EluAction | null>(() => {
    if (!nextEntry) return null;

    const requiresSignature = !!ctx.currentState?.requires_signature && !ctx.isSigned;
    const requiresSend =
      !!ctx.currentState?.is_send && !ctx.isSent &&
      ctx.channel === "email";

    if (requiresSignature) {
      const reason = !ctx.signatory
        ? "Aucun signataire n'est désigné sur cette réponse."
        : ctx.signatory.user_id !== ctx.currentUserId
          ? "Vous n'êtes pas le signataire désigné."
          : !ctx.signatory.signature_storage_key
            ? "Aucune signature manuscrite n'est enregistrée pour vous."
            : null;
      return {
        id: "sign",
        label: "Signer et envoyer",
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
  }, [nextEntry, ctx, signAndAdvance, sendAndAdvance, transition]);

  const secondary = useMemo<EluAction[]>(
    () =>
      // Le retour en tête : c'est là que la plupart des collectivités
      // modéliseront « renvoyer au service ».
      [...(prevEntry ? [prevEntry] : []), ...others].map((choice) => ({
        id: choice.transitionId,
        label: choice.label,
        run: () => transition.mutate(choice.target),
      })),
    [prevEntry, others, transition],
  );

  return { primary, secondary, isPending };
}
