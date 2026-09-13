-- Référence séquentielle annuelle des courriers (« chrono »).
--
-- La colonne `couriers.chrono` existait depuis l'origine, était lue par six
-- écrans, la recherche de liaison et l'enveloppe Iris — et n'a JAMAIS été
-- écrite : 0 référence sur 5 080 courriers au 2026-09-13, `courier_sequences`
-- vide, aucun trigger ni fonction pour la produire. Fonctionnalité fantôme
-- relevée dans `docs/technical-debt.md` le 2026-07-23, tranchée le 2026-09-13 :
-- on implémente.
--
-- ── Pourquoi un TRIGGER et pas une RPC appelée par les écrans ──
-- Un courrier entre dans Clara par au moins six portes : IMAP
-- (`fetch-inbound-emails`), boîte de numérisation, formulaire public
-- (`portal-form`), saisie d'un agent, import en masse, et la réponse créée par
-- `send-courier-reply`. Une RPC qu'il faut penser à appeler, c'est une porte
-- qu'on oublie — et un registre à trous ne vaut rien. Le trigger tient
-- l'invariant pour toutes les portes à la fois, service_role compris.
--
-- ── Pourquoi l'année d'ENREGISTREMENT, pas celle du courrier ──
-- `now()`, donc l'année où le courrier entre dans Clara, jamais `received_at`.
-- Un registre ne se remplit que par la fin : importer en 2026 une lettre de
-- 2024 ne doit pas insérer un numéro au milieu d'une année close. Le prix à
-- payer est assumé — un courrier reçu le 31/12 et enregistré le 02/01 porte
-- l'année suivante, ce qui est exactement ce que dit un registre papier.
--
-- ── Pas de trous ──
-- L'incrément vit dans la MÊME transaction que l'insertion : une transaction
-- annulée rend son numéro. Le verrou de ligne sur `courier_sequences` sérialise
-- les insertions concurrentes d'une même organisation — c'est voulu, c'est ce
-- qui garantit l'unicité, et le volume d'un courrier de collectivité (quelques
-- milliers par an) ne s'en aperçoit pas.

-- ── 1. Attribution ──

create or replace function public.assign_courier_chrono()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_year int;
  v_value int;
begin
  if tg_op = 'UPDATE' then
    -- Un registre ne se réécrit pas : une référence attribuée est définitive.
    -- Seul le passage de NULL à une valeur reste ouvert — c'est par là que
    -- passerait une reprise des 5 080 courriers antérieurs.
    if old.chrono is not null and new.chrono is distinct from old.chrono then
      raise exception 'La référence d''un courrier est définitive (% → %)',
        old.chrono, new.chrono using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Une valeur explicite est respectée (reprise, import d'un registre existant).
  if new.chrono is not null and btrim(new.chrono) <> '' then
    return new;
  end if;

  v_year := extract(year from now())::int;

  -- Un seul aller-retour, et le verrou de ligne tombe sur la bonne ligne :
  -- `on conflict do update` crée le compteur au premier courrier de l'année et
  -- l'incrémente ensuite. Un `select … for update` suivi d'un `update` aurait
  -- laissé la place à deux créations concurrentes du même compteur.
  insert into public.courier_sequences (organization_id, year, direction, last_value)
  values (new.organization_id, v_year, new.direction, 1)
  on conflict (organization_id, year, direction)
    do update set last_value = courier_sequences.last_value + 1
  returning last_value into v_value;

  -- `2026-E-00042` : année, sens, rang. La lettre n'est pas cosmétique — les
  -- compteurs sont PAR SENS, sans elle un entrant nº 42 et un sortant nº 42
  -- porteraient la même référence.
  new.chrono := v_year
    || '-' || case new.direction
                when 'inbound' then 'E'   -- Entrant
                when 'outbound' then 'S'  -- Sortant
                else 'I'                  -- Interne
              end
    || '-' || lpad(v_value::text, 5, '0');
  return new;
end;
$$;

alter function public.assign_courier_chrono() owner to postgres;

comment on function public.assign_courier_chrono() is
  'Attribue couriers.chrono (format AAAA-E|S|I-NNNNN) depuis courier_sequences, et rend la reference definitive une fois posee. Trigger uniquement.';

drop trigger if exists trg_couriers_assign_chrono on public.couriers;
create trigger trg_couriers_assign_chrono
  before insert on public.couriers
  for each row execute function public.assign_courier_chrono();

drop trigger if exists trg_couriers_chrono_immutable on public.couriers;
create trigger trg_couriers_chrono_immutable
  before update of chrono on public.couriers
  for each row execute function public.assign_courier_chrono();

-- ── 2. Unicité ──
-- Le trigger ne peut pas produire de doublon, mais une reprise mal écrite le
-- pourrait. Partiel : les 5 080 courriers antérieurs restent à NULL, et NULL
-- n'entre pas dans un index unique.

create unique index if not exists couriers_organization_chrono_uniq
  on public.couriers (organization_id, chrono)
  where chrono is not null;

-- ── 3. Le compteur cesse d'être écrivable par les clients ──
-- Tant que `courier_sequences` ne servait à rien, ses quatre policies
-- `auth_*` étaient sans conséquence. Maintenant qu'elle porte le registre,
-- un membre qui remettrait `last_value` en arrière ferait resservir des
-- numéros déjà attribués — l'index unique rejetterait l'insertion, mais
-- l'ingestion IMAP tomberait en panne sans que rien n'explique pourquoi.
-- Seuls le service_role et le trigger (SECURITY DEFINER) écrivent désormais.
-- Personne côté client ne lisait cette table : `courierSequenceService.ts`,
-- son unique lecteur, n'avait aucun appelant et disparaît avec cette migration.

drop policy if exists auth_select on public.courier_sequences;
drop policy if exists auth_insert on public.courier_sequences;
drop policy if exists auth_update on public.courier_sequences;
drop policy if exists auth_delete on public.courier_sequences;

revoke all on public.courier_sequences from anon, authenticated;

comment on table public.courier_sequences is
  'Compteurs du registre : un par organisation x annee x sens. Ecrite UNIQUEMENT par assign_courier_chrono() et le service_role — aucun acces client.';
comment on column public.courier_sequences.last_value is
  'Dernier rang attribue. Ne jamais diminuer : les references deja posees seraient resservies.';
