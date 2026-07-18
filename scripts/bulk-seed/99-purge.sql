-- Purge des données de charge — À EXÉCUTER EN DEUX TEMPS
--
-- Partie A : projet CLARA (aullweizxcjbvtdspjli)
-- Partie B : projet SOCLE (qhrokbkyxgcvkbpmbmna)
--
-- Ne supprime QUE ce que 01/02 ont créé, identifié par marqueur :
--   couriers.metadata->>'seed_bulk' = 'true'
--   courier_participants.metadata->>'seed_bulk' = 'true'
--   contacts.internal_notes = '[SEED-BULK]'
-- Les 61 courriers réels d'ACCM et les 5 contacts d'origine n'ont aucun de ces
-- marqueurs : ils survivent à la purge.

-- ─── Partie A — projet CLARA ─────────────────────────────────────────────────
-- L'ordre compte : les enfants référencent couriers.id sans ON DELETE CASCADE
-- garanti. On passe par la liste des courriers marqués plutôt que par le
-- marqueur des enfants, pour ne rien laisser derrière en cas d'insert partiel.

with cibles as (
  select id from couriers
  where organization_id = '55dab847-7a67-4fa2-b878-70c25338fc9e'
    and metadata->>'seed_bulk' = 'true'
),
del_events as (
  delete from courier_events where courier_id in (select id from cibles) returning 1
),
del_participants as (
  delete from courier_participants where courier_id in (select id from cibles) returning 1
),
del_couriers as (
  delete from couriers where id in (select id from cibles) returning 1
)
select
  (select count(*) from del_events) as evenements_supprimes,
  (select count(*) from del_participants) as participants_supprimes,
  (select count(*) from del_couriers) as courriers_supprimes;

-- Contrôle : doit renvoyer 61 (les courriers réels d'ACCM).
-- select count(*) from couriers where organization_id = '55dab847-7a67-4fa2-b878-70c25338fc9e';


-- ─── Partie B — projet SOCLE ─────────────────────────────────────────────────
-- À lancer APRÈS la partie A : tant que des participants pointent vers ces
-- contacts, les fiches restent référencées côté Clara (référence logique, sans
-- FK inter-projets — rien ne casserait, mais on aurait des liens morts).

-- delete from contacts
-- where organization_id = 'd5227d25-f327-493a-a9a2-278397531e33'
--   and internal_notes = '[SEED-BULK]';

-- Contrôle : doit renvoyer 5 (les contacts d'origine).
-- select count(*) from contacts where organization_id = 'd5227d25-f327-493a-a9a2-278397531e33';
