import { useNavigate, useParams } from "react-router-dom";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluSignFooter } from "@/components/elu/EluSignFooter";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useEluReply } from "@/hooks/useEluReply";
import { useSignAndAdvance } from "@/hooks/useSignAndAdvance";
import { ReplyVisaTrail } from "@/components/courier/ReplyVisaTrail";
import { visaPersonName } from "@/services/courierVisaService";

/** « Réponse n°2 · courrier 2026-E-00025 · service Environnement » */
function metaLine(parts: Array<string | null>): string {
  return parts.filter(Boolean).join(" · ");
}

export default function EluReponse() {
  const { replyId } = useParams<{ replyId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const detail = useEluReply(replyId);

  const signatory = detail.signatories.find((s) => s.id === detail.signatoryId) ?? null;
  const canVisa = detail.viseurs.some((v) => v.id === user?.id);
  const visaPending = detail.isVisaState && !detail.activeVisa;
  // Viser à la place du désigné est permis ; on le dit avant, la trace le dira après.
  const visaOnBehalf =
    visaPending && canVisa && !!detail.designatedViseurId && detail.designatedViseurId !== user?.id;

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
    // On revient à la file d'où l'on vient : celle des visas pour un visa.
    onDone: () => navigate(visaPending ? "/elu/a-viser" : "/elu/a-signer", { replace: true }),
  });

  if (detail.isLoading) {
    return (
      <EluScreen>
        <EluScreenHeader title="Réponse" withBack />
        <EluEmptyState>Chargement…</EluEmptyState>
      </EluScreen>
    );
  }

  if (!detail.reply) {
    return (
      <EluScreen>
        <EluScreenHeader title="Réponse introuvable" withBack />
        <EluEmptyState>Ce courrier n'existe plus, ou ne vous est pas accessible.</EluEmptyState>
      </EluScreen>
    );
  }

  return (
    <>
      <EluScreen>
        <EluScreenHeader
          title={detail.parent?.subject || detail.reply.subject || "Sans objet"}
          subtitle={metaLine([
            detail.rank ? `Réponse n°${detail.rank}` : null,
            detail.chrono ? `courrier ${detail.chrono}` : null,
            detail.serviceName ? `service ${detail.serviceName}` : null,
          ])}
          withBack
        />

        {/* Ce que l'usager a demandé : on ne signe pas une réponse sans pouvoir
            relire la demande. */}
        {detail.parentId && (
          <div className="flex flex-col gap-1.5 border-l-[3px] pl-4">
            <span className="text-sm font-bold text-muted-foreground">La demande reçue</span>
            <span className="text-base leading-relaxed text-foreground">
              {detail.senderName ? `De ${detail.senderName}` : "Expéditeur non renseigné"}
              {detail.parent?.received_at
                ? `, reçue le ${new Date(detail.parent.received_at).toLocaleDateString("fr-FR")}`
                : ""}
            </span>
            <button
              type="button"
              onClick={() => navigate(`/elu/courrier/${detail.parentId}`)}
              className="min-h-11 self-start text-left text-base font-bold text-primary"
            >
              Lire le courrier reçu
            </button>
            {detail.senderContactId && (
              <button
                type="button"
                onClick={() => navigate(`/elu/usager/${detail.senderContactId}`)}
                className="min-h-11 self-start text-left text-base font-bold text-primary"
              >
                Voir la fiche de {detail.senderName}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3.5 rounded-[--radius] border bg-card p-[18px] shadow-airbnb-sm">
          <span className="text-sm font-bold text-muted-foreground">
            Réponse préparée par le service
          </span>
          {detail.readableBody ? (
            <div
              className="prose prose-sm max-w-none text-[17px] leading-relaxed text-foreground [&_p]:my-2"
              // Corps rédigé dans l'éditeur riche de Clara, déjà stocké en HTML.
              dangerouslySetInnerHTML={{ __html: detail.readableBody }}
            />
          ) : (
            <span className="text-[17px] text-muted-foreground">
              Le brouillon est vide pour le moment.
            </span>
          )}
        </div>

        {/* Le visa : qui est attendu, puis la trace de ceux déjà donnés. */}
        {visaPending && (
          <div className="flex flex-col gap-1 rounded-[--radius] border border-secondary bg-secondary/15 p-4">
            <span className="text-[17px] font-semibold text-foreground">
              {detail.currentState?.name ? `Étape « ${detail.currentState.name} »` : "Étape de visa"}
            </span>
            <span className="text-base leading-relaxed text-foreground">
              {detail.designatedViseurId === user?.id
                ? "Votre visa est attendu."
                : detail.designatedViseur
                  ? `En attente du visa de ${visaPersonName(detail.designatedViseur)}.`
                  : "En attente du visa d'un viseur de l'organisation."}
            </span>
            {visaOnBehalf && (
              <span className="text-[15px] text-muted-foreground">
                Vous pouvez viser à sa place : la trace le mentionnera.
              </span>
            )}
          </div>
        )}

        {detail.visas.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold text-muted-foreground">Visas</span>
            <ReplyVisaTrail visas={detail.visas} />
          </div>
        )}

        {detail.isUnconfigured && (
          <EluEmptyState>
            Aucun workflow de réponse n'est configuré pour cette organisation : les actions ne
            peuvent pas être proposées ici.
          </EluEmptyState>
        )}
      </EluScreen>

      <EluSignFooter primary={primary} secondary={secondary} isPending={isPending} />
    </>
  );
}
