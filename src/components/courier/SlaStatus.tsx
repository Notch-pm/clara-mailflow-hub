import { Clock } from "lucide-react";
import { StatusDot, type StatusTone } from "@/components/list/ListCells";
import { cn } from "@/lib/utils";
import {
  SLA_AXIS_LABELS,
  formatDay,
  parisDay,
  primarySla,
  slaLabel,
  type CourierSla,
  type SlaKind,
  type SlaStatus,
} from "@/lib/courier-sla";

const TONE: Record<SlaKind, StatusTone> = {
  none: "muted",
  pending: "muted",
  due_soon: "warning",
  overdue: "destructive",
  met: "success",
  missed: "destructive",
};

/** Pastille + libellé d'une échéance (« En retard de 2 jours ouvrés »). */
export function SlaStatusDot({ status, prefix }: { status: SlaStatus; prefix?: string }) {
  const today = parisDay(new Date())!;
  const label = slaLabel(status, today);
  return <StatusDot label={prefix ? `${prefix} · ${label}` : label} tone={TONE[status.kind]} />;
}

function longDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

function businessDays(n: number) {
  return `${n} ${n > 1 ? "jours ouvrés" : "jour ouvré"}`;
}

/**
 * L'échéance qui presse, en une phrase pour l'en-tête de la fiche : « Réponse
 * due le 16 octobre, dans 3 jours ouvrés ». Rien quand tout est fait ou sans
 * objectif — l'en-tête ne parle que de ce qui reste à faire.
 */
export function slaHeadline(sla: CourierSla): { kind: SlaKind; label: string } | null {
  const primary = primarySla(sla);
  if (!primary) return null;
  const { axis, status } = primary;
  const { kind, dueDay, margin } = status;
  if (!dueDay || (kind !== "pending" && kind !== "due_soon" && kind !== "overdue")) return null;

  const what = axis === "ack" ? "Accusé de réception" : "Réponse";
  const today = parisDay(new Date())!;
  const label =
    kind === "overdue"
      ? `${what} en retard de ${businessDays(Math.abs(margin ?? 0) || 1)}, échéance le ${longDay(dueDay)}`
      : `${what} ${axis === "ack" ? "dû" : "due"} le ${longDay(dueDay)}, ${
          dueDay === today ? "aujourd'hui" : `dans ${businessDays(Math.max(margin ?? 0, 1))}`
        }`;
  return { kind, label };
}

export function SlaHeadline({ sla, className }: { sla: CourierSla; className?: string }) {
  const headline = slaHeadline(sla);
  if (!headline) return null;
  const { kind, label } = headline;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold",
        kind === "overdue"
          ? "text-destructive"
          : kind === "due_soon"
            ? "text-amber-700 dark:text-amber-400"
            : "text-foreground",
        className,
      )}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

/** Les deux échéances d'un courrier, pour la colonne de contexte de la fiche. */
export function CourierSlaDetails({ sla }: { sla: CourierSla }) {
  return (
    <dl className="space-y-3">
      {(["ack", "resolution"] as const).map((axis) => {
        const status = sla[axis];
        return (
          <div key={axis} className="space-y-1">
            <dt className="text-xs font-semibold text-muted-foreground">{SLA_AXIS_LABELS[axis]}</dt>
            <dd className="space-y-0.5">
              <SlaStatusDot status={status} />
              {status.dueDay && (
                <div className="text-xs text-muted-foreground">Échéance : {formatDay(status.dueDay)}</div>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
