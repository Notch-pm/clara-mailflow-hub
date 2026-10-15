import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Carte de la colonne latérale : plus compacte, titre seul. */
export function RailCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-5 shadow-airbnb-sm">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-base font-semibold leading-tight">{title}</h3>
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Une rubrique de carte latérale : libellé discret, valeur dessous. */
export function RailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** Ligne de la carte « Informations » : libellé à gauche, valeur à droite. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Valeur absente. */
export function EmptyValue() {
  return <span className="font-normal italic text-muted-foreground">—</span>;
}
