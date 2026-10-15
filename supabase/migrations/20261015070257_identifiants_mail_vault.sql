-- ============================================================================
-- Mots de passe IMAP / SMTP chiffrés dans Supabase Vault — étape A (additive).
--
-- Avant : `imap_settings.password` et `smtp_settings.password` en clair, et la
-- table `imap_settings` lisible depuis le navigateur par les administrateurs
-- d'organisation (policy `imap_admin`) — mot de passe compris.
--
-- Cible : chaque mot de passe est un secret Vault (chiffré au repos, clé gérée
-- par Supabase) référencé par `password_secret_id`. Seul le service le relit,
-- par deux RPC réservées à `service_role` ; le navigateur peut le REMPLACER
-- (`set_imap_password`, administrateur de l'organisation) mais jamais le lire.
--
-- Déploiement en trois temps, pour ne jamais couper l'envoi :
--   A (ce fichier) : colonnes, copie dans Vault, triggers de transition qui
--     tiennent Vault à jour tant que les anciennes fonctions écrivent encore
--     `password` ; RPC de lecture et d'écriture.
--   B : edge functions et écran passent par les RPC.
--   C (20261015070716) : suppression des colonnes en clair.
--
-- Rejouable : IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS.
-- ============================================================================

-- 1. Référence du secret --------------------------------------------------------
alter table public.imap_settings add column if not exists password_secret_id uuid;
alter table public.smtp_settings add column if not exists password_secret_id uuid;

comment on column public.imap_settings.password_secret_id is
  'Secret Vault du mot de passe IMAP (vault.secrets.id). Relu par le service seul (get_imap_password), remplacé par set_imap_password.';
comment on column public.smtp_settings.password_secret_id is
  'Secret Vault du mot de passe SMTP recopié du Socle (vault.secrets.id). Relu par le service seul (get_smtp_password).';

-- 2. Écriture d'un secret (interne) ----------------------------------------------
-- Crée le secret, ou le remplace s'il existe déjà. Aucun GRANT : appelée
-- uniquement par les fonctions SECURITY DEFINER ci-dessous et par les triggers.
create or replace function public._put_mail_credential(
  p_secret_id uuid,
  p_value     text,
  p_name      text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if p_secret_id is not null then
    select s.id into v_id from vault.secrets s where s.id = p_secret_id;
  end if;
  if v_id is null then
    -- Un nom de secret est unique : une ligne recréée réutilise le sien.
    select s.id into v_id from vault.secrets s where s.name = p_name;
  end if;
  if v_id is null then
    return vault.create_secret(coalesce(p_value, ''), p_name, 'Mot de passe de messagerie (Clara)');
  end if;
  perform vault.update_secret(v_id, coalesce(p_value, ''), p_name);
  return v_id;
end
$fn$;

revoke execute on function public._put_mail_credential(uuid, text, text) from public, anon, authenticated, service_role;

-- 3. Copie initiale ----------------------------------------------------------------
update public.imap_settings i
   set password_secret_id = public._put_mail_credential(i.password_secret_id, i.password, 'imap:' || i.id)
 where i.password_secret_id is null;

update public.smtp_settings s
   set password_secret_id = public._put_mail_credential(s.password_secret_id, s.password, 'smtp:' || s.organization_id)
 where s.password_secret_id is null;

-- 4. Triggers de transition (retirés à l'étape C) ------------------------------------
-- Tant que la synchronisation et l'ancien écran écrivent `password`, Vault suit.
create or replace function public._mail_credential_follow_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' or new.password is distinct from old.password then
    new.password_secret_id := public._put_mail_credential(
      new.password_secret_id,
      new.password,
      case tg_table_name when 'imap_settings' then 'imap:' || new.id
                         else 'smtp:' || new.organization_id end
    );
  end if;
  return new;
end
$fn$;

revoke execute on function public._mail_credential_follow_password() from public, anon, authenticated, service_role;

drop trigger if exists trg_imap_password_vault on public.imap_settings;
create trigger trg_imap_password_vault
  before insert or update of password on public.imap_settings
  for each row execute function public._mail_credential_follow_password();

drop trigger if exists trg_smtp_password_vault on public.smtp_settings;
create trigger trg_smtp_password_vault
  before insert or update of password on public.smtp_settings
  for each row execute function public._mail_credential_follow_password();

-- 5. Suppression d'une ligne → suppression du secret (définitif) ----------------------
create or replace function public._mail_credential_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if old.password_secret_id is not null then
    delete from vault.secrets s where s.id = old.password_secret_id;
  end if;
  return old;
end
$fn$;

revoke execute on function public._mail_credential_delete() from public, anon, authenticated, service_role;

drop trigger if exists trg_imap_credential_delete on public.imap_settings;
create trigger trg_imap_credential_delete
  after delete on public.imap_settings
  for each row execute function public._mail_credential_delete();

drop trigger if exists trg_smtp_credential_delete on public.smtp_settings;
create trigger trg_smtp_credential_delete
  after delete on public.smtp_settings
  for each row execute function public._mail_credential_delete();

-- 6. Lecture — SERVICE UNIQUEMENT ------------------------------------------------------
-- ⚠️ La garde est le GRANT (service_role seul) : dans une fonction SECURITY
--    DEFINER, `current_user` vaut le propriétaire.
create or replace function public.get_imap_password(p_imap_settings_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select d.decrypted_secret
    from public.imap_settings i
    join vault.decrypted_secrets d on d.id = i.password_secret_id
   where i.id = p_imap_settings_id
$fn$;

comment on function public.get_imap_password(uuid) is
  'Mot de passe IMAP déchiffré depuis Vault — SERVICE UNIQUEMENT (fetch-inbound-emails).';
revoke execute on function public.get_imap_password(uuid) from public, anon, authenticated;
grant  execute on function public.get_imap_password(uuid) to service_role;

create or replace function public.get_smtp_password(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select d.decrypted_secret
    from public.smtp_settings s
    join vault.decrypted_secrets d on d.id = s.password_secret_id
   where s.organization_id = p_org_id
$fn$;

comment on function public.get_smtp_password(uuid) is
  'Mot de passe SMTP déchiffré depuis Vault — SERVICE UNIQUEMENT (fonctions d''envoi).';
revoke execute on function public.get_smtp_password(uuid) from public, anon, authenticated;
grant  execute on function public.get_smtp_password(uuid) to service_role;

-- 7. Remplacement du mot de passe IMAP depuis l'écran -------------------------------------
-- Écriture seule : l'administrateur ne relit jamais le mot de passe enregistré.
create or replace function public.set_imap_password(p_imap_settings_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
  v_secret uuid;
begin
  select i.organization_id, i.password_secret_id into v_org, v_secret
    from public.imap_settings i where i.id = p_imap_settings_id;
  if v_org is null then
    raise exception 'Boîte de réception introuvable.' using errcode = 'P0002';
  end if;
  if not (public.is_admin_of(v_org) or public.is_superadmin((select auth.uid()))) then
    raise exception 'Réservé aux administrateurs de l''organisation.' using errcode = '42501';
  end if;
  v_secret := public._put_mail_credential(v_secret, coalesce(p_password, ''), 'imap:' || p_imap_settings_id);
  update public.imap_settings set password_secret_id = v_secret, updated_at = now()
   where id = p_imap_settings_id;
end
$fn$;

comment on function public.set_imap_password(uuid, text) is
  'Remplace le mot de passe d''une boîte IMAP (secret Vault) — administrateur de l''organisation ; le mot de passe n''est jamais relu.';
revoke execute on function public.set_imap_password(uuid, text) from public, anon;
grant  execute on function public.set_imap_password(uuid, text) to authenticated, service_role;

-- 8. Aucun droit anonyme sur la table (la RLS le refusait déjà) ------------------------------
-- La lecture du mot de passe par le navigateur cesse à l'étape C, avec la
-- colonne : un REVOKE de colonne ici casserait le `select("*")` de l'écran
-- encore en production.
revoke all on table public.imap_settings from anon;
