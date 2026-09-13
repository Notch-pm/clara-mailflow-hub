import { FileText, User } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluStatusPill } from "@/components/elu/EluStatusPill";
import { useEluCourrier } from "@/hooks/useEluCourrier";

const CHANNEL_LABELS: Record<string, string> = {
  email: "par courriel",
  paper: "par courrier papier",
  form: "par formulaire",
  phone: "par téléphone",
  counter: "au guichet",
};

export default function EluCourrier() {
  const { courierId } = useParams<{ courierId: string }>();
  const detail = useEluCourrier(courierId);

  if (detail.isLoading) {
    return (
      <EluScreen>
        <EluScreenHeader title="Courrier reçu" withBack />
        <EluEmptyState>Chargement…</EluEmptyState>
      </EluScreen>
    );
  }

  if (!detail.courier) {
    return (
      <EluScreen>
        <EluScreenHeader title="Courrier introuvable" withBack />
        <EluEmptyState>Ce courrier n'existe plus, ou ne vous est pas accessible.</EluEmptyState>
      </EluScreen>
    );
  }

  const { courier } = detail;
  const received = courier.received_at ?? courier.created_at;
  const meta = [
    courier.chrono,
    received ? `reçu le ${new Date(received).toLocaleDateString("fr-FR")}` : null,
    courier.channel ? CHANNEL_LABELS[courier.channel] ?? null : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <EluScreen>
      <EluScreenHeader title={courier.subject ?? "Sans objet"} subtitle={meta} withBack />

      <div className="flex flex-wrap items-center gap-2.5">
        {detail.stateName && <EluStatusPill>{detail.stateName}</EluStatusPill>}
        {courier.assigned_service && (
          <span className="text-[15px] text-muted-foreground">{courier.assigned_service}</span>
        )}
      </div>

      {detail.senderName && (
        <div className="flex items-center gap-3.5 rounded-[--radius] border bg-card p-4 shadow-airbnb-sm">
          <User className="h-[22px] w-[22px] shrink-0 text-primary" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[17px] font-semibold text-foreground">{detail.senderName}</span>
            {detail.senderEmail && (
              <span className="truncate text-sm text-muted-foreground">{detail.senderEmail}</span>
            )}
          </span>
          {detail.senderContactId && (
            <Link
              to={`/elu/usager/${detail.senderContactId}`}
              className="shrink-0 text-base font-bold text-primary"
            >
              Sa fiche
            </Link>
          )}
        </div>
      )}

      {/* Le résumé produit par l'analyse : l'élu juge sur le fond sans ouvrir
          les pièces jointes, qu'il ne pourrait de toute façon pas annoter ici. */}
      <div className="flex flex-col gap-2.5 border-l-[3px] pl-4">
        <span className="text-sm font-bold text-muted-foreground">Ce que demande l'usager</span>
        {detail.summary ? (
          <p className="text-base leading-relaxed text-foreground [text-wrap:pretty]">
            {detail.summary}
          </p>
        ) : (
          <p className="text-base text-muted-foreground">
            Ce courrier n'a pas encore été analysé : son contenu n'est lisible que depuis
            l'application complète.
          </p>
        )}
        {detail.intents.length > 0 && (
          <span className="flex flex-wrap gap-2 pt-1">
            {detail.intents.map((intent) => (
              <EluStatusPill key={intent}>{intent}</EluStatusPill>
            ))}
          </span>
        )}
      </div>

      {detail.documents.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h2 className="text-[19px] font-bold text-foreground">
            {detail.documents.length === 1
              ? "1 pièce jointe"
              : `${detail.documents.length} pièces jointes`}
          </h2>
          {detail.documents.map((doc) => (
            <div
              key={doc.id}
              className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 text-[17px] text-foreground"
            >
              <FileText className="h-[22px] w-[22px] shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 break-words">{doc.file_name ?? "Document sans nom"}</span>
            </div>
          ))}
        </div>
      )}
    </EluScreen>
  );
}
