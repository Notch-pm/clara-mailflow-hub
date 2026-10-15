import { useState } from "react";
import { Check, ChevronsUpDown, X, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isPartnerSuspended, procedureOriginLabel } from "@/lib/procedure-origin";
import type { flattenSocleOrgTree } from "@/lib/socleOrgTree";
import type { listProcedures } from "@/services/procedureService";

type OrgOption = ReturnType<typeof flattenSocleOrgTree>[number];
type ProcedureOption = Awaited<ReturnType<typeof listProcedures>>[number];

/** Organisation destinataire — commande la liste des démarches. */
export function OrganizationPicker({
  options,
  selected,
  loading,
  onSelect,
}: {
  options: OrgOption[];
  selected: OrgOption | null;
  loading: boolean;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Organisation destinataire</Label>
      <div className="flex items-center gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="flex-1 justify-between h-9 min-w-0"
              disabled={loading}
            >
              <span className="flex items-center gap-2 truncate">
                <Building2 className="h-4 w-4 shrink-0 opacity-50" />
                {selected ? (
                  <span className="truncate">{selected.name}</span>
                ) : loading ? "Chargement…" : (
                  <span className="text-muted-foreground">Toutes les organisations</span>
                )}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
            <Command>
              <CommandInput placeholder="Rechercher une organisation…" />
              <CommandList>
                <CommandEmpty>Aucune organisation trouvée</CommandEmpty>
                <CommandGroup>
                  {options.map((o) => (
                    <CommandItem
                      key={o.id}
                      value={o.name}
                      onSelect={() => {
                        onSelect(o.id);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", selected?.id === o.id ? "opacity-100" : "opacity-0")} />
                      <span className="truncate" style={{ paddingLeft: `${(o.depth - 1) * 12}px` }}>
                        {o.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {selected && (
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
            onClick={() => onSelect(null)} title="Retirer l'organisation">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        Les démarches proposées sont celles que cette organisation assure dans le référentiel.
      </p>
    </div>
  );
}

/** Démarche — sans elle, personne n'instruit la demande. */
export function ProcedurePicker({
  options,
  selected,
  selectedId,
  loading,
  arpegeActive,
  selectedOrgName,
  selectedSuspended,
  arpegeNeedsOrg,
  onSelect,
}: {
  options: ProcedureOption[];
  selected: ProcedureOption | null;
  selectedId: string;
  loading: boolean;
  arpegeActive: boolean | undefined;
  selectedOrgName: string | null;
  selectedSuspended: boolean;
  arpegeNeedsOrg: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        Démarche<span className="text-destructive ml-0.5">*</span>
      </Label>
      <div className="flex items-center gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="flex-1 justify-between h-9 min-w-0"
              disabled={loading}
            >
              <span className="truncate">
                {selected
                  ? selected.name
                  : loading ? "Chargement…" : (
                    <span className="text-muted-foreground">Sélectionner une démarche…</span>
                  )}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
            <Command>
              <CommandInput placeholder="Rechercher une démarche…" />
              <CommandList>
                <CommandEmpty>
                  {options.length === 0 && selectedOrgName
                    ? `${selectedOrgName} n'assure aucune démarche dans le référentiel.`
                    : "Aucune démarche trouvée"}
                </CommandEmpty>
                <CommandGroup>
                  {options.map((p) => {
                    const suspended = isPartnerSuspended(p, arpegeActive);
                    return (
                      <CommandItem
                        key={p.id}
                        value={p.name}
                        className="group"
                        disabled={suspended}
                        onSelect={() => {
                          onSelect(p.id);
                          setOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", selectedId === p.id ? "opacity-100" : "opacity-0")} />
                        {p.name}
                        {procedureOriginLabel(p) && (
                          <span className="ml-auto text-[10px] text-muted-foreground group-data-[selected=true]:text-accent-foreground">
                            {suspended
                              ? `${procedureOriginLabel(p)} · interface suspendue`
                              : procedureOriginLabel(p)}
                          </span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {selected && (
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
            onClick={() => onSelect("")} title="Retirer la démarche">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {selectedSuspended && (
        <p className="text-xs text-destructive">
          L'interface Arpège est suspendue pour cette collectivité : la demande ne peut pas
          être transmise.
        </p>
      )}
      {!selectedSuspended && arpegeNeedsOrg && (
        <p className="text-xs text-muted-foreground">
          Choisissez l'organisation destinataire : la demande part chez Arpège au nom de
          l'organisation qui assure cette démarche.
        </p>
      )}
    </div>
  );
}
