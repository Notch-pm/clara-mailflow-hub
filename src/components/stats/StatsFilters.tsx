import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export type StatPeriod = "7d" | "30d" | "1y";

interface StatsFiltersProps {
  services: { id: string; name: string }[];
  /** UUID de l'organisation sélectionnée (miroir Socle), null = toutes. */
  socleOrgId: string | null;
  period: StatPeriod;
  onServiceChange: (socleOrganizationId: string | null) => void;
  onPeriodChange: (p: StatPeriod) => void;
}

const PERIOD_LABELS: Record<StatPeriod, string> = {
  "7d": "7 jours",
  "30d": "30 jours",
  "1y": "1 an",
};

export function StatsFilters({
  services,
  socleOrgId,
  period,
  onServiceChange,
  onPeriodChange,
}: StatsFiltersProps) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Select
        value={socleOrgId ?? "__all__"}
        onValueChange={(v) => onServiceChange(v === "__all__" ? null : v)}
      >
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Toutes les organisations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Toutes les organisations</SelectItem>
          {services.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex gap-1 rounded-lg border p-1">
        {(["7d", "30d", "1y"] as StatPeriod[]).map((p) => (
          <Button
            key={p}
            size="sm"
            variant={period === p ? "default" : "ghost"}
            className="h-7 px-3 text-xs"
            onClick={() => onPeriodChange(p)}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>
    </div>
  );
}
