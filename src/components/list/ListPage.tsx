import { forwardRef, type ReactNode } from "react";
import { Download, Loader2, Rows3, Rows4, Search, X } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ListDensityContext, useListDensity, usePersistedListDensity } from "@/hooks/useListDensity";
import { cn } from "@/lib/utils";

/*
 * Gabarit commun des pages de liste (boîte aux lettres, courriers, contacts,
 * recherche) :
 *
 *   ┌ ListToolbar ─ titre · compteur · recherche · actions · « Nouveau » ┐  56 px
 *   ├ ListActiveFilters (si des filtres sont posés)                      ┤
 *   ├ en-tête de tableau, collé                                          ┤
 *   │ lignes — SEULE zone qui défile (ListScrollArea)                    │
 *   └ pagination / pied de liste                                         ┘  44 px
 *
 * La page occupe toute la zone de contenu, sans gouttière : `AppLayout` la
 * reconnaît à `data-list-page` et retire la sienne. `main` cesse alors de
 * défiler — c'est ce qui supprime le double défilement page + tableau.
 */

interface ListPageProps {
  children: ReactNode;
  className?: string;
}

export function ListPage({ children, className }: ListPageProps) {
  const density = usePersistedListDensity();
  return (
    <ListDensityContext.Provider value={density}>
      <div
        data-list-page="fill"
        data-density={density.density}
        className={cn("group/list flex h-full min-h-0 flex-col bg-card", className)}
      >
        {children}
      </div>
    </ListDensityContext.Provider>
  );
}

interface ListToolbarProps {
  /** Pictogramme de la page (icône lucide ou `<img>`), dimensionné par la barre. */
  icon: ReactNode;
  title: string;
  /** Total du jeu filtré ; omis tant qu'il n'est pas connu. */
  count?: number | null;
  /** Ce que compte `count`, pour les lecteurs d'écran (« courriers »). */
  countLabel?: string;
  search?: ReactNode;
  /** Action principale, calée à droite derrière un séparateur. */
  primary?: ReactNode;
  /** Actions secondaires : grouper, filtrer, densité, colonnes, export… */
  children?: ReactNode;
}

/**
 * Barre unique de la liste : remplace l'ancien empilement titre + sous-titre,
 * rangée de boutons et carte « Recherche » (~300 px avant la première ligne).
 * Sous `md`, elle passe sur deux lignes : titre et action principale, puis
 * recherche et actions — une seule s'il n'y a pas de recherche et que tout tient.
 */
export function ListToolbar({
  icon,
  title,
  count,
  countLabel = "résultats",
  search,
  primary,
  children,
}: ListToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-4 py-2.5 md:h-14 md:flex-nowrap md:px-5 md:py-0">
      {/* Sans recherche, base = largeur du titre : si les actions ne tiennent
          pas à côté, elles passent à la ligne au lieu de le tronquer. */}
      <div className={cn("flex min-w-0 items-center gap-2.5 md:flex-initial", search ? "flex-1" : "flex-auto")}>
        <span
          aria-hidden="true"
          className="flex shrink-0 [&_img]:h-[18px] [&_img]:w-[18px] [&_svg]:h-[18px] [&_svg]:w-[18px]"
        >
          {icon}
        </span>
        <h1 className="truncate text-[17px] font-bold tracking-tight">{title}</h1>
        {count != null && (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold tabular-nums text-muted-foreground">
            {count.toLocaleString("fr-FR")}
            <span className="sr-only"> {countLabel}</span>
          </span>
        )}
      </div>

      {primary && (
        <div className="flex shrink-0 items-center gap-1.5 md:order-last">
          <span aria-hidden="true" className="mx-1 hidden h-[22px] w-px bg-border md:block" />
          {primary}
        </div>
      )}

      {/* Sous `md`, la recherche passe à la ligne. Sans elle, les actions
          restent à côté du titre tant qu'elles y tiennent. */}
      {search ? (
        <>
          <div aria-hidden="true" className="basis-full md:hidden" />
          <div className="flex min-w-0 flex-1 md:min-w-[150px] md:justify-center">{search}</div>
        </>
      ) : (
        <div aria-hidden="true" className="hidden flex-1 md:block" />
      )}

      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  );
}

interface ListSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Nom accessible, s'il diffère du texte indicatif. */
  ariaLabel?: string;
  /** Focus à l'ouverture du panneau « Filtres » qui contient le champ (`ListFilterButton`). */
  focusOnOpen?: boolean;
  className?: string;
}

/**
 * Champ de recherche arrondi. Dans la barre pour les contacts et la page
 * Recherche ; dans le panneau « Filtres » pour les listes de courriers.
 */
export function ListSearch({ value, onChange, placeholder, ariaLabel, focusOnOpen, className }: ListSearchProps) {
  return (
    <div className={cn("relative w-full md:max-w-[360px]", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground"
      />
      {/* Le texte reste à 16 px sous `md` : en dessous, iOS zoome sur le champ. */}
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        data-autofocus={focusOnOpen || undefined}
        className="h-9 rounded-full pl-9 pr-9 focus-visible:ring-[3px] focus-visible:ring-ring/20 focus-visible:ring-offset-0 md:text-[13.5px] [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Effacer la recherche"
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

interface ToolbarTooltipProps {
  label: string;
  children: ReactNode;
  /** Le libellé devient visible à partir de `xl` : l'infobulle y serait redondante. */
  hideFromXl?: boolean;
}

export function ToolbarTooltip({ label, children, hideFromXl }: ToolbarTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className={cn("px-2.5 py-1 text-xs", hideFromXl && "xl:hidden")}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

interface ToolbarButtonProps extends Omit<ButtonProps, "size" | "variant"> {
  icon: ReactNode;
  /** Nom accessible — et libellé affiché, faute de `text`. */
  label: string;
  /** Libellé visible s'il diffère du nom accessible (qui doit alors le contenir). */
  text?: ReactNode;
  /** Libellé visible à partir de `xl` ; icône seule en dessous. */
  showLabel?: boolean;
  primary?: boolean;
  /** Réglage en vigueur (filtres posés, groupement actif) : bouton teinté. */
  active?: boolean;
  /** Pastille après le libellé (nombre de filtres). */
  badge?: ReactNode;
}

/**
 * Bouton cerclé de la barre d'outils. Il porte toujours son nom en
 * `aria-label` : sous `xl` il n'a que son icône — l'envelopper d'un
 * `ToolbarTooltip` pour la souris.
 */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { icon, label, text, showLabel, primary, active, badge, className, children, ...props },
  ref,
) {
  const round = !showLabel && !badge;
  return (
    <Button
      ref={ref}
      variant={primary ? "default" : "toolbar"}
      size={round ? "pill-icon" : "pill"}
      aria-label={label}
      data-active={active || undefined}
      className={cn(
        primary && "font-bold",
        !primary && !showLabel && "text-muted-foreground hover:text-foreground",
        // Libellé masqué sous `xl` : le bouton redevient un rond de 36 px.
        showLabel && !badge && "max-xl:w-9 max-xl:px-0",
        className,
      )}
      {...props}
    >
      {icon}
      {showLabel && <span className="hidden truncate xl:inline">{text ?? label}</span>}
      {badge}
      {children}
    </Button>
  );
});

/** Bascule entre lignes confortables (48 px) et compactes (36 px). */
export function ListDensityToggle() {
  const { density, setDensity } = useListDensity();
  const compact = density === "compact";
  return (
    <ToolbarTooltip label="Affichage compact">
      <ToolbarButton
        icon={compact ? <Rows4 /> : <Rows3 />}
        label="Affichage compact"
        aria-pressed={compact}
        active={compact}
        onClick={() => setDensity(compact ? "comfortable" : "compact")}
        // Réglage de bureau : sur téléphone, la place va à la recherche.
        className="max-sm:hidden"
      />
    </ToolbarTooltip>
  );
}

interface ListExportButtonProps {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}

export function ListExportButton({ onClick, busy, disabled }: ListExportButtonProps) {
  return (
    <ToolbarTooltip label={busy ? "Export en cours…" : "Exporter CSV"}>
      <ToolbarButton
        icon={busy ? <Loader2 className="animate-spin" /> : <Download />}
        label="Exporter CSV"
        onClick={onClick}
        disabled={disabled || busy}
      />
    </ToolbarTooltip>
  );
}

interface ListSegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  ariaLabel: string;
}

/** Bascule de vue compacte (ex. « Tous / Transférés »), à la hauteur des boutons. */
export function ListSegmented<T extends string>({ value, onChange, options, ariaLabel }: ListSegmentedProps<T>) {
  return (
    <div className="flex h-9 shrink-0 rounded-full bg-muted p-[3px]" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5",
              selected ? "bg-card font-bold shadow-airbnb-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pied de liste : 44 px, collé en bas de l'écran, hors de la zone qui défile. */
export function ListFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t bg-card px-4 py-1.5 text-[12.5px] text-muted-foreground md:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Message plein cadre dans la zone des lignes : chargement, liste vide, erreur. */
export function ListMessage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-12 text-center text-sm text-muted-foreground", className)}>{children}</div>;
}
