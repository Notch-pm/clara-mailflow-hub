import { FilterChips, FilterOptionList, FilterSection } from "@/components/list/ListFilters";
import { RECEIPT_PERIODS, type CourierFacets } from "@/hooks/useCourierFacets";

/** Contenu du panneau « Filtres » des listes de courriers. */
export function CourierFacetFields({ facets }: { facets: CourierFacets }) {
  const { services, states, tags, withPeriod } = facets.sources;
  return (
    <>
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
