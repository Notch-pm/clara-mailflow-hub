import { Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { EluCard } from "@/components/elu/EluCard";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluStatusPill } from "@/components/elu/EluStatusPill";
import { useEluVisaQueue, type EluVisaItem } from "@/hooks/useEluVisaQueue";
import { waitingLabel } from "@/lib/elu-delay";

function subtitle(count: number, isViseur: boolean): string {
  if (!isViseur) return "Vous n'êtes pas désigné viseur dans cette organisation.";
  if (count === 0) return "Tout est visé";
  if (count === 1) return "1 réponse attend votre visa";
  return `${count} réponses attendent votre visa`;
}

/** « Étape Visa du DGS · de Thierry Henry · reçu le 04/09/2026 » */
function metaLine(item: EluVisaItem): string | null {
  const parts = [
    item.stateName ? `Étape « ${item.stateName} »` : null,
    item.senderName ? `de ${item.senderName}` : null,
    item.receivedAt ? `reçu le ${new Date(item.receivedAt).toLocaleDateString("fr-FR")}` : null,
  ].filter(Boolean);
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
            // Deux destinations — la réponse à viser, le courrier reçu — donc
            // deux zones cliquables séparées, comme dans « À signer ».
            <div key={item.replyId} className="flex flex-col">
              <EluCard
                to={`/elu/reponse/${item.replyId}`}
                title={item.title}
                meta={metaLine(item)}
                emphasis
                badge={
                  <span className="flex flex-wrap gap-2">
                    {item.waitingSince && (
                      <EluStatusPill tone="attente">{waitingLabel(item.waitingDays)}</EluStatusPill>
                    )}
                    {/* Viser à la place du désigné est permis et tracé : on le
                        dit avant d'ouvrir, pas seulement après. */}
                    {item.designatedToOther && <EluStatusPill>Un autre viseur est désigné</EluStatusPill>}
                  </span>
                }
              />
              {item.parentCourierId && (
                <Link
                  to={`/elu/courrier/${item.parentCourierId}`}
                  className="flex min-h-11 items-center gap-2 self-start px-4 pt-1.5 text-[15px] font-bold text-primary"
                >
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Lire le courrier reçu
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </EluScreen>
  );
}
