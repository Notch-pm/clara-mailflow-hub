import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReplyVisaTrail } from "@/components/courier/ReplyVisaTrail";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useEluReply } from "@/hooks/useEluReply";
import { useSignAndAdvance } from "@/hooks/useSignAndAdvance";
import type { ParapheurTab } from "@/lib/parapheur";
import { visaPersonName } from "@/services/courierVisaService";
import { cn } from "@/lib/utils";

const CHANNEL_LABELS: Record<string, string> = { email: "Courriel", paper: "Courrier" };

function longDate(date: Date): string {
  const day = date.getDate();
  const rest = date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return `${day === 1 ? "1er" : day} ${rest}`;
}

/**
 * Relecture d'une réponse dans le parapheur, et son action : viser ou signer
 * puis passer à la suivante. Les décisions (quelle action, quelles sorties
 * sans visa) sont celles de l'espace élu — `useSignAndAdvance` —, seule la
 * mise en page change.
 */
export function ParapheurDetail({
  replyId,
  tab,
  onDone,
}: {
  replyId: string;
  tab: ParapheurTab;
  /** Appelé après une action qui fait sortir la réponse de la file. */
  onDone: () => void;
}) {
  const { user, membership } = useAuth();
  const { organizationId } = useOrganization();
  const detail = useEluReply(replyId);
  const [comment, setComment] = useState("");

  const signatory = detail.signatories.find((s) => s.id === detail.signatoryId) ?? null;
  const canVisa = detail.viseurs.some((v) => v.id === user?.id);
  const visaPending = detail.isVisaState && !detail.activeVisa;
  const signaturePending = !!detail.currentState?.requires_signature && !detail.isSigned;
  const isQueue = tab !== "done";

  const { primary, secondary, isPending } = useSignAndAdvance({
    organizationId,
    parentCourierId: detail.parentId,
    replyId,
    bodyHtml: detail.bodyHtml,
    currentState: detail.currentState,
    outgoing: detail.outgoing,
    signatory,
    currentUserId: user?.id ?? null,
    channel: detail.channel,
    isSigned: detail.isSigned,
    isSent: detail.isSent,
    canEmail: true,
    isVisaState: detail.isVisaState,
    hasActiveVisa: !!detail.activeVisa,
    canVisa,
    workflowTransitions: detail.workflow?.transitions,
    signedToast: "Réponse signée",
    onDone: () => {
      setComment("");
      onDone();
    },
  });

  if (detail.isLoading) {
    return (
      <div className="grid flex-1 place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-label="Chargement" />
      </div>
    );
  }

  if (!detail.reply) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
        Cette réponse n'existe plus, ou ne vous est pas accessible.
      </div>
    );
  }

  const title = detail.parent?.subject || detail.reply.subject || "Sans objet";
  const banner = !isQueue
    ? null
    : visaPending
      ? detail.designatedViseurId && detail.designatedViseurId !== user?.id
        ? `En attente du visa de ${visaPersonName(detail.designatedViseur)}. Vous pouvez viser à sa place : la trace l'indiquera.`
        : `En attente de votre visa — étape « ${detail.currentState?.name ?? "Visa"} ». Le texte est figé pendant le visa.`
      : signaturePending
        ? "En attente de votre signature. Votre signature sera apposée sur le document."
        : null;
  // Hors file, l'emplacement « à signer » ne s'adresse plus à moi : on ne montre
  // que la signature déjà apposée.
  const showSignatureBlock = isQueue ? signaturePending : detail.isSigned;
  // Le commentaire n'a de destination que le visa (consigné avec la trace).
  const isVisaAction = primary?.id === "visa";

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-6 pb-6 pt-5">
        <div className="flex shrink-0 flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
              {[
                detail.chrono ? <span key="c" className="whitespace-nowrap font-mono">{detail.chrono}</span> : null,
                detail.rank ? <span key="r">Réponse n°{detail.rank}</span> : null,
                <span key="ch">{CHANNEL_LABELS[detail.channel] ?? detail.channel}</span>,
              ]
                .filter(Boolean)
                .flatMap((el, i) => (i === 0 ? [el] : [<span key={`s${i}`}>·</span>, el]))}
            </div>
            <h2 className="text-xl font-bold leading-snug tracking-tight [text-wrap:pretty]">{title}</h2>
            <p className="text-[13px] text-muted-foreground">
              {[
                detail.senderName ? `À ${detail.senderName}` : null,
                detail.serviceName ? `organisation gestionnaire ${detail.serviceName}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {detail.parentId && (
            <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full">
              <Link to={`/courrier/${detail.parentId}`}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Ouvrir le courrier
              </Link>
            </Button>
          )}
        </div>

        {banner && (
          <div className="flex shrink-0 items-center gap-2.5 rounded-xl border border-secondary/70 bg-secondary/20 px-3.5 py-2.5 text-[13.5px]">
            <Stamp className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <span>{banner}</span>
          </div>
        )}

        <article className="flex w-full max-w-[760px] shrink-0 flex-col gap-3.5 rounded-[14px] border bg-card px-10 py-8 text-[14.5px] leading-relaxed shadow-airbnb-sm">
          <div className="flex justify-between gap-4 text-[13px] text-muted-foreground">
            <span>
              {membership?.organization_name}
              {detail.serviceName && detail.serviceName !== membership?.organization_name && (
                <>
                  <br />
                  {detail.serviceName}
                </>
              )}
            </span>
            <span className="text-right">
              {isQueue && (
                <>
                  Le {longDate(new Date())}
                  <br />
                </>
              )}
              {detail.senderName}
            </span>
          </div>
          <div className="font-bold">Objet : {detail.reply.subject || title}</div>
          {detail.readableBody ? (
            <div
              className="prose prose-sm max-w-none text-[14.5px] leading-relaxed text-foreground [&_p]:my-0 [&_p+p]:mt-3.5"
              // Corps rédigé dans l'éditeur riche de Clara, déjà stocké en HTML.
              dangerouslySetInnerHTML={{ __html: detail.readableBody }}
            />
          ) : (
            <p className="text-muted-foreground">Le brouillon est vide pour le moment.</p>
          )}
          {showSignatureBlock && (
            <div className="mt-2 flex w-[220px] flex-col gap-1.5 self-end text-center text-[13px]">
              {signatory?.title && <span>{signatory.title},</span>}
              <div
                className={cn(
                  "grid h-16 place-items-center rounded-[10px] border-[1.5px] border-dashed text-xs",
                  detail.isSigned
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-warning bg-secondary/15 text-secondary-foreground",
                )}
              >
                {detail.isSigned ? "Signé électroniquement" : "Votre signature sera apposée ici"}
              </div>
              {signatory && (
                <span className="font-bold">{`${signatory.first_name} ${signatory.last_name}`.trim()}</span>
              )}
            </div>
          )}
        </article>

        {detail.visas.length > 0 && (
          <div className="flex w-full max-w-[760px] shrink-0 flex-col gap-2">
            <span className="text-[13px] font-semibold">Circuit de validation</span>
            <ReplyVisaTrail visas={detail.visas} />
          </div>
        )}

        {isQueue && detail.isUnconfigured && (
          <p className="text-sm text-muted-foreground">
            Aucun workflow de réponse n'est configuré pour cette organisation : aucune action ne peut être proposée ici.
          </p>
        )}
      </div>

      {isQueue && (primary || secondary.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t bg-card px-6 py-3">
          {isVisaAction ? (
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Commentaire de visa (facultatif)"
              maxLength={1000}
              aria-label="Commentaire de visa"
              className="h-10 min-w-[240px] flex-1 rounded-[10px]"
            />
          ) : (
            // La raison d'un blocage se lit en texte, jamais seulement sur un bouton gris.
            <p role="status" className="min-w-[200px] flex-1 text-[13px] text-muted-foreground">
              {primary?.disabledReason ?? ""}
            </p>
          )}
          {secondary.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => action.run()}
              className="h-10 shrink-0 rounded-[14px]"
            >
              {action.label}
            </Button>
          ))}
          {primary && (
            <Button
              type="button"
              disabled={isPending || !!primary.disabledReason}
              title={primary.disabledReason ?? undefined}
              onClick={() => primary.run(isVisaAction ? comment : undefined)}
              className="h-10 shrink-0 rounded-[14px] px-[18px] font-bold"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Stamp className="h-4 w-4" aria-hidden="true" />
              )}
              {primary.label}
            </Button>
          )}
          {isVisaAction && primary?.disabledReason && (
            <p role="status" className="w-full text-right text-[13px] text-muted-foreground">
              {primary.disabledReason}
            </p>
          )}
        </div>
      )}
    </>
  );
}
