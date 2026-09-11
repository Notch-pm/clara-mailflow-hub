import { useRef, useState, type ReactNode } from "react";
import { Check, ListFilter, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ToolbarButton, ToolbarTooltip } from "./ListPage";

/** Un filtre posé, tel qu'il s'affiche en pastille sous la barre d'outils. */
export interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface ListFilterButtonProps {
  /** Titre du panneau (« Filtrer les courriers »). */
  title: string;
  activeCount: number;
  /** Nombre de résultats, rappelé en pied de panneau ; chaque choix s'applique aussitôt. */
  resultLabel?: string;
  onReset: () => void;
  children: ReactNode;
}

/**
 * Bouton « Filtres » et son panneau. Remplace la carte de filtres qui occupait
 * toute une rangée au-dessus des listes : les choix s'appliquent sans
 * validation, et chaque filtre posé redevient visible — et retirable — dans
 * `ListActiveFilters`.
 *
 * Un champ marqué `data-autofocus` (la recherche) reçoit le focus à
 * l'ouverture : on tape aussitôt, comme dans l'ancienne barre. Pas sur écran
 * tactile, où le clavier virtuel recouvrirait les autres filtres.
 */
export function ListFilterButton({ title, activeCount, resultLabel, onReset, children }: ListFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  function focusField(event: Event) {
    const field = contentRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    if (!field || !window.matchMedia?.("(pointer: fine)").matches) return;
    event.preventDefault();
    field.focus({ preventScroll: true });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ToolbarTooltip label="Filtres" hideFromXl>
        <PopoverTrigger asChild>
          <ToolbarButton
            icon={<ListFilter />}
            label={activeCount > 0 ? `Filtres (${activeCount} actif${activeCount > 1 ? "s" : ""})` : "Filtres"}
            text="Filtres"
            showLabel
            active={activeCount > 0}
            badge={
              activeCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="rounded-full bg-primary px-1.5 text-[11px] font-bold leading-4 tabular-nums text-primary-foreground"
                >
                  {activeCount}
                </span>
              ) : undefined
            }
          />
        </PopoverTrigger>
      </ToolbarTooltip>
      <PopoverContent
        ref={contentRef}
        align="end"
        collisionPadding={16}
        onOpenAutoFocus={focusField}
        className="w-80 overflow-hidden rounded-lg p-0 shadow-airbnb-xl"
      >
        <div className="flex items-center justify-between px-3.5 pb-2.5 pt-3">
          <span className="text-[13.5px] font-bold">{title}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fermer les filtres"
            className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex max-h-[min(420px,60vh)] flex-col gap-3.5 overflow-y-auto px-3.5 pb-3">{children}</div>
        <div className="flex items-center justify-between border-t bg-muted/40 px-3.5 py-2.5">
          <button
            type="button"
            onClick={onReset}
            disabled={activeCount === 0}
            className="text-[12.5px] font-semibold text-muted-foreground underline underline-offset-[3px] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            Tout effacer
          </button>
          {resultLabel && (
            <span className="text-[12.5px] font-semibold tabular-nums text-primary" aria-live="polite">
              {resultLabel}
            </span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FilterSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11.5px] font-semibold text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

export interface FilterOption {
  value: string;
  label: string;
  /** Couleur propre à l'option (tag), en pastille devant le libellé. */
  color?: string | null;
}

interface FilterChoiceProps {
  options: FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
}

/** Choix courts, en pastilles à bascule. */
export function FilterChips({ options, selected, onToggle }: FilterChoiceProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(option.value)}
            className={cn(
              "inline-flex h-[30px] max-w-full items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors hover:border-primary/50",
              on ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground",
            )}
          >
            {on && <Check className="h-3 w-3 shrink-0" strokeWidth={3} />}
            {option.color && (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                // Couleur saisie par l'organisation pour ce tag : une donnée, pas un style.
                style={{ backgroundColor: option.color }}
              />
            )}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Choix plus nombreux ou plus longs (organisations) : une ligne par option. */
export function FilterOptionList({ options, selected, onToggle }: FilterChoiceProps) {
  return (
    <div className="-mx-1.5 flex flex-col">
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(option.value)}
            className={cn(
              "flex h-[34px] w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-muted/70",
              on && "bg-primary/10",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px]",
                on ? "border-primary bg-primary text-primary-foreground" : "border-border",
              )}
            >
              {on && <Check className="h-3 w-3" strokeWidth={3.4} />}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface ListActiveFiltersProps {
  chips: ActiveFilterChip[];
  onReset: () => void;
}

/** Filtres posés, en pastilles retirables. Rien n'est rendu sans filtre. */
export function ListActiveFilters({ chips, onReset }: ListActiveFiltersProps) {
  if (!chips.length) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/60 px-4 py-2 md:px-5">
      <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">Filtres actifs</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          aria-label={`Retirer le filtre ${chip.label}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-3 pr-2 text-[12.5px] font-semibold text-primary hover:bg-primary/15"
        >
          <span className="truncate">{chip.label}</span>
          <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
        </button>
      ))}
      <button
        type="button"
        onClick={onReset}
        className="whitespace-nowrap text-[12.5px] font-semibold text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
      >
        Tout effacer
      </button>
    </div>
  );
}
