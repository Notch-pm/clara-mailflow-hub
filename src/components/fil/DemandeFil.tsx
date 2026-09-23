import { Badge } from "@/components/ui/badge";
import { FilEntry, FilSection } from "@/components/fil/Fil";
import { filMeta } from "@/lib/fil";
import { describeIrisEvent, formatIrisDay, interventionStatusLabel } from "@/lib/iris-timeline";
import type { DemandeDetail } from "@/services/irisContactRequestService";

/**
 * Bas de page d'une demande Iris : interventions, commentaires internes (notes
 * des agents d'Iris — réservées aux membres de la collectivité, jamais à
 * l'usager), activité. Lecture seule.
 */
export default function DemandeFil({ detail, large = false }: { detail: DemandeDetail; large?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <FilSection title="Demandes d'intervention" count={detail.interventions.length} empty="Aucune intervention demandée." large={large}>
        {detail.interventions.map((i, idx) => (
          <FilEntry
            key={idx}
            large={large}
            title={i.intervenant ?? "Intervenant non précisé"}
            badge={
              <Badge variant={i.status === "realisee" ? "secondary" : "default"}>{interventionStatusLabel(i.status)}</Badge>
            }
            detail={
              i.status === "realisee"
                ? i.completed_on
                  ? `Réalisée le ${formatIrisDay(i.completed_on)}`
                  : null
                : i.requested_for
                  ? `Prévue pour le ${formatIrisDay(i.requested_for)}`
                  : null
            }
            body={[i.request_comment, i.completion_comment ? `Compte rendu : ${i.completion_comment}` : null]
              .filter(Boolean)
              .join("\n\n") || null}
            meta={i.requested_at ? `Demandée le ${formatIrisDay(i.requested_at)}` : null}
          />
        ))}
      </FilSection>

      <FilSection title="Commentaires internes" count={detail.notes.length} empty="Aucun commentaire interne." large={large}>
        {detail.notes.map((n, idx) => (
          <FilEntry key={idx} large={large} title={n.by ?? "Agent"} body={n.body} meta={filMeta(n.at)} />
        ))}
      </FilSection>

      <FilSection title="Activité" count={detail.events.length} empty="Aucune activité enregistrée." large={large}>
        {detail.events.map((e, idx) => {
          const { title, detail: text } = describeIrisEvent(e);
          return <FilEntry key={idx} large={large} title={title} detail={text} meta={filMeta(e.at, e.by)} />;
        })}
      </FilSection>
    </div>
  );
}
