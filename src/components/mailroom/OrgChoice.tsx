import { Briefcase, Check, Sparkles } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SocleOrgWithConfig } from "@/services/socleOrgConfigService";

interface Props {
  /** Organisations mises en avant (proposition de l'IA puis alternatives). */
  candidates: string[];
  /** La première candidate vient de l'IA : marquée d'une étincelle. */
  suggestedId: string | null;
  assignable: SocleOrgWithConfig[];
  value: string | null;
  onChange: (id: string) => void;
  label: string;
}

/**
 * Choix du service destinataire : les candidates en pastilles, et toute autre
 * organisation active dans la liste déroulante — l'IA propose, l'agent décide.
 */
export default function OrgChoice({ candidates, suggestedId, assignable, value, onChange, label }: Props) {
  const byId = new Map(assignable.map((o) => [o.id, o]));
  const chips = candidates.filter((id) => byId.has(id));
  const others = assignable.filter((o) => !chips.includes(o.id));
  const otherValue = value && !chips.includes(value) ? value : "";

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((id) => {
          const on = value === id;
          const Icon = on ? Check : id === suggestedId ? Sparkles : Briefcase;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(id)}
              className={cn(
                "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors hover:border-primary/50",
                on ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground",
              )}
            >
              <Icon className={cn("h-3 w-3 shrink-0", !on && id === suggestedId && "text-primary")} />
              <span className="truncate">{byId.get(id)!.name}</span>
            </button>
          );
        })}
      </div>
      {others.length > 0 && (
        <Select value={otherValue} onValueChange={onChange}>
          <SelectTrigger className={cn("h-9", otherValue && "border-primary text-primary")} aria-label="Autre service">
            <SelectValue placeholder={chips.length ? "Autre service…" : "Choisir un service…"} />
          </SelectTrigger>
          <SelectContent>
            {others.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
