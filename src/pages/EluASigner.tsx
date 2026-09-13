import { Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { EluCard } from "@/components/elu/EluCard";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluStatusPill } from "@/components/elu/EluStatusPill";
import { useEluSignatureQueue } from "@/hooks/useEluSignatureQueue";
import { waitingLabel } from "@/lib/elu-delay";

function subtitle(count: number, isSignatory: boolean): string {
  if (!isSignatory) return "Vous n'êtes pas désigné signataire dans cette organisation.";
  if (count === 0) return "Tout est signé";
  if (count === 1) return "1 courrier attend votre signature";
  return `${count} courriers attendent votre signature`;
}

/** « De Thierry Henry · reçu le 04/09/2026 » */
function originLine(senderName: string | null, receivedAt: string | null): string | null {
  const parts = [
    senderName ? `De ${senderName}` : null,
    receivedAt ? `reçu le ${new Date(receivedAt).toLocaleDateString("fr-FR")}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
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
            // La carte mène à la réponse à signer ; le lien du dessous ouvre le
            // courrier reçu. Deux destinations distinctes, donc deux zones
            // cliquables séparées et non imbriquées.
            <div key={item.replyId} className="flex flex-col">
              <EluCard
                to={`/elu/reponse/${item.replyId}`}
                title={item.title}
                meta={originLine(item.senderName, item.receivedAt)}
                emphasis
                badge={<EluStatusPill tone="attente">{waitingLabel(item.waitingDays)}</EluStatusPill>}
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
