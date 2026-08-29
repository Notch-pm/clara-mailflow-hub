-- ============================================================================
-- Le serveur d'envoi (SMTP) VIENT DU SOCLE — il ne se saisit plus dans Clara.
-- Décision PO du 2026-08-23, après la même bascule côté Iris le matin même.
--
-- Invariant de la gamme : « le Socle est la source de vérité ». Le relais de
-- messagerie d'une collectivité est défini UNE fois, dans le Socle, sur
-- l'organisation principale (onglet « Emails (SMTP) », visible sur la seule
-- racine). Clara n'en garde qu'un MIROIR, rafraîchi à chaque synchronisation du
-- référentiel (`sync-socle-referentiel`) — au même titre que son miroir
-- d'organisations (`socle_organizations`) et son cache de démarches.
--
-- Ce que cette migration retire :
--   • l'écriture ET la lecture clientes de `smtp_settings` (l'écran
--     « Emails (SMTP) » de `/superadmin/organisations/:orgId` disparaît, ainsi
--     que l'edge function `send-test-email` — le test se fait dans le Socle) ;
--   • `updated_at` et son déclencheur : plus personne ne « modifie » cette
--     table, elle est écrite par une synchronisation. La fraîcheur se lit
--     désormais dans `synced_at` (quand Clara a recopié) et `socle_updated_at`
--     (quand le Socle a changé).
--
-- Ce qu'elle pose : deux RPC de SERVICE, unique porte d'écriture du miroir.
--
-- Le mot de passe reste EN CLAIR dans la colonne `password` : décision PO
-- explicite de ne pas mêler les deux chantiers. Les sept fonctions d'envoi
-- (auth-email-hook, invite-user, send-courier-reply, send-password-reset,
-- send-assignment-notification, send-mention-notification) continuent donc de
-- lire les mêmes colonnes sans être modifiées. Le chiffrement (Vault) reste
-- inscrit à `docs/technical-debt.md` et se fera en un seul chantier avec
-- `imap_settings`, qui est en clair lui aussi.
--
-- La ligne déjà saisie à la main (tenant ACCM) est CONSERVÉE : les mails
-- continuent de partir jusqu'à la première synchronisation, qui la remplacera
-- par ce que déclare le Socle. `socle_org_id`, `socle_updated_at` et
-- `synced_at` restent nuls tant que cette synchronisation n'a pas eu lieu —
-- c'est la signature d'une ligne d'origine manuelle.
--
-- Rejouable : IF EXISTS / OR REPLACE partout (cf. docs/deployment.md, dérive
-- du registre de migrations).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fin de la saisie (et de la lecture) cliente
--
-- Les GRANT de table restaient ceux, complets, que Supabase pose par défaut sur
-- `anon` et `authenticated` : seule la RLS gardait la table. Retirer la policy
-- sans retirer les GRANT laisserait la porte ouverte à la première policy
-- ajoutée par mégarde. On retire les deux.
-- ----------------------------------------------------------------------------
drop policy if exists smtp_admin           on public.smtp_settings;
drop policy if exists org_admin_read_smtp  on public.smtp_settings;
drop policy if exists org_admin_write_smtp on public.smtp_settings;
drop policy if exists superadmin_all_smtp  on public.smtp_settings;

revoke all on table public.smtp_settings from anon, authenticated;

-- Le service garde tout : c'est lui qui synchronise et qui expédie.
drop policy if exists service_role_full_smtp on public.smtp_settings;
create policy service_role_full_smtp on public.smtp_settings
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- 2. La table devient un miroir : provenance et fraîcheur, plus de « modifié le »
-- ----------------------------------------------------------------------------
drop trigger if exists set_smtp_updated_at on public.smtp_settings;

alter table public.smtp_settings
  drop column if exists updated_at,
  add  column if not exists socle_org_id     uuid,
  add  column if not exists socle_updated_at timestamptz,
  add  column if not exists synced_at        timestamptz;

comment on table public.smtp_settings is
  'MIROIR du serveur d''envoi défini dans le Socle sur l''organisation racine du tenant. Écrit uniquement par sync_smtp_settings_from_socle / clear_smtp_settings_from_socle (synchronisation du référentiel) — aucune saisie dans Clara.';
comment on column public.smtp_settings.socle_org_id is
  'Organisation Socle (racine du tenant) d''où vient cette configuration. NULL = ligne héritée de la saisie manuelle, jamais synchronisée.';
comment on column public.smtp_settings.socle_updated_at is
  'Date de dernière modification côté Socle, telle que servie par son API — sert au diagnostic.';
comment on column public.smtp_settings.synced_at is
  'Date de la synchronisation qui a écrit cette ligne. NULL = jamais synchronisée.';
comment on column public.smtp_settings.password is
  'Mot de passe du relais, EN CLAIR (dette P1 connue, cf. docs/technical-debt.md) — reçu du Socle, jamais journalisé. Chaîne vide = relais sans authentification.';

-- ----------------------------------------------------------------------------
-- 3. sync_smtp_settings_from_socle — unique porte d'écriture (SERVICE).
--
-- Miroir STRICT : ce que le Socle sert fait foi, Y COMPRIS l'absence. Un mot de
-- passe vide n'est pas « inchangé », c'est « pas de mot de passe » — il n'y a
-- pas ici un utilisateur qui omet un champ, il y a une source qui déclare.
--
-- ⚠️ La garde est le GRANT (service_role seul), pas un test de `current_user` :
--    dans une fonction SECURITY DEFINER, `current_user` vaut toujours le
--    propriétaire.
-- ----------------------------------------------------------------------------
create or replace function public.sync_smtp_settings_from_socle(
  p_org_id           uuid,
  p_socle_org_id     uuid,
  p_host             text,
  p_port             integer,
  p_username         text,
  p_password         text,
  p_from_email       text,
  p_from_name        text,
  p_use_tls          boolean,
  p_socle_updated_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_host text    := btrim(coalesce(p_host, ''));
  v_from text    := lower(btrim(coalesce(p_from_email, '')));
  v_port integer := coalesce(p_port, 587);
begin
  -- Un relais à moitié configuré n'expédie pas : il fait échouer des mails
  -- d'authentification. L'appelant doit effacer le miroir, pas écrire un
  -- fantôme (cf. clear_smtp_settings_from_socle).
  if v_host = '' or v_from = '' then
    raise exception 'Serveur d''envoi incomplet : hôte et adresse d''expédition requis.'
      using errcode = '22023';
  end if;
  if v_port < 1 or v_port > 65535 then
    v_port := 587;
  end if;

  insert into public.smtp_settings as s (
    organization_id, socle_org_id, host, port, username, password,
    from_email, from_name, use_tls, socle_updated_at, synced_at
  ) values (
    p_org_id, p_socle_org_id, v_host, v_port,
    btrim(coalesce(p_username, '')),
    coalesce(p_password, ''),          -- jamais élagué : une espace peut en faire partie
    v_from,
    btrim(coalesce(p_from_name, '')),
    coalesce(p_use_tls, true),
    p_socle_updated_at,
    now()
  )
  on conflict (organization_id) do update set
    socle_org_id     = excluded.socle_org_id,
    host             = excluded.host,
    port             = excluded.port,
    username         = excluded.username,
    password         = excluded.password,
    from_email       = excluded.from_email,
    from_name        = excluded.from_name,
    use_tls          = excluded.use_tls,
    socle_updated_at = excluded.socle_updated_at,
    synced_at        = now();
end
$fn$;

comment on function public.sync_smtp_settings_from_socle(uuid, uuid, text, integer, text, text, text, text, boolean, timestamptz) is
  'Écrit le miroir du serveur d''envoi d''un tenant depuis le Socle — SERVICE UNIQUEMENT (synchronisation du référentiel).';

revoke execute on function public.sync_smtp_settings_from_socle(uuid, uuid, text, integer, text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant  execute on function public.sync_smtp_settings_from_socle(uuid, uuid, text, integer, text, text, text, text, boolean, timestamptz)
  to service_role;

-- ----------------------------------------------------------------------------
-- 4. clear_smtp_settings_from_socle — le Socle ne déclare plus de relais.
--
-- Clara n'a AUCUN relais de repli (aucun secret SMTP_* dans les fonctions) :
-- effacer le miroir, c'est arrêter d'expédier pour ce tenant. C'est le
-- comportement voulu — un miroir qui survit à sa source ment, et une
-- configuration périmée envoie des mails qui n'arrivent pas ou fâchent le
-- relais.
-- ----------------------------------------------------------------------------
create or replace function public.clear_smtp_settings_from_socle(p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer := 0;
begin
  delete from public.smtp_settings s where s.organization_id = p_org_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end
$fn$;

comment on function public.clear_smtp_settings_from_socle(uuid) is
  'Retire le miroir du serveur d''envoi d''un tenant (le Socle n''en déclare plus) — SERVICE UNIQUEMENT. Renvoie vrai si une ligne existait.';

revoke execute on function public.clear_smtp_settings_from_socle(uuid) from public, anon, authenticated;
grant  execute on function public.clear_smtp_settings_from_socle(uuid) to service_role;
