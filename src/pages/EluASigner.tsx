import { OutboundKindBadge } from "@/components/courier/outbound/OutboundKindBadge";
import { EluCard, EluCardLinks } from "@/components/elu/EluCard";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluStatusPill } from "@/components/elu/EluStatusPill";
import { useEluSignatureQueue } from "@/hooks/useEluSignatureQueue";
import { waitingLabel } from "@/lib/elu-delay";
import { outboundMetaLine } from "@/lib/outbound-kind";

function subtitle(count: number, isSignatory: boolean): string {
  if (!isSignatory) return "Vous n'êtes pas désigné signataire dans cette organisation.";
  if (count === 0) return "Tout est signé";
  if (count === 1) return "1 courrier attend votre signature";
  return `${count} courriers attendent votre signature`;
}


export default function EluASigner() {
  const { items, count, isSignatory, isLoading } = useEluSignatureQueue();

  return (
    <EluScreen>
      <EluScreenHeader title="À signer" subtitle={isLoading ? null : subtitle(count, isSignatory)} />

      {isLoading ? (
        <EluEmptyState>Chargement…</EluEmptyState>
      ) : items.length === 0 ? (
        <EluEmptyState>Aucun courrier en attente de signature.</EluEmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            // La carte mène au courrier à signer ; les liens du dessous ouvrent
            // le courrier reçu et la fiche du destinataire. Des destinations
            // distinctes, donc des zones cliquables séparées et non imbriquées.
            <div key={item.replyId} className="flex flex-col">
              <EluCard
                to={`/elu/reponse/${item.replyId}`}
                title={item.title}
                meta={outboundMetaLine(item)}
                emphasis
                badge={
                  <span className="flex flex-wrap gap-2">
                    <OutboundKindBadge kind={item.kind} size="lg" />
                    <EluStatusPill tone="attente">{waitingLabel(item.waitingDays)}</EluStatusPill>
                  </span>
                }
              />
              <EluCardLinks
                parentCourierId={item.parentCourierId}
                recipientName={item.recipientName}
                recipientContactId={item.recipientContactId}
              />
            </div>
          ))}
        </div>
      )}
    </EluScreen>
  );
}
