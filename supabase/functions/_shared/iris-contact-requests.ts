// Demandes Iris d'UN usager, pour la fiche contact et l'espace élu — logique
// sans réseau, testée (`src/test/iris/iris-contact-requests.test.ts`). Le réseau
// et les lectures en base vivent dans `iris-contact-requests/index.ts`.
//
// Iris est propriétaire des demandes : Clara les LIT en direct, n'en garde
// aucune copie, et ne montre que ce que la liste blanche d'Iris publie (jamais
// de notes internes ni de `form_data`). Iris ne sert que des identifiants : les
// libellés de démarche et d'organisme viennent des miroirs du référentiel.

/** Demande telle que servie par `GET /v1/requests` (champs inconnus tolérés). */
export interface IrisListedRequest {
  id?: string;
  reference?: string | null;
  status?: string | null;
  source?: string | null;
  socle_organization_id?: string | null;
  socle_procedure_id?: string | null;
  socle_contact_id?: string | null;
  subject?: string | null;
  received_at?: string | null;
  created_at?: string | null;
  closed_at?: string | null;
  closure_text?: string | null;
}

/** Ce que l'écran reçoit. */
export interface ContactDemande {
  id: string;
  reference: string | null;
  status: string | null;
  /** Code de la source Iris (`clara`, `portail-citoyen`…). */
  source: string | null;
  subject: string | null;
  procedure_label: string | null;
  organization_label: string | null;
  received_at: string | null;
  closed_at: string | null;
  /** Réponse de clôture destinée à l'usager (publiée par Iris). */
  closure_text: string | null;
  /** Courrier d'origine quand la demande a été déposée depuis Clara. */
  courier_id: string | null;
}

export interface ContactDemandeLookups {
  /** `procedures.socle_id` → nom. */
  procedures: Map<string, string>;
  /** `socle_organizations.socle_id` → nom. */
  organizations: Map<string, string>;
  /** `action_tickets.iris_request_id` → `courier_id`. */
  couriersByIrisRequest: Map<string, string>;
}

const norm = (v: string | null | undefined) => (v ? v.toLowerCase() : null);

/**
 * Périmètre de l'appelant : `null` = tout le tenant (administrateur,
 * superadmin), sinon les UUID **Socle** de ses organisations. Même règle que
 * les courriers (`applyServiceFilter`) : une demande sans organisme reste
 * visible.
 */
export function isInScope(request: IrisListedRequest, allowedSocleOrgIds: Set<string> | null): boolean {
  if (allowedSocleOrgIds === null) return true;
  const org = norm(request.socle_organization_id);
  return org === null || allowedSocleOrgIds.has(org);
}

export function buildContactDemandes(
  requests: IrisListedRequest[],
  lookups: ContactDemandeLookups,
  allowedSocleOrgIds: Set<string> | null,
): ContactDemande[] {
  const out: ContactDemande[] = [];
  for (const r of requests) {
    if (!r.id || !isInScope(r, allowedSocleOrgIds)) continue;
    out.push({
      id: r.id,
      reference: r.reference ?? null,
      status: r.status ?? null,
      source: r.source ?? null,
      subject: r.subject ?? null,
      procedure_label: lookups.procedures.get(norm(r.socle_procedure_id) ?? "") ?? null,
      organization_label: lookups.organizations.get(norm(r.socle_organization_id) ?? "") ?? null,
      received_at: r.received_at ?? r.created_at ?? null,
      closed_at: r.closed_at ?? null,
      closure_text: r.closure_text ?? null,
      courier_id: lookups.couriersByIrisRequest.get(r.id) ?? null,
    });
  }
  // Plus récente d'abord — Iris trie par `updated_at` croissant (réconciliation).
  return out.sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
}

/** Clés de correspondance normalisées : Iris et les miroirs ne garantissent pas la casse des UUID. */
export function lookupMap(rows: Array<{ key: string | null; value: string | null }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const { key, value } of rows) if (key && value) map.set(key.toLowerCase(), value);
  return map;
}
