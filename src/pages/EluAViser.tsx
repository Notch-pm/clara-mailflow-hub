import { OutboundKindBadge } from "@/components/courier/outbound/OutboundKindBadge";
import { EluCard, EluCardLinks } from "@/components/elu/EluCard";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluStatusPill } from "@/components/elu/EluStatusPill";
import { useEluVisaQueue, type EluVisaItem } from "@/hooks/useEluVisaQueue";
import { waitingLabel } from "@/lib/elu-delay";
import { outboundMetaLine } from "@/lib/outbound-kind";

function subtitle(count: number, isViseur: boolean): string {
  if (!isViseur) return "Vous n'êtes pas désigné viseur dans cette organisation.";
  if (count === 0) return "Tout est visé";
  if (count === 1) return "1 réponse attend votre visa";
  return `${count} réponses attendent votre visa`;
}

/** « Étape « Visa du DGS » · À Thierry Henry · courrier reçu le 04/09/2026 » */
function metaLine(item: EluVisaItem): string | null {
  const parts = [item.stateName ? `Étape « ${item.stateName} »` : null, outboundMetaLine(item)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export default function EluAViser() {
  const { items, count, isViseur, isLoading } = useEluVisaQueue();

  return (
    <EluScreen>
      <EluScreenHeader title="À viser" subtitle={isLoading ? null : subtitle(count, isViseur)} />

      {isLoading ? (
        <EluEmptyState>Chargement…</EluEmptyState>
      ) : items.length === 0 ? (
        <EluEmptyState>Aucune réponse en attente de visa.</EluEmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            // Plusieurs destinations — le courrier à viser, le courrier reçu, la
            // fiche du destinataire — donc des zones cliquables séparées.
            <div key={item.replyId} className="flex flex-col">
              <EluCard
                to={`/elu/reponse/${item.replyId}`}
                title={item.title}
                meta={metaLine(item)}
                emphasis
                badge={
                  <span className="flex flex-wrap gap-2">
                    <OutboundKindBadge kind={item.kind} size="lg" />
                    {item.waitingSince && (
                      <EluStatusPill tone="attente">{waitingLabel(item.waitingDays)}</EluStatusPill>
                    )}
                    {/* Viser à la place du désigné est permis et tracé : on le
                        dit avant d'ouvrir, pas seulement après. */}
                    {item.designatedToOther && <EluStatusPill>Un autre viseur est désigné</EluStatusPill>}
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
