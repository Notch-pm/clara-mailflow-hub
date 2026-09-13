import { useState } from "react";
import { EluCard } from "@/components/elu/EluCard";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluSearchInput } from "@/components/elu/EluSearchField";
import { EluStatusPill } from "@/components/elu/EluStatusPill";
import { useGlobalSearch } from "@/components/search/useGlobalSearch";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useEluRecentCouriers } from "@/hooks/useEluRecentCouriers";
import { useUserServiceFilter } from "@/hooks/useUserServiceFilter";
import type { CourierListRow } from "@/services/courierListService";

/** « Thierry Henry · 04/09/2026 » sous l'objet d'un courrier récent. */
function recentMeta(courier: CourierListRow): string | null {
  const sender =
    courier.sender_name?.trim() ||
    [courier.sender_first_name, courier.sender_last_name].filter(Boolean).join(" ").trim() ||
    null;
  const date = courier.received_at
    ? new Date(courier.received_at).toLocaleDateString("fr-FR")
    : null;
  return [sender, date].filter(Boolean).join(" · ") || null;
}

/**
 * Recherche de l'espace élu.
 *
 * Aucune logique de recherche n'est réécrite ici : `useGlobalSearch` porte déjà
 * le délai de frappe, le minimum de trois caractères, le périmètre RBAC en SQL
 * et la dégradation indépendante des deux sources. Seuls les liens vers les
 * usagers et les courriers entrants sont remappés — sans quoi on sortirait de
 * l'espace sans s'en apercevoir.
 *
 * Tant que rien n'est saisi, l'écran montre les derniers courriers reçus : un
 * champ vide n'apprend rien à un élu qui ouvre l'application pour voir ce qui
 * vient d'arriver.
 */
export default function EluRecherche() {
  const { organizationId } = useOrganization();
  const visibleSocleOrganizationIds = useUserServiceFilter();
  const [query, setQuery] = useState("");
  const search = useGlobalSearch(organizationId ?? "", visibleSocleOrganizationIds, query);

  const typed = query.trim();
  const searching = typed.length >= 3;
  const { couriers: recent, isLoading: recentLoading } = useEluRecentCouriers(!searching);

  const couriers = search.groups.find((g) => g.key === "courriers")?.results ?? [];
  const usagers = search.groups.find((g) => g.key === "usagers")?.results ?? [];
  const nothingFound = searching && search.settled && couriers.length === 0 && usagers.length === 0;

  return (
    <EluScreen>
      <EluScreenHeader title="Rechercher" />
      <EluSearchInput value={query} onChange={setQuery} />

      {typed.length > 0 && typed.length < 3 && (
        <p className="text-[15px] text-muted-foreground">Saisissez au moins trois caractères.</p>
      )}

      {!searching && (
        <div className="flex flex-col gap-2.5">
          <h2 className="text-[17px] font-bold text-muted-foreground">Derniers courriers reçus</h2>
          {recentLoading ? (
            <EluEmptyState>Chargement…</EluEmptyState>
          ) : recent.length === 0 ? (
            <EluEmptyState>Aucun courrier reçu pour le moment.</EluEmptyState>
          ) : (
            recent.map((courier) => (
              <EluCard
                key={courier.id}
                to={`/elu/courrier/${courier.id}`}
                title={courier.subject ?? "Sans objet"}
                meta={recentMeta(courier)}
              />
            ))
          )}
        </div>
      )}

      {usagers.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h2 className="text-[17px] font-bold text-muted-foreground">Usagers</h2>
          {usagers.map((result) =>
            result.kind === "usager" ? (
              <EluCard
                key={result.id}
                to={`/elu/usager/${result.id}`}
                title={result.name}
                meta={[result.typeLabel, result.city].filter(Boolean).join(" · ") || null}
              />
            ) : null,
          )}
        </div>
      )}

      {couriers.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <h2 className="text-[17px] font-bold text-muted-foreground">Courriers</h2>
          {couriers.map((result) =>
            result.kind === "courrier" ? (
              <EluCard
                key={result.id}
                to={
                  result.direction === "Entrant" ? `/elu/courrier/${result.id}` : result.href
                }
                title={result.subject}
                meta={[result.sender, result.date].filter(Boolean).join(" · ") || null}
                badge={result.stateLabel ? <EluStatusPill>{result.stateLabel}</EluStatusPill> : undefined}
              />
            ) : null,
          )}
        </div>
      )}

      {/* Une source peut tomber sans l'autre : on le dit, plutôt que de laisser
          croire que le référentiel ne contient personne. */}
      {search.usagersUnavailable && (
        <p className="text-[15px] text-muted-foreground">
          Le référentiel des usagers est momentanément indisponible.
        </p>
      )}
      {search.couriersFailed && (
        <p className="text-[15px] text-muted-foreground">
          Les courriers n'ont pas pu être lus. Réessayez dans un instant.
        </p>
      )}

      {nothingFound && <EluEmptyState>Aucun résultat pour cette recherche.</EluEmptyState>}
    </EluScreen>
  );
}
