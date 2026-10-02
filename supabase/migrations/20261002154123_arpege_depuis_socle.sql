-- ============================================================================
-- La configuration Arpège VIENT DU SOCLE — Clara n'en tient plus qu'un miroir.
--
-- Le Socle est devenu le référentiel des intégrations partenaires (catalogue +
-- configuration par collectivité, 2026-10-02) et sert la configuration d'une
-- racine par `GET /v1/organizations/{id}/integrations/arpege` (public-api
-- 1.34.0, scope `integrations`, secrets compris). Même motif que le serveur
-- d'envoi (20260823170000_smtp_depuis_socle.sql) : `sync-socle-referentiel`
-- recopie, une RPC de SERVICE est l'unique porte d'écriture du miroir.
--
-- Les quatre fonctions Arpège (create-arpege-demande, check-arpege-ticket-status,
-- sync-arpege-services, test-arpege-connection) lisent les MÊMES colonnes
-- qu'avant : elles ne changent pas. Les clés du Socle ont été choisies égales
-- aux colonnes de cette table pour que la recopie soit une recopie.
--
-- ⚠️ TRANSITION, différente du SMTP : tant que le Socle ne déclare RIEN de
-- complet pour une collectivité, la ligne locale est CONSERVÉE (la sync ne
-- l'efface pas) — sinon la configuration d'ACCM, saisie dans Clara, aurait
-- disparu au premier passage. Dès que le Socle en déclare une, il fait foi.
-- `socle_synced_at` non nul = ligne gérée par le Socle (l'écran la montre en
-- lecture seule) ; nul = ligne d'origine manuelle.
--
-- Les secrets restent EN CLAIR dans les colonnes, comme avant (dette P1.1,
-- docs/technical-debt.md) : ne pas mêler les deux chantiers.
--
-- Rejouable : IF NOT EXISTS / OR REPLACE (cf. docs/deployment.md).
-- ============================================================================

alter table public.organization_integrations
  add column if not exists socle_synced_at  timestamptz,
  add column if not exists socle_updated_at timestamptz;

comment on column public.organization_integrations.socle_synced_at is
  'Dernière recopie depuis le Socle (sync-socle-referentiel). Non nul = configuration gérée dans le Socle, en lecture seule dans Clara. Nul = saisie manuelle (avant la bascule).';
comment on column public.organization_integrations.socle_updated_at is
  'Dernière modification de la configuration côté Socle (updated_at de la réponse public-api).';

-- Unique porte d'écriture du miroir Arpège. Les chaînes vides deviennent NULL :
-- `resolveHawkCredentials` traite les deux de la même façon, mais une colonne
-- nulle se lit sans ambiguïté.
create or replace function public.sync_arpege_integration_from_socle(
  p_org_id               uuid,
  p_socle_org_id         uuid,
  p_api_base_url         text,
  p_api_url_ticketingapp text,
  p_client_id            text,
  p_client_secret        text,
  p_access_token         text,
  p_is_active            boolean,
  p_socle_updated_at     timestamptz
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(btrim(p_api_base_url), '') = '' then
    raise exception 'URL de l''API Arpège manquante' using errcode = '22023';
  end if;

  insert into public.organization_integrations (
    organization_id, provider, api_base_url, api_url_ticketingapp,
    client_id, client_secret, access_token, is_active,
    socle_root_org_id, socle_updated_at, socle_synced_at
  ) values (
    p_org_id, 'arpege', btrim(p_api_base_url), nullif(btrim(p_api_url_ticketingapp), ''),
    nullif(btrim(p_client_id), ''), nullif(p_client_secret, ''), nullif(p_access_token, ''),
    p_is_active, p_socle_org_id, p_socle_updated_at, now()
  )
  on conflict (organization_id, provider) do update set
    api_base_url         = excluded.api_base_url,
    api_url_ticketingapp = excluded.api_url_ticketingapp,
    client_id            = excluded.client_id,
    client_secret        = excluded.client_secret,
    access_token         = excluded.access_token,
    is_active            = excluded.is_active,
    socle_root_org_id    = excluded.socle_root_org_id,
    socle_updated_at     = excluded.socle_updated_at,
    socle_synced_at      = excluded.socle_synced_at;
end;
$function$;

revoke all on function public.sync_arpege_integration_from_socle(uuid, uuid, text, text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.sync_arpege_integration_from_socle(uuid, uuid, text, text, text, text, text, boolean, timestamptz)
  to service_role;
