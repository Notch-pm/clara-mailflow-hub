-- ============================================================================
-- Les tags se rangent en DEUX GROUPES : thème et sentiment.
--
-- Un tag disait jusqu'ici deux choses très différentes sans le dire : « Voirie »
-- classe un SUJET, « Mécontentement » qualifie un TON. Mêlés dans une même
-- liste, ils se comptaient ensemble dans les statistiques et se peignaient dans
-- la même palette. On les sépare, et le code couleur suit : dégradé vert → rouge
-- pour le sentiment (une échelle ordonnée), teintes diversifiées pour le thème
-- (des catégories, sans ordre).
--
-- Le champ figé `courier_analyses.sentiment` (liste en dur : neutre, courtois,
-- urgent, mécontent, agressif, satisfait, inquiet) est REMPLACÉ par ce groupe :
-- ses sept valeurs deviennent des tags de départ, désormais renommables,
-- supprimables, applicables au courrier et comptées dans les stats. La colonne
-- reste en base (historique des analyses passées) mais n'est plus ni écrite ni
-- affichée.
--
-- Rejouable : IF NOT EXISTS / anti-collision partout (cf. docs/deployment.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Le groupe
--
-- `tag_group` et non `group` : mot réservé SQL, qu'il faudrait citer partout.
-- Défaut `theme` : c'est le sens historique d'un tag, et le défaut sûr — un tag
-- mal rangé en thème se déplace en deux clics, l'inverse fausserait la courbe
-- des sentiments sans que personne ne le voie.
-- ----------------------------------------------------------------------------
alter table public.courier_tags
  add column if not exists tag_group text not null default 'theme';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.courier_tags'::regclass and conname = 'courier_tags_group_check'
  ) then
    alter table public.courier_tags
      add constraint courier_tags_group_check check (tag_group in ('theme', 'sentiment'));
  end if;
end $$;

comment on column public.courier_tags.tag_group is
  'Groupe du tag : « theme » (sujet du courrier) ou « sentiment » (ton du rédacteur). Commande la palette proposée, l''affichage par groupe et la scission des statistiques.';

create index if not exists idx_courier_tags_org_group
  on public.courier_tags (organization_id, tag_group);

-- ----------------------------------------------------------------------------
-- 2. Reclassement des tags existants
--
-- Décision PO du 2026-09-10 : ne reclasser que les évidents, nommément. Aucune
-- heuristique — un « Affaire sensible » ou un « Prioritaire » sont ambigus et
-- restent en thème, à l'agent de trancher depuis l'écran de paramétrage.
-- ----------------------------------------------------------------------------
update public.courier_tags
   set tag_group = 'sentiment'
 where tag_group <> 'sentiment'
   and lower(name) in ('colère', 'colere', 'mécontentement', 'mecontentement',
                       'satisfaction', 'menaces', 'menace');

-- ----------------------------------------------------------------------------
-- 3. Les sept valeurs du champ figé deviennent des tags de sentiment
--
-- Insérées par organisation, SAUF si un tag équivalent y existe déjà : le
-- vocabulaire de la collectivité prime sur le nôtre (« Mécontentement » reste
-- « Mécontentement », on n'ajoute pas « mécontent » à côté). D'où la
-- comparaison par RACINE et non par égalité stricte.
--
-- Couleurs : les sept marches du dégradé, ordonnées par valence (vert = positif,
-- rouge = négatif). Le même barème vit côté client dans
-- `src/lib/tag-color.ts` — c'est un choix de design, pas une règle métier.
-- ----------------------------------------------------------------------------
insert into public.courier_tags (organization_id, name, color, tag_group)
select o.id, s.name, s.color, 'sentiment'
  from public.organizations o
 cross join (values
   ('Satisfait',  'hsl(152 83% 42%)', 'satisfa'),
   ('Courtois',   'hsl(88 62% 45%)',  'courtois'),
   ('Neutre',     'hsl(48 95% 50%)',  'neutre'),
   ('Inquiet',    'hsl(35 95% 52%)',  'inquie'),
   ('Urgent',     'hsl(22 92% 52%)',  'urgent'),
   ('Mécontent',  'hsl(8 85% 52%)',   'mécontent'),
   ('Agressif',   'hsl(0 84% 45%)',   'agressif')
 ) as s(name, color, stem)
 where not exists (
   select 1 from public.courier_tags t
    where t.organization_id = o.id
      and (lower(t.name) = lower(s.name) or lower(t.name) like s.stem || '%')
 );

-- ----------------------------------------------------------------------------
-- 4. Le code couleur, appliqué aux tags déjà en place
--
-- Sans ce passage, la consigne resterait lettre morte sur les données réelles :
-- « Voirie » en rouge vif et « Sécurité » en bleu se liraient encore comme des
-- sentiments. Les thèmes reçoivent donc une teinte de leur palette, distribuée
-- de façon déterministe (ordre alphabétique), et les sentiments reclassés en
-- §2 prennent leur place sur le dégradé.
--
-- Rien n'est perdu : la couleur d'un tag s'édite désormais depuis l'écran de
-- paramétrage.
-- ----------------------------------------------------------------------------
with themes as (
  select id, row_number() over (partition by organization_id order by lower(name)) - 1 as rank
    from public.courier_tags
   where tag_group = 'theme'
), palette as (
  select * from (values
    (0, 'hsl(212 92% 55%)'), (1, 'hsl(190 85% 42%)'), (2, 'hsl(243 75% 59%)'),
    (3, 'hsl(265 80% 60%)'), (4, 'hsl(292 70% 55%)'), (5, 'hsl(330 75% 55%)'),
    (6, 'hsl(25 40% 45%)'),  (7, 'hsl(215 25% 45%)'), (8, 'hsl(220 9% 46%)')
  ) as p(slot, color)
)
update public.courier_tags t
   set color = p.color
  from themes th
  join palette p on p.slot = th.rank % 9
 where t.id = th.id;

update public.courier_tags
   set color = case
     when lower(name) like 'satisfa%'  then 'hsl(152 83% 42%)'
     when lower(name) like 'courtois%' then 'hsl(88 62% 45%)'
     when lower(name) like 'neutre%'   then 'hsl(48 95% 50%)'
     when lower(name) like 'inquie%'   then 'hsl(35 95% 52%)'
     when lower(name) like 'urgent%'   then 'hsl(22 92% 52%)'
     when lower(name) like 'm%content%' then 'hsl(8 85% 52%)'
     else 'hsl(0 84% 45%)'  -- colère, menaces, et tout sentiment sans équivalent
   end
 where tag_group = 'sentiment';

-- ----------------------------------------------------------------------------
-- 5. Statistiques scindées par groupe
--
-- Le RPC rendait `tag_name` seul : impossible de séparer les deux courbes sans
-- redemander le référentiel de tags à chaque point. Il rend désormais le
-- GROUPE, résolu par jointure sur le nom (c'est ainsi que les tags appliqués
-- sont stockés : `couriers.metadata->'tags'` est un tableau de NOMS).
--
-- Un tag appliqué puis supprimé du référentiel — un « orphelin » — n'a plus de
-- groupe : il compte en thème, comme il comptait avant cette migration.
--
-- DROP avant CREATE : le type de retour change (cf. docs/deployment.md).
-- ----------------------------------------------------------------------------
drop function if exists public.stats_tag_evolution(uuid, timestamptz, uuid);

create or replace function public.stats_tag_evolution(
  p_org_id uuid,
  p_since timestamptz default (now() - '1 year'::interval),
  p_socle_organization_id uuid default null
)
returns table(period text, tag_name text, tag_group text, count bigint)
language sql
stable
set search_path to 'public'
as $function$
  SELECT
    to_char(date_trunc('month', c.received_at), 'YYYY-MM')      AS period,
    tag_name,
    COALESCE(MAX(t.tag_group), 'theme')                          AS tag_group,
    COUNT(*)::bigint                                             AS count
  FROM couriers c
  CROSS JOIN LATERAL jsonb_array_elements_text(c.metadata -> 'tags') AS tag_name
  LEFT JOIN courier_tags t
    ON t.organization_id = c.organization_id
   AND lower(t.name) = lower(tag_name)
  WHERE c.organization_id = p_org_id
    AND c.received_at >= p_since
    AND c.metadata ? 'tags'
    AND jsonb_array_length(c.metadata -> 'tags') > 0
    AND (p_socle_organization_id IS NULL OR c.socle_organization_id = p_socle_organization_id)
  GROUP BY date_trunc('month', c.received_at), tag_name
  ORDER BY date_trunc('month', c.received_at), tag_name;
$function$;

comment on function public.stats_tag_evolution(uuid, timestamptz, uuid) is
  'Évolution mensuelle des tags appliqués aux courriers reçus, avec leur groupe (theme/sentiment) résolu par jointure sur le nom. Un tag orphelin du référentiel compte en thème.';
