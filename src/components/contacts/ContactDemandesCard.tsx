import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useContactIrisRequests } from "@/hooks/useContactIrisRequests";
import { irisSourceLabel, irisStatusLabel, irisStatusVariant } from "@/lib/iris";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("fr-FR") : "—";
}

/**
 * Demandes de l'usager instruites dans Iris, toutes origines confondues
 * (portail, guichet, courrier). Lecture seule : Iris en est propriétaire.
 * Chaque ligne ouvre le détail de la demande (`/demandes/:id`), qui mène au
 * courrier d'origine quand elle en vient.
 */
export default function ContactDemandesCard({ socleContactId }: { socleContactId: string }) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useContactIrisRequests(socleContactId);

  // Tenant non raccordé à Iris : rien à montrer, et rien à signaler.
  if (data === null) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Demandes</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {isError && <p className="text-sm text-muted-foreground">Demandes indisponibles pour le moment.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune demande pour cet usager.</p>
        )}
        {data && data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Démarche</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => navigate(`/demandes/${d.id}`)}>
                  <TableCell className="font-mono text-xs">{d.reference ?? "—"}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{d.subject ?? "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate">
                    {d.procedure_label ?? "—"}
                    {d.organization_label && (
                      <span className="block truncate text-xs text-muted-foreground">{d.organization_label}</span>
                    )}
                  </TableCell>
                  <TableCell>{irisSourceLabel(d.source) ?? "—"}</TableCell>
                  <TableCell>{formatDate(d.received_at)}</TableCell>
                  <TableCell>
                    <Badge variant={irisStatusVariant(d.status)}>{irisStatusLabel(d.status) ?? "—"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
