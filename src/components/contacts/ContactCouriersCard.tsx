import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ConfidentialBadge } from "@/components/courier/ConfidentialBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/contact-labels";
import { contactCouriersQuery } from "@/hooks/useContactDetail";

/** Courriers (Clara) qui référencent cette fiche du référentiel. */
export default function ContactCouriersCard({ organizationId, contactId }: { organizationId: string; contactId: string }) {
  const navigate = useNavigate();
  const couriersQuery = useQuery(contactCouriersQuery(organizationId, contactId));
  const couriers = couriersQuery.data;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Courriers liés</CardTitle>
      </CardHeader>
      <CardContent>
        {couriersQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {couriersQuery.isError && (
          <p className="text-sm text-muted-foreground">Courriers liés indisponibles.</p>
        )}
        {couriers && couriers.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun courrier lié à ce contact.</p>
        )}
        {couriers && couriers.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chrono</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Sens</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>État</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {couriers.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/courrier/${c.id}`)}
                >
                  <TableCell className="font-mono text-xs">{c.chrono ?? "—"}</TableCell>
                  <TableCell className="max-w-[320px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {c.is_confidential && <ConfidentialBadge compact />}
                      <span className={c.is_confidential && !c.can_read ? "truncate italic text-muted-foreground" : "truncate"}>
                        {c.subject ?? "—"}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>{c.direction === "inbound" ? "Entrant" : "Sortant"}</TableCell>
                  <TableCell>{formatDate(c.received_at ?? c.sent_at ?? c.created_at)}</TableCell>
                  <TableCell>{c.workflow_state?.name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
