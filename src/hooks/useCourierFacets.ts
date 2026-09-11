import { useCallback, useMemo, useState } from "react";
import type { ActiveFilterChip } from "@/components/list/ListFilters";
import type { CourierTag } from "@/services/courierTagService";

/** Périodes proposées sur la date de réception (le RPC ne filtre que celle-là). */
export const RECEIPT_PERIODS = [
  { value: "7d", label: "7 derniers jours", days: 7 },
  { value: "30d", label: "30 derniers jours", days: 30 },
  { value: "3m", label: "3 derniers mois", days: 92 },
] as const;

export type ReceiptPeriod = (typeof RECEIPT_PERIODS)[number]["value"];

export interface CourierFacetSources {
  /** Organisations proposées ; absent = pas de filtre d'organisation. */
  services?: { id: string; name: string }[];
  /** États proposés — le filtre n'apparaît qu'à partir de deux états. */
  states?: { id: string; name: string }[];
  tags?: CourierTag[];
  /** Filtre « Période de réception ». */
  withPeriod?: boolean;
}

function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Date locale au format `AAAA-MM-JJ` : `toISOString` passerait en UTC et décalerait d'un jour la nuit. */
function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Filtres des listes de courriers (organisation, état, tags, période), et
 * leurs pastilles « filtres actifs ». Chaque choix s'applique aussitôt : la
 * page traduit les valeurs en `CourierListFilters`, tout est filtré en SQL.
 *
 * Organisation : un seul choix (le RPC compare à une organisation). États et
 * tags : plusieurs — le RPC reçoit des tableaux, un courrier sort s'il porte
 * l'un des états, l'un des tags.
 */
export function useCourierFacets(sources: CourierFacetSources) {
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [stateIds, setStateIds] = useState<string[]>([]);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [period, setPeriod] = useState<ReceiptPeriod | null>(null);

  const toggleService = useCallback((id: string) => setServiceId((cur) => (cur === id ? null : id)), []);
  const toggleState = useCallback((id: string) => setStateIds((cur) => toggleIn(cur, id)), []);
  const toggleTag = useCallback((name: string) => setTagNames((cur) => toggleIn(cur, name)), []);
  const togglePeriod = useCallback(
    (value: string) => setPeriod((cur) => (cur === value ? null : (value as ReceiptPeriod))),
    [],
  );
  const reset = useCallback(() => {
    setServiceId(null);
    setStateIds([]);
    setTagNames([]);
    setPeriod(null);
  }, []);

  const dateFrom = useMemo(() => {
    const days = RECEIPT_PERIODS.find((p) => p.value === period)?.days;
    if (!days) return null;
    const from = new Date();
    from.setDate(from.getDate() - days);
    return localIsoDate(from);
  }, [period]);

  const { services, states, tags } = sources;
  const chips = useMemo<ActiveFilterChip[]>(() => {
    const out: ActiveFilterChip[] = [];
    // Une valeur que la liste ne propose plus (autre organisation, état
    // supprimé) ne s'affiche pas : la page l'ignore aussi.
    const service = services?.find((s) => s.id === serviceId);
    if (service) out.push({ key: `org:${service.id}`, label: `Organisation : ${service.name}`, onRemove: () => setServiceId(null) });
    for (const id of stateIds) {
      const state = states?.find((s) => s.id === id);
      if (state) out.push({ key: `state:${id}`, label: `État : ${state.name}`, onRemove: () => toggleState(id) });
    }
    for (const name of tagNames) {
      out.push({ key: `tag:${name}`, label: `Tag : ${name}`, onRemove: () => toggleTag(name) });
    }
    const p = RECEIPT_PERIODS.find((x) => x.value === period);
    if (p) out.push({ key: "period", label: `Reçu : ${p.label}`, onRemove: () => setPeriod(null) });
    return out;
  }, [services, states, serviceId, stateIds, tagNames, period, toggleState, toggleTag]);

  return {
    sources,
    serviceId,
    stateIds,
    tagNames,
    period,
    dateFrom,
    toggleService,
    toggleState,
    toggleTag,
    togglePeriod,
    reset,
    chips,
    activeCount: chips.length,
  };
}

export type CourierFacets = ReturnType<typeof useCourierFacets>;
