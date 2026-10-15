-- ============================================================================
-- Mots de passe IMAP / SMTP chiffrés dans Supabase Vault — étape C.
--
-- PRÉREQUIS (sinon l'envoi et la relève tombent) :
--   - 20261015070257_identifiants_mail_vault appliquée ;
--   - edge functions redéployées (lecture par get_smtp_password /
--     get_imap_password : action-task-mail, auth-email-hook, invite-user,
--     send-assignment-notification, send-courier-reply,
--     send-mention-notification, send-password-reset, fetch-inbound-emails) ;
--   - écran « Boîtes de réception » publié (set_imap_password, plus de
--     select("*") ni d'écriture de `password`).
--
-- Ce fichier : la synchronisation du Socle écrit le mot de passe SMTP dans
-- Vault, les triggers de transition disparaissent, et les colonnes en clair
-- avec eux.
--
-- Rejouable.
-- ============================================================================

-- 1. Synchronisation du serveur d'envoi : le mot de passe va dans Vault ----------
-- Même signature, même garde (GRANT service_role) que 20260823170000.
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
  v_host   text    := btrim(coalesce(p_host, ''));
  v_from   text    := lower(btrim(coalesce(p_from_email, '')));
  v_port   integer := coalesce(p_port, 587);
  v_secret uuid;
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
    organization_id, socle_org_id, host, port, username,
    from_email, from_name, use_tls, socle_updated_at, synced_at
  ) values (
    p_org_id, p_socle_org_id, v_host, v_port,
    btrim(coalesce(p_username, '')),
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
    from_email       = excluded.from_email,
    from_name        = excluded.from_name,
    use_tls          = excluded.use_tls,
    socle_updated_at = excluded.socle_updated_at,
    synced_at        = now()
  returning s.password_secret_id into v_secret;

  -- Miroir STRICT : un mot de passe vide est « pas de mot de passe ».
  -- Jamais élagué : une espace peut en faire partie.
  v_secret := public._put_mail_credential(v_secret, coalesce(p_password, ''), 'smtp:' || p_org_id);
  update public.smtp_settings set password_secret_id = v_secret where organization_id = p_org_id;
end
$fn$;

comment on function public.sync_smtp_settings_from_socle(uuid, uuid, text, integer, text, text, text, text, boolean, timestamptz) is
  'Écrit le miroir du serveur d''envoi d''un tenant depuis le Socle (mot de passe dans Vault) — SERVICE UNIQUEMENT (synchronisation du référentiel).';

revoke execute on function public.sync_smtp_settings_from_socle(uuid, uuid, text, integer, text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant  execute on function public.sync_smtp_settings_from_socle(uuid, uuid, text, integer, text, text, text, text, boolean, timestamptz)
  to service_role;

-- 2. Fin de la transition -----------------------------------------------------------
drop trigger if exists trg_imap_password_vault on public.imap_settings;
drop trigger if exists trg_smtp_password_vault on public.smtp_settings;
drop function if exists public._mail_credential_follow_password();

-- 3. Plus aucun mot de passe en clair --------------------------------------------------
alter table public.imap_settings drop column if exists password;
alter table public.smtp_settings drop column if exists password;
