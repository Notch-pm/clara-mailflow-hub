import { Link, useParams } from "react-router-dom";
import DemandeFil from "@/components/fil/DemandeFil";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluStatusPill } from "@/components/elu/EluStatusPill";
import { useIrisRequestDetail } from "@/hooks/useContactIrisRequests";
import { irisSourceLabel, irisStatusLabel } from "@/lib/iris";

/**
 * Une demande instruite dans Iris, vue par l'élu : ce que l'usager demande, où
 * en est l'instruction, puis interventions, commentaires internes et activité.
 * Lecture seule — l'élu suit, Iris instruit.
 */
export default function EluDemande() {
  const { irisRequestId } = useParams<{ irisRequestId: string }>();
  const { data, isLoading, isError, error } = useIrisRequestDetail(irisRequestId);

  if (isLoading) {
    return (
      <EluScreen>
        <EluScreenHeader title="Demande" withBack />
        <EluEmptyState>Chargement…</EluEmptyState>
      </EluScreen>
    );
  }

  if (isError || !data) {
    const unavailable = isError && (error as { status?: number } | null)?.status !== 404;
    return (
      <EluScreen>
        <EluScreenHeader title={unavailable ? "Demande indisponible" : "Demande introuvable"} withBack />
        <EluEmptyState>
          {unavailable
            ? "Iris ne répond pas pour le moment. Réessayez dans un instant."
            : "Cette demande n'existe pas, ou relève d'une organisation qui n'est pas la vôtre."}
        </EluEmptyState>
      </EluScreen>
    );
  }

  const { demande } = data;
  const meta = [
    demande.reference,
    irisSourceLabel(demande.source),
    demande.received_at ? `reçue le ${new Date(demande.received_at).toLocaleDateString("fr-FR")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <EluScreen>
      <EluScreenHeader title={demande.procedure_label ?? demande.subject ?? "Demande"} subtitle={meta} withBack />

      <div className="flex flex-wrap items-center gap-2.5">
        {demande.status && <EluStatusPill>{irisStatusLabel(demande.status)}</EluStatusPill>}
        {demande.organization_label && (
          <span className="text-[15px] text-muted-foreground">{demande.organization_label}</span>
        )}
      </div>

      <div className="flex flex-col gap-2.5 border-l-[3px] pl-4">
        <span className="text-sm font-bold text-muted-foreground">Ce que demande l'usager</span>
        {demande.subject && demande.subject !== demande.procedure_label && (
          <span className="text-[17px] font-semibold text-foreground">{demande.subject}</span>
        )}
        {demande.body ? (
          <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground [text-wrap:pretty]">{demande.body}</p>
        ) : (
          <p className="text-base text-muted-foreground">Aucun texte libre : la demande tient dans son formulaire.</p>
        )}
      </div>

      {demande.closure_text && (
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <span className="text-sm font-bold text-muted-foreground">
            Réponse apportée{demande.closed_at ? ` le ${new Date(demande.closed_at).toLocaleDateString("fr-FR")}` : ""}
          </span>
          <p className="whitespace-pre-wrap text-base text-foreground">{demande.closure_text}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {demande.socle_contact_id && (
          <Link to={`/elu/usager/${demande.socle_contact_id}`} className="text-base font-bold text-primary">
            Fiche de l'usager
          </Link>
        )}
        {demande.courier_id && (
          <Link to={`/elu/courrier/${demande.courier_id}`} className="text-base font-bold text-primary">
            Courrier d'origine
          </Link>
        )}
      </div>

      <DemandeFil detail={data} large />
    </EluScreen>
  );
}
