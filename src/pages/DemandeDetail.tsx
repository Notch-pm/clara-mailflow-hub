import { ArrowLeft, Mail, User } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DemandeFil from "@/components/fil/DemandeFil";
import { useIrisRequestDetail } from "@/hooks/useContactIrisRequests";
import { irisSourceLabel, irisStatusLabel, irisStatusVariant } from "@/lib/iris";

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value?.trim() || "—"}</div>
    </div>
  );
}

const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : null);

/**
 * Une demande instruite dans Iris, en lecture seule : ce que l'usager a
 * demandé, où en est l'instruction, et son fil (interventions, commentaires
 * internes, activité). Ouverte depuis la fiche contact.
 */
export default function DemandeDetail() {
  const { irisRequestId } = useParams<{ irisRequestId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useIrisRequestDetail(irisRequestId);

  const back = (
    <Button variant="ghost" onClick={() => navigate(-1)}>
      <ArrowLeft className="h-4 w-4 mr-2" /> Retour
    </Button>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {back}
        <Card><CardContent className="py-10 text-center text-muted-foreground">Chargement…</CardContent></Card>
      </div>
    );
  }

  if (isError || !data) {
    const notFound = (error as { status?: number } | null)?.status === 404;
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="font-medium">{notFound || !isError ? "Demande introuvable" : "Demande indisponible"}</p>
            <p className="text-sm text-muted-foreground">
              {notFound || !isError
                ? "Cette demande n'existe pas, ou relève d'une organisation qui n'est pas la vôtre."
                : "Iris ne répond pas pour le moment. Réessayez dans un instant."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { demande } = data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {back}
        <div className="flex items-center gap-2">
          {demande.socle_contact_id && (
            <Button variant="outline" onClick={() => navigate(`/contacts/${demande.socle_contact_id}`)}>
              <User className="h-4 w-4 mr-2" /> Fiche de l'usager
            </Button>
          )}
          {demande.courier_id && (
            <Button variant="outline" onClick={() => navigate(`/courrier/${demande.courier_id}`)}>
              <Mail className="h-4 w-4 mr-2" /> Courrier d'origine
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="text-xl">{demande.subject || demande.procedure_label || "Demande"}</CardTitle>
            <Badge variant={irisStatusVariant(demande.status)}>{irisStatusLabel(demande.status) ?? "—"}</Badge>
            <Badge variant="outline" className="ml-auto">Instruite dans Iris</Badge>
          </div>
          <div className="text-xs text-muted-foreground font-mono">{demande.reference}</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoRow label="Démarche" value={demande.procedure_label} />
            <InfoRow label="Organisme" value={demande.organization_label} />
            <InfoRow label="Origine" value={irisSourceLabel(demande.source)} />
            <InfoRow label="Reçue le" value={day(demande.received_at)} />
          </div>
          {demande.body && (
            <div className="rounded-md border bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground mb-1">Ce que demande l'usager</div>
              <div className="text-sm whitespace-pre-wrap">{demande.body}</div>
            </div>
          )}
          {demande.closure_text && (
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground mb-1">
                Réponse apportée{demande.closed_at ? ` le ${day(demande.closed_at)}` : ""}
              </div>
              <div className="text-sm whitespace-pre-wrap">{demande.closure_text}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <DemandeFil detail={data} />
        </CardContent>
      </Card>
    </div>
  );
}
