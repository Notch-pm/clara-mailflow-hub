import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Mailbox } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getPostalSendingSettings,
  listPostalSendings,
  updatePostalSendingSettings,
} from "@/services/postalSendingService";
import {
  POSTAL_SENDING_EXPLANATION,
  formatEuros,
  monthTotalTtc,
  parseDailyCap,
  postalSendingStatusLabel,
} from "@/lib/postal-sending";
import { postalModeLabel } from "@/lib/outbound-channel";

interface Props {
  organizationId: string;
}

/**
 * Envois papiers réels : l'administrateur autorise les agents à faire imprimer
 * et poster un courrier par le prestataire (Merci Facteur). Chaque envoi est
 * facturé ; le journal ci-dessous en garde le prix.
 */
export default function PostalSendingSettings({ organizationId }: Props) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["postal-sending-settings", organizationId],
    queryFn: () => getPostalSendingSettings(organizationId),
  });
  const { data: sendings = [] } = useQuery({
    queryKey: ["postal-sendings", organizationId],
    queryFn: () => listPostalSendings(organizationId),
  });

  const [capInput, setCapInput] = useState("");
  useEffect(() => {
    if (settings) setCapInput(String(settings.dailyCap));
  }, [settings]);

  const save = useMutation({
    mutationFn: (patch: { enabled?: boolean; dailyCap?: number }) => updatePostalSendingSettings(organizationId, patch),
    onSuccess: (_, patch) => {
      queryClient.invalidateQueries({ queryKey: ["postal-sending-settings", organizationId] });
      if (patch.enabled !== undefined) {
        toast.success(patch.enabled ? "Envois papiers réels activés" : "Envois papiers réels désactivés");
      } else {
        toast.success("Plafond enregistré");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cap = parseDailyCap(capInput);
  const month = monthTotalTtc(sendings);

  if (isLoading || !settings) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start gap-4 space-y-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Mailbox className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="flex-1 space-y-1">
            <CardTitle className="text-base">Envois papiers réels</CardTitle>
            <CardDescription>
              Les agents peuvent faire imprimer et poster une lettre par le prestataire, au lieu de la poster eux-mêmes.
            </CardDescription>
          </div>
          <Switch
            id="postal-sending-enabled"
            aria-label="Envois papiers réels"
            checked={settings.enabled}
            disabled={save.isPending}
            onCheckedChange={(v) => save.mutate({ enabled: v })}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <p>{POSTAL_SENDING_EXPLANATION}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="postal-daily-cap" className="text-sm">Plafond d'envois par 24 heures</Label>
              <Input
                id="postal-daily-cap"
                inputMode="numeric"
                value={capInput}
                onChange={(e) => setCapInput(e.target.value)}
                className="h-9 w-[120px]"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={save.isPending || cap === null || cap === settings.dailyCap}
              onClick={() => cap !== null && save.mutate({ dailyCap: cap })}
            >
              Enregistrer
            </Button>
            {cap === null && <p className="text-xs text-destructive">Un nombre entre 0 et 1000.</p>}
          </div>
          <p className="text-xs text-muted-foreground">
            Au-delà, l'envoi par le prestataire est refusé jusqu'au lendemain : un garde-fou contre un envoi en boucle.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Derniers envois par le prestataire</CardTitle>
          <CardDescription>
            Ce mois-ci : {month.count} envoi{month.count > 1 ? "s" : ""}, {formatEuros(month.total)} TTC.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sendings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun envoi pour l'instant.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Courrier</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Prix TTC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sendings.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(s.sent_at ?? s.requested_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{s.courier?.chrono ?? "—"}</span>
                      {s.courier?.subject ? <span className="text-muted-foreground"> · {s.courier.subject}</span> : null}
                    </TableCell>
                    <TableCell>{postalModeLabel(s.mode) ?? s.mode}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "failed" || s.status === "to_verify" ? "destructive" : "secondary"}>
                        {postalSendingStatusLabel(s.status)}
                      </Badge>
                      {s.last_event ? <span className="ml-1.5 text-xs text-muted-foreground">{s.last_event}</span> : null}
                    </TableCell>
                    <TableCell className="text-right">{formatEuros(s.price_ttc)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
