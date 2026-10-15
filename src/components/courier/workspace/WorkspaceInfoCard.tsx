import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatLongDate } from "@/lib/courier-workspace";
import { channelLabels, type WorkspaceCourier } from "@/hooks/useCourierWorkspace";
import type { CourierChannel } from "@/types/courier";
import InlineEditField from "../InlineEditField";
import { EmptyValue, InfoRow } from "./RailParts";

interface Props {
  courier: WorkspaceCourier;
  isOutbound: boolean;
  isInitiative: boolean;
  readOnly: boolean;
  persistCourierUpdate: (patch: Record<string, unknown>, successMessage?: string) => Promise<void>;
}

/**
 * Métadonnées secondaires, repliées : la confidentialité n'apparaît en
 * en-tête que lorsqu'elle est active.
 */
export function WorkspaceInfoCard({ courier, isOutbound, isInitiative, readOnly, persistCourierUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const isConfidential = !!courier.is_confidential;

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card className="p-5 shadow-airbnb-sm">
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-left">
          <h3 className="flex-1 text-base font-semibold leading-tight">Informations</h3>
          {!open && (
            <span className="text-xs text-muted-foreground">
              {isOutbound ? "Référence, date…" : "Référence, canal…"}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="mt-3 flex flex-col gap-2.5">
            <InfoRow label="Référence">
              <span className="font-mono text-xs font-normal">{courier.chrono ?? <EmptyValue />}</span>
            </InfoRow>
            <InfoRow label={isOutbound ? "Date d'envoi" : "Date de réception"}>
              <InlineEditField
                label=""
                type="date"
                value={
                  isOutbound
                    ? (courier.sent_at as string | null)?.slice(0, 10) ?? ""
                    : courier.received_at?.slice(0, 10) ?? ""
                }
                // La date d'envoi d'un courrier à l'initiative est posée par
                // l'envoi lui-même : elle ne se saisit pas.
                readOnly={readOnly || isInitiative}
                displayClassName="text-sm font-semibold"
                onSave={(v) =>
                  persistCourierUpdate(
                    isOutbound
                      ? { sent_at: v ? new Date(v).toISOString() : null }
                      : { received_at: v ? new Date(v).toISOString() : null },
                    "Date modifiée",
                  )
                }
                renderDisplay={(v) => formatLongDate(v)}
              />
            </InfoRow>
            {!isOutbound && (
              <InfoRow label="Canal">
                {readOnly ? (
                  channelLabels[courier.channel]
                ) : (
                  <Select
                    value={courier.channel}
                    onValueChange={(v) => persistCourierUpdate({ channel: v }, "Canal modifié")}
                  >
                    <SelectTrigger className="-mr-2 h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-sm font-semibold shadow-none hover:bg-muted">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {(Object.keys(channelLabels) as CourierChannel[]).map((c) => (
                        <SelectItem key={c} value={c}>
                          {channelLabels[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </InfoRow>
            )}
            <InfoRow label="Confidentialité">{isConfidential ? "Oui" : "Non"}</InfoRow>
            {courier.socle_organization?.name && (
              <InfoRow label="Organisation d'origine">{courier.socle_organization.name}</InfoRow>
            )}
            {isOutbound && courier.parent_courier_id && (
              <InfoRow label="Courrier lié">
                <Link
                  to={`/courrier/${courier.parent_courier_id}`}
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Courrier entrant
                </Link>
              </InfoRow>
            )}
          </dl>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
