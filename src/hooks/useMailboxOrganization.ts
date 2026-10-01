import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { assignableOrgs, listOrgsWithConfig } from "@/services/socleOrgConfigService";
import { countMailboxByOrganization, UNASSIGNED_ORGANIZATION } from "@/services/courierListService";

export { UNASSIGNED_ORGANIZATION };

export interface MailboxOrganizationOption {
  /** Identifiant du miroir Socle, ou `UNASSIGNED_ORGANIZATION`. */
  id: string;
  name: string;
  count: number;
}

function storageKey(userId: string, organizationId: string): string {
  return `clara.mailbox-organization.${userId}.${organizationId}`;
}

function readStored(key: string | null): string | null {
  if (!key) return null;
  // localStorage peut lever (navigation privée stricte, données bloquées).
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Bannette affichée par la boîte aux lettres : une organisation, ou les
 * courriers sans service désigné — jamais tous les courriers mélangés.
 *
 * Le dernier choix est retenu par utilisateur et par collectivité, sur ce
 * navigateur. Sans choix retenu (ou s'il n'est plus proposé), la première
 * organisation qui a du courrier en attente, à défaut la première de la liste.
 *
 * Proposées : les organisations actives — pour un agent restreint à ses
 * organisations (`visibleSocleOrganizationIds`), les siennes seulement — plus
 * toute organisation obsolète qui a encore du courrier en attente, sans quoi
 * celui-ci deviendrait inatteignable depuis la boîte.
 */
export function useMailboxOrganization(
  organizationId: string | null,
  initialStateIds: string[] | undefined,
  visibleSocleOrganizationIds: string[] | null,
) {
  const { user } = useAuth();
  const key = user?.id && organizationId ? storageKey(user.id, organizationId) : null;
  const [stored, setStored] = useState<string | null>(() => readStored(key));
  useEffect(() => setStored(readStored(key)), [key]);

  const { data: orgs } = useQuery({
    queryKey: ["socle-orgs-config", organizationId],
    queryFn: () => listOrgsWithConfig(organizationId!),
    enabled: !!organizationId,
  });

  const { data: counts, isError: countsFailed } = useQuery({
    queryKey: ["mailbox-couriers", "counts-by-organization", organizationId, initialStateIds],
    queryFn: () => countMailboxByOrganization(organizationId!, initialStateIds!),
    enabled: !!organizationId && !!initialStateIds,
  });

  const options = useMemo<MailboxOrganizationOption[] | null>(() => {
    // Attendre les compteurs : arrivés après coup, ils feraient changer de
    // bannette par défaut sous les yeux de l'utilisateur. En échec, la liste
    // reste utilisable sans eux.
    if (!orgs || (!counts && !countsFailed)) return null;
    const active = new Set(assignableOrgs(orgs).map((o) => o.id));
    const visible = orgs.filter(
      (o) =>
        (active.has(o.id) || (counts?.[o.id] ?? 0) > 0) &&
        (visibleSocleOrganizationIds === null || visibleSocleOrganizationIds.includes(o.id)),
    );
    return [
      ...visible.map((o) => ({ id: o.id, name: o.name, count: counts?.[o.id] ?? 0 })),
      {
        id: UNASSIGNED_ORGANIZATION,
        name: "Courriers sans service désigné",
        count: counts?.[UNASSIGNED_ORGANIZATION] ?? 0,
      },
    ];
  }, [orgs, counts, countsFailed, visibleSocleOrganizationIds]);

  const selected = useMemo<string | null>(() => {
    if (!options) return null;
    if (stored && options.some((o) => o.id === stored)) return stored;
    const organizations = options.filter((o) => o.id !== UNASSIGNED_ORGANIZATION);
    return (organizations.find((o) => o.count > 0) ?? organizations[0] ?? options[0]).id;
  }, [options, stored]);

  const select = useCallback(
    (id: string) => {
      setStored(id);
      if (!key) return;
      try {
        localStorage.setItem(key, id);
      } catch {
        // Choix non retenu, sans conséquence pour la session en cours.
      }
    },
    [key],
  );

  return { options, selected, select };
}
