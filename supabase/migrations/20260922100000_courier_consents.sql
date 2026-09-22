-- Consentements RGPD recueillis AU DÉPÔT d'un courrier (formulaire portail).
--
-- Le référentiel Socle est propriétaire du consentement d'une PERSONNE
-- (`contact_consents` + état dérivé sur `contacts`, via
-- `POST /v1/contacts/{id}/consents`). Mais un dépôt portail arrive SANS fiche
-- rapprochée : l'expéditeur n'est associé à un contact du référentiel que plus
-- tard, par un geste d'agent. Entre les deux, la preuve doit exister quelque
-- part — et rester la preuve de CE dépôt, même si l'usager retire son
-- consentement ensuite. D'où cette colonne : la trace du jour, immuable.
-- Même doctrine qu'Iris (`requests.consents`, migration 20260920100000).
--
-- Forme : [{ kind, granted, statement, collected_at }] — la phrase EXACTE lue
-- par l'usager, composée par le serveur depuis le catalogue fermé
-- (`supabase/functions/_shared/consents/catalog.ts`) et le nom de
-- l'organisation. La base enregistre un fait, elle n'arbitre pas le
-- catalogue : le CHECK ne vérifie que la forme « tableau ».
--
-- Deux gardes, une seule fonction :
--   • INSERT : un client (PostgREST sous la policy `auth_insert`, c'est-à-dire
--     tout éditeur) ne peut pas poser de trace. Seule la porte publique
--     (`portal-form`, service_role) a posé la question. Sans cette garde, un
--     agent pourrait FORGER un consentement par l'API REST, que l'immuabilité
--     figerait ensuite — leçon S1 du backlog sécurité d'Iris (2026-09-19).
--   • UPDATE : la trace ne se réécrit ni ne s'efface, service_role compris.
--     Vider = effacer une preuve ; remplir après coup = un consentement
--     rétroactif, qui n'existe pas.
--
-- Signal de contexte de service : `public.is_transition_guard_bypassed()`
-- (20260723101849) lit le claim JWT `role = service_role` — il survit à
-- SECURITY DEFINER, contrairement à `current_user`. Ne pas créer un second
-- helper.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS).
-- DB live = source de vérité (docs/deployment.md).

alter table public.couriers
  add column if not exists consents jsonb not null default '[]'::jsonb;

comment on column public.couriers.consents is
  'Consentements RGPD recueillis AU DÉPÔT (formulaire portail) : [{kind, granted, statement, collected_at}]. Écrit par portal-form seul (service_role), immuable ensuite. Catalogue fermé : _shared/consents/catalog.ts. Vide pour un courrier saisi par un agent, reçu par IMAP ou antérieur au 2026-09-22.';

-- `coalesce(...)` et non `jsonb_typeof(...) = 'array'` seul : sur un NULL,
-- jsonb_typeof rend NULL, le CHECK vaut NULL, et un CHECK NULL PASSE. La
-- colonne est NOT NULL, mais une garde qui dépend d'une autre garde n'en est
-- pas une.
alter table public.couriers drop constraint if exists couriers_consents_array;
alter table public.couriers add constraint couriers_consents_array
  check (coalesce(jsonb_typeof(consents), '') = 'array');

-- SECURITY INVOKER : la fonction ne lit aucune autre table, elle n'a besoin
-- d'aucun privilège (moindre privilège, comme `requests_protect_immutable`
-- chez Iris). Le helper de bypass est exécutable par `authenticated`.
create or replace function public.couriers_guard_consents()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'INSERT' then
    if new.consents <> '[]'::jsonb and not public.is_transition_guard_bypassed() then
      raise exception 'consents ne peut être posé que par le formulaire portail (contexte de service).'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE : une trace de consentement ne se réécrit ni ne s'efface.
  if new.consents is distinct from old.consents then
    raise exception 'consents est immuable : la trace du dépôt ne se réécrit pas.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

-- CREATE OR REPLACE re-accorde EXECUTE à PUBLIC : re-révoquer ICI, dans la
-- même migration (précédent : couriers_enforce_signature, 20260723163536).
revoke execute on function public.couriers_guard_consents() from public, anon, authenticated;

drop trigger if exists trg_couriers_consents_insert_guard on public.couriers;
create trigger trg_couriers_consents_insert_guard
  before insert on public.couriers
  for each row execute function public.couriers_guard_consents();

-- `of consents` : la fonction ne tourne pas à chaque changement d'état, de
-- tag ou de métadonnée — seulement quand la colonne est dans le SET.
drop trigger if exists trg_couriers_consents_immutable on public.couriers;
create trigger trg_couriers_consents_immutable
  before update of consents on public.couriers
  for each row execute function public.couriers_guard_consents();
