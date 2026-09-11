// Barre de recherche du tableau de bord — un courrier OU un usager, résultats
// groupés par nature. Trois caractères suffisent à la lancer, temporisée le
// temps que la frappe se pose (`SEARCH_DEBOUNCE_MS`).
//
// Elle ne garde AUCUNE porte : ce qu'elle montre est ce que la RLS et le
// périmètre RBAC laissent voir (courriers) et ce que le Socle accepte de servir
// (usagers). Le clavier fait tout — motif éprouvé du champ d'adresse :
// ↑ ↓ parcourent, Entrée ouvre, Échap ferme.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/components/list/ListCells";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import { cn } from "@/lib/utils";
import {
  flattenResults,
  isSearchable,
  MIN_QUERY_LENGTH,
  moveIndex,
  normalizeQuery,
  type SearchResult,
} from "./global-search";
import { useGlobalSearch } from "./useGlobalSearch";

const LIST_ID = "recherche-globale";

function ResultRow({ result }: { result: SearchResult }) {
  if (result.kind === "usager") {
    return (
      <span className="flex w-full flex-col items-start gap-0.5 text-left">
        <span className="w-full truncate text-[13px] font-semibold">{result.name}</span>
        <span className="w-full truncate text-[11.5px] text-muted-foreground">
          {[result.typeLabel, result.city || "Ville inconnue", result.email]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    );
  }
  return (
    <span className="flex w-full flex-col items-start gap-1 text-left">
      <span className="flex w-full items-center gap-2">
        {result.chrono && (
          <span className="shrink-0 text-[12.5px] font-bold text-primary">{result.chrono}</span>
        )}
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
          {result.direction}
        </span>
        {result.stateLabel && <StatusDot label={result.stateLabel} tone={result.stateTone} />}
      </span>
      <span className="w-full truncate text-[13px] font-medium">{result.subject}</span>
      <span className="w-full truncate text-[11.5px] text-muted-foreground">
        {[result.date, result.sender, result.service].filter(Boolean).join(" · ")}
        {result.matchIn.length > 0 && (
          <span className="text-muted-foreground/70"> — trouvé dans {result.matchIn.join(", ")}</span>
        )}
      </span>
    </span>
  );
}

export function GlobalSearch() {
  const { organizationId } = useOrganization();
  const serviceFilter = useUserServiceFilter();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { groups, isLoading, isStale, usagersUnavailable, couriersFailed, settled } =
    useGlobalSearch(organizationId ?? "", serviceFilter, query);
  const results = flattenResults(groups);
  const typed = normalizeQuery(query);
  const searchable = isSearchable(query);
  const showPanel = open && typed !== "";
  const showList = showPanel && searchable && results.length > 0;

  // Une nouvelle liste se parcourt depuis le haut. Le repère est l'IDENTITÉ des
  // résultats, pas leur nombre : deux recherches successives peuvent en rendre
  // autant, et le curseur resterait alors au milieu d'une liste toute neuve.
  const resultKey = results.map((r) => `${r.kind}:${r.id}`).join("|");
  useEffect(() => setIndex(0), [resultKey]);

  // Fermeture au clic à côté : le panneau porte des boutons de navigation, un
  // `blur` fermerait avant que le clic n'arrive.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function close() {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function choose(result: SearchResult) {
    close();
    navigate(result.href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (typed === "") inputRef.current?.blur();
      setOpen(false);
      return;
    }
    if (!showList) {
      if (e.key === "ArrowDown" && results.length > 0) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => moveIndex(i, 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => moveIndex(i, -1, results.length));
    } else if (e.key === "Enter") {
      // Tant que la liste est ouverte, Entrée OUVRE le résultat retenu.
      e.preventDefault();
      const result = results[index];
      if (result) choose(result);
    }
    // Tab n'est pas détourné : il doit continuer de sortir du champ.
  }

  let cursor = -1;
  return (
    <div ref={boxRef} className="relative w-full max-w-[560px]">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="text"
        aria-label="Rechercher un courrier ou un usager"
        placeholder="Rechercher un courrier ou un usager…"
        value={query}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={showList ? LIST_ID : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${LIST_ID}-${index}` : undefined}
        className="h-10 rounded-full border-transparent bg-muted/70 pl-9 pr-9 focus-visible:border-ring focus-visible:bg-background md:text-[13.5px]"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {query !== "" && (
        <button
          type="button"
          onClick={() => { setQuery(""); setOpen(false); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Effacer la recherche</span>
        </button>
      )}

      {/* Sous lg le panneau épouse le champ ; au-dessus il s'aligne sur son bord
          DROIT — calé à gauche, ses 600 px débordaient de la page, le champ
          étant lui-même collé à droite de l'en-tête. */}
      {showPanel && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-airbnb-lg lg:left-auto lg:w-[600px] lg:max-w-[calc(100vw-7rem)]">
          {!searchable ? (
            <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
              Saisissez au moins {MIN_QUERY_LENGTH} caractères.
            </p>
          ) : (
            <>
              <div id={LIST_ID} role="listbox" aria-label="Résultats de la recherche">
                {groups.map((group) => (
                  <div key={group.key} role="group" aria-label={group.label}>
                    <p
                      aria-hidden="true"
                      className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                    >
                      {group.label}
                    </p>
                    {group.results.map((result) => {
                      cursor += 1;
                      const i = cursor;
                      const active = i === index;
                      return (
                        <button
                          key={`${result.kind}-${result.id}`}
                          type="button"
                          role="option"
                          id={`${LIST_ID}-${i}`}
                          aria-selected={active}
                          onClick={() => choose(result)}
                          onMouseEnter={() => setIndex(i)}
                          className={cn(
                            "flex w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                            active ? "bg-primary/10" : "hover:bg-muted",
                          )}
                        >
                          <ResultRow result={result} />
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {!organizationId ? (
                <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
                  Sélectionnez une organisation pour lancer une recherche.
                </p>
              ) : isLoading || isStale ? (
                <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">Recherche…</p>
              ) : results.length === 0 && settled ? (
                <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
                  Aucun résultat pour « {typed} ».
                </p>
              ) : null}

              {couriersFailed && (
                <p className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
                  Les courriers n'ont pas pu être interrogés — réessayez dans un instant.
                </p>
              )}
              {usagersUnavailable && (
                <p className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
                  Référentiel des usagers indisponible — seuls les courriers sont cherchés.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Sans cette annonce, la liste n'existe que pour l'œil. */}
      <span role="status" aria-live="polite" className="sr-only">
        {showList ? `${results.length} résultat${results.length > 1 ? "s" : ""}` : ""}
      </span>
    </div>
  );
}
