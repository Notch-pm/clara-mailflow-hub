import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useEluSignatureQueue } from "@/hooks/useEluSignatureQueue";
import { useEluVisaQueue } from "@/hooks/useEluVisaQueue";
import { inVisaScope, startOfMonthIso, type ParapheurTab, type VisaScope } from "@/lib/parapheur";
import { listMyHandledReplies } from "@/services/parapheurService";
import { loadApprovalContext, signAndAdvance, signatureBlocker, visaAndAdvance } from "@/services/replyApprovalService";

/** Une ligne de la liste, quel que soit l'onglet. */
export interface ParapheurRow {
  replyId: string;
  parentCourierId: string | null;
  title: string;
  chrono: string | null;
  senderName: string | null;
  service: string | null;
  /** Étape attendue (« Visa du DGS », « À signer ») ou action faite (« Visée »). */
  step: string;
  /** Attente en jours (files) ; null dans « Traitées par moi ». */
  waitingDays: number | null;
  /** Date de mon action (« Traitées par moi »). */
  handledAt: string | null;
  /** Un autre viseur est attendu : je vise à sa place si je vise. */
  designatedToOther: boolean;
}

/**
 * Les trois listes du parapheur. Les files sont celles de l'espace élu
 * (`useEluVisaQueue`, `useEluSignatureQueue`), sous les mêmes clés de cache :
 * le téléphone et l'écran complet ne peuvent pas diverger sur ce qui attend.
 */
export function useParapheur(scope: VisaScope) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const visa = useEluVisaQueue();
  const signature = useEluSignatureQueue();

  const since = useMemo(() => startOfMonthIso(), []);
  const { data: handled = [], isLoading: handledLoading } = useQuery({
    queryKey: ["parapheur-done", organizationId, user?.id, signature.signatoryId, since],
    queryFn: () => listMyHandledReplies(organizationId!, user!.id, signature.signatoryId, since),
    enabled: !!organizationId && !!user?.id,
  });

  const visaRows = useMemo<ParapheurRow[]>(
    () =>
      visa.items
        .filter((item) => inVisaScope(item, scope))
        .map((item) => ({
          replyId: item.replyId,
          parentCourierId: item.parentCourierId,
          title: item.title,
          chrono: item.chrono,
          senderName: item.senderName,
          service: null,
          step: item.stateName,
          waitingDays: item.waitingDays,
          handledAt: null,
          designatedToOther: item.designatedToOther,
        })),
    [visa.items, scope],
  );

  const signatureRows = useMemo<ParapheurRow[]>(
    () =>
      signature.items.map((item) => ({
        replyId: item.replyId,
        parentCourierId: item.parentCourierId,
        title: item.title,
        chrono: item.chrono,
        senderName: item.senderName,
        service: item.service,
        step: "À signer",
        waitingDays: item.waitingDays,
        handledAt: null,
        designatedToOther: false,
      })),
    [signature.items],
  );

  const doneRows = useMemo<ParapheurRow[]>(
    () =>
      handled.map((item) => ({
        replyId: item.replyId,
        parentCourierId: item.parentCourierId,
        title: item.title,
        chrono: item.chrono,
        senderName: item.senderName,
        service: null,
        step: item.action === "signature" ? "Signée" : item.stateName ? `Visée — ${item.stateName}` : "Visée",
        waitingDays: null,
        handledAt: item.at,
        designatedToOther: false,
      })),
    [handled],
  );

  const rows: Record<ParapheurTab, ParapheurRow[]> = { visa: visaRows, signature: signatureRows, done: doneRows };
  const isLoading: Record<ParapheurTab, boolean> = {
    visa: visa.isLoading,
    signature: signature.isLoading,
    done: handledLoading,
  };

  return { rows, isLoading, hasSignature: signature.hasSignature };
}

/**
 * Viser ou signer plusieurs réponses d'un coup. Une à une, chacune avec son
 * propre contexte (workflow, signataire) : une réponse qui échoue n'arrête pas
 * les autres, et l'on dit combien sont passées.
 */
export function useParapheurBulk() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ tab, replyIds }: { tab: "visa" | "signature"; replyIds: string[] }) => {
      const done: string[] = [];
      const failed: { replyId: string; message: string }[] = [];
      for (const replyId of replyIds) {
        try {
          const ctx = await loadApprovalContext(organizationId!, replyId);
          if (tab === "visa") {
            if (!ctx.state?.requires_visa) throw new Error("La réponse n'est plus en étape de visa.");
            await visaAndAdvance({ ...ctx.ref, stateId: ctx.state.id, next: ctx.next });
          } else {
            if (!ctx.state?.requires_signature || ctx.isSigned) throw new Error("La réponse n'attend plus de signature.");
            const blocker = signatureBlocker(ctx.signatory, user?.id ?? null);
            if (blocker) throw new Error(blocker);
            if (!ctx.next) throw new Error("Aucune transition suivante définie.");
            await signAndAdvance({
              ...ctx.ref,
              stateId: ctx.state.id,
              bodyHtml: ctx.bodyHtml,
              signatory: ctx.signatory!,
              next: ctx.next,
            });
          }
          done.push(replyId);
        } catch (error) {
          failed.push({ replyId, message: error instanceof Error ? error.message : String(error) });
        }
      }
      return { done, failed };
    },
    onSettled: () => {
      for (const key of [
        "visa-queue",
        "elu-visa-waiting",
        "elu-signature-queue",
        "elu-signature-waiting",
        "elu-reply",
        "reply-visas",
        "courier-replies",
        "courier-events",
        "parapheur-done",
        "mailbox-couriers",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
