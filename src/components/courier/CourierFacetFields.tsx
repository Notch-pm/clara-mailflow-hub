import { FilterChips, FilterOptionList, FilterSection } from "@/components/list/ListFilters";
import { ListSearch } from "@/components/list/ListPage";
import { RECEIPT_PERIODS, type CourierFacets } from "@/hooks/useCourierFacets";

/** Contenu du panneau « Filtres » des listes de courriers, recherche en tête. */
export function CourierFacetFields({ facets }: { facets: CourierFacets }) {
  const { services, states, tags, withPeriod } = facets.sources;
  return (
    <>
      {/* Le RPC cherche dans l'objet, le texte, les correspondants et les
          pièces extraites — pas seulement l'objet, comme le disait l'ancien
          « Rechercher par objet… ». */}
      <FilterSection label="Recherche">
        <ListSearch
          value={facets.search}
          onChange={facets.setSearch}
          placeholder="Objet, correspondant, texte…"
          ariaLabel="Rechercher dans les courriers"
          focusOnOpen
        />
      </FilterSection>
      {states && states.length > 1 && (
        <FilterSection label="État">
          <FilterChips
            options={states.map((s) => ({ value: s.id, label: s.name }))}
            selected={facets.stateIds}
            onToggle={facets.toggleState}
          />
        </FilterSection>
      )}
      {!!services?.length && (
        <FilterSection label="Organisation">
          <FilterOptionList
            options={services.map((s) => ({ value: s.id, label: s.name }))}
            selected={facets.serviceId ? [facets.serviceId] : []}
            onToggle={facets.toggleService}
          />
        </FilterSection>
      )}
      {!!tags?.length && (
        <FilterSection label="Tags">
          <FilterChips
            options={tags.map((t) => ({ value: t.name, label: t.name, color: t.color }))}
            selected={facets.tagNames}
            onToggle={facets.toggleTag}
          />
        </FilterSection>
      )}
      {withPeriod && (
        <FilterSection label="Période de réception">
          <FilterChips
            options={RECEIPT_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            selected={facets.period ? [facets.period] : []}
            onToggle={facets.togglePeriod}
          />
        </FilterSection>
      )}
    </>
  );
}
