import { StatusDot, type StatusTone } from "@/components/list/ListCells";
import {
  SLA_AXIS_LABELS,
  formatDay,
  parisDay,
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
