// Champ « Adresse » assisté : une ligne unique qui propose, une carte qui
// montre où l'adresse est tombée, et un dépliant pour les précisions d'accès.
//
// Porté d'Iris pour que l'agent qui saisit dans Clara voie ce que l'agent qui
// instruira dans Iris verra. TROIS RÈGLES, dans cet ordre :
//  1. **Il propose, il ne garde pas la porte.** Retenir une proposition est
//     toujours facultatif : le texte libre est conservé tel quel, et « Adresse
//     introuvable ? » ouvre la saisie manuelle. La BAN ignore les adresses
//     neuves, les lieux-dits mal nommés et tout ce qui n'est pas en France.
//  2. **Le clavier fait tout.** ↑ ↓ pour parcourir, Entrée choisit ET NE SOUMET
//     PAS le formulaire, Échap ferme.
//  3. **Clara n'invente aucun champ.** Le contrat d'adresse appartient au
//     Socle : le dépliant montre ce que la démarche porte (`extras`), fourni
//     par l'appelant, et rien d'autre.

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, LocateFixed, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MIN_QUERY_LENGTH, suggestionContext, type AddressSuggestion } from "@/lib/adresse";
import { PRECISION_LABELS, type GeoPoint } from "@/lib/carto";
import { AddressMap } from "./AddressMap";
import {
  browserPosition,
  reverseGeocode,
  reverseGeocodingAvailable,
  useAddressSuggestions,
  useGeocode,
} from "./useAddressSuggestions";

/** Ce que la ligne unique porte, quel que soit le contrat de destination. */
export interface AddressValue {
  /** Numéro + voie — « 10 bis Avenue de Frémeur ». */
  line: string;
  postcode: string;
  city: string;
}

/** Champ d'appoint du dépliant : ce que le contrat porte, nommé par l'appelant. */
export interface AddressExtra {
  key: string;
  label: string;
  value: string;
  maxLength?: number;
}

interface Props {
  id: string;
  label?: string;
  required?: boolean;
  value: AddressValue;
  /**
   * `suggestion` est non nulle quand la valeur vient de la liste : l'appelant
   * en tire les clés propres à SON contrat (numéro/BTQ/voie séparés). Elle est
   * nulle sur une saisie libre.
   */
  onChange: (next: AddressValue, suggestion: AddressSuggestion | null) => void;
  extras?: AddressExtra[];
  onExtraChange?: (key: string, value: string) => void;
  /**
   * Le contrat de destination n'a QU'UNE clé d'adresse (champ `adresse` du
   * `requester_config` du Socle) : ni code postal ni ville à part. On n'affiche
   * alors ni les deux champs, ni le rappel — ils n'iraient nulle part. Taper
   * librement EST la sortie de secours, il n'y en a pas d'autre à proposer.
   */
  singleLine?: boolean;
  hint?: ReactNode;
  error?: string;
  /** Le champ occupe deux colonnes de la grille du formulaire (défaut : oui). */
  fullWidth?: boolean;
}

export function AddressField({
  id,
  label = "Adresse",
  required,
  value,
  onChange,
  extras = [],
  onExtraChange,
  singleLine = false,
  hint,
  error,
  fullWidth = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // Dépliés d'office s'ils portent déjà quelque chose : masquer une donnée
  // existante serait pire que de montrer un champ vide.
  const [more, setMore] = useState(() => extras.some((e) => e.value.trim() !== ""));
  const [manual, setManual] = useState(false);
  const [locating, setLocating] = useState(false);
  const listId = `${id}-suggestions`;

  const { suggestions, isLoading, isError, isStale } = useAddressSuggestions(value.line);
  const showList = open && suggestions.length > 0;

  useEffect(() => setIndex(0), [suggestions]);

  // Point de la carte : celui de la proposition retenue tant qu'on n'a pas
  // retouché la saisie, sinon l'adresse écrite, géocodée.
  const [picked, setPicked] = useState<GeoPoint | null>(null);
  const written = [value.line, [value.postcode, value.city].filter((v) => v !== "").join(" ")]
    .filter((v) => v.trim() !== "")
    .join(", ");
  const geocoded = useGeocode(picked === null ? written : "", value.postcode || null);
  const point = picked ?? geocoded.data ?? null;

  function choose(suggestion: AddressSuggestion) {
    setPicked({
      lat: suggestion.lat,
      lon: suggestion.lon,
      label: suggestion.label,
      precision: suggestion.precision,
      score: suggestion.score,
    });
    setOpen(false);
    onChange(
      {
        line: suggestion.precision === "commune" ? "" : suggestion.name,
        postcode: suggestion.postcode,
        city: suggestion.city,
      },
      suggestion,
    );
  }

  function typeLine(line: string) {
    setPicked(null);
    setOpen(true);
    onChange({ ...value, line }, null);
  }

  async function locateFromBrowser() {
    setLocating(true);
    try {
      const position = await browserPosition();
      if (!position) return;
      const suggestion = await reverseGeocode(position.lat, position.lon);
      if (suggestion) choose(suggestion);
    } catch {
      // Panne du service : rien ne change, l'agent continue de taper.
    } finally {
      setLocating(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showList) {
      if (e.key === "ArrowDown" && suggestions.length > 0) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      // Tant que la liste est ouverte, Entrée CHOISIT et ne soumet pas :
      // l'inverse enverrait des demandes à moitié écrites.
      e.preventDefault();
      const suggestion = suggestions[index];
      if (suggestion) choose(suggestion);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
    // Tab n'est pas détourné : il doit continuer de sortir du champ.
  }

  const canLocate = reverseGeocodingAvailable();
  const recap = singleLine ? "" : [value.postcode, value.city].filter((v) => v.trim() !== "").join(" ");

  return (
    <div className={cn("flex flex-col gap-2", fullWidth && "sm:col-span-2")}>
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-[13px] font-semibold">
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={id}
            value={value.line}
            autoComplete="street-address"
            className={cn("pl-9", canLocate && "pr-10")}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${listId}-${index}` : undefined}
            onChange={(e) => typeLine(e.target.value)}
            onFocus={() => setOpen(true)}
            // Le clic sur une proposition passe par onMouseDown, avant le blur.
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          {canLocate && (
            <button
              type="button"
              title="Utiliser ma position"
              disabled={locating}
              onClick={() => void locateFromBrowser()}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <LocateFixed className={cn("h-4 w-4", locating && "animate-pulse")} aria-hidden="true" />
              <span className="sr-only">Utiliser ma position</span>
            </button>
          )}

          {showList && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Adresses proposées"
              className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
            >
              {suggestions.map((suggestion, i) => (
                <li key={suggestion.id} id={`${listId}-${i}`} role="option" aria-selected={i === index}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(suggestion);
                    }}
                    onMouseEnter={() => setIndex(i)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
                      i === index ? "bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <span className="truncate text-[13px] font-medium">{suggestion.label}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {suggestionContext(suggestion)}
                      {suggestion.precision !== "adresse"
                        ? ` · ${PRECISION_LABELS[suggestion.precision]}`
                        : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>

      {/* Annonce vocale des propositions — sans elle, la liste n'existe que pour l'œil. */}
      <span role="status" aria-live="polite" className="sr-only">
        {showList
          ? `${suggestions.length} adresse${suggestions.length > 1 ? "s" : ""} proposée${
              suggestions.length > 1 ? "s" : ""
            }`
          : ""}
      </span>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {recap !== "" && !manual && <span className="font-semibold text-foreground">{recap}</span>}
        {isError && (
          <span className="text-muted-foreground">
            Suggestions indisponibles — saisissez l'adresse à la main.
          </span>
        )}
        {!isError && isLoading && !isStale && value.line.trim().length >= MIN_QUERY_LENGTH && (
          <span className="text-muted-foreground">Recherche…</span>
        )}
        <span className="flex-1" />
        {extras.length > 0 && (
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", more && "rotate-180")} aria-hidden="true" />
            {more ? "Moins de champs" : "Plus de champs"}
          </button>
        )}
        {!manual && !singleLine && (
          <button
            type="button"
            onClick={() => setManual(true)}
            className="font-semibold text-muted-foreground hover:underline"
          >
            Adresse introuvable ?
          </button>
        )}
      </div>

      {/* Saisie manuelle : la sortie de secours. Toujours atteignable, jamais
          imposée — la BAN ne connaît pas toutes les adresses, ni l'étranger. */}
      {manual && !singleLine && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-postcode`} className="text-[13px] font-semibold">Code postal</Label>
            <Input
              id={`${id}-postcode`}
              value={value.postcode}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={20}
              onChange={(e) => {
                setPicked(null);
                onChange({ ...value, postcode: e.target.value }, null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-city`} className="text-[13px] font-semibold">Ville</Label>
            <Input
              id={`${id}-city`}
              value={value.city}
              autoComplete="address-level2"
              maxLength={200}
              onChange={(e) => {
                setPicked(null);
                onChange({ ...value, city: e.target.value }, null);
              }}
            />
          </div>
        </div>
      )}

      {more && extras.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {extras.map((extra) => (
            <div key={extra.key} className="space-y-1.5">
              <Label htmlFor={`${id}-${extra.key}`} className="text-[13px] font-semibold">
                {extra.label}
              </Label>
              <Input
                id={`${id}-${extra.key}`}
                value={extra.value}
                maxLength={extra.maxLength}
                onChange={(e) => onExtraChange?.(extra.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      {point && <AddressMap point={point} pending={geocoded.isFetching} />}
    </div>
  );
}
