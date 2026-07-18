-- Courriers de charge — projet CLARA (aullweizxcjbvtdspjli), tenant ACCM
--
-- Génère 5 000 courriers, leurs participants (expéditeur + destinataire) et
-- 1 à 3 événements d'historique chacun. Chaque objet est PRÉFIXÉ par le nom de
-- l'organisation destinataire, ex. « [Services techniques] Demande de
-- raccordement… », pour repérer d'un coup d'œil le routage dans les listes.
--
-- Marqueur de purge : metadata->>'seed_bulk' = 'true' (voir 99-purge.sql).
-- Les 61 courriers réels d'ACCM n'ont pas ce marqueur et ne sont pas touchés.
--
-- Volume : ajuster le generate_series(1, 5000) ci-dessous.

with params as (
  select
    '55dab847-7a67-4fa2-b878-70c25338fc9e'::uuid as org,
    array[
      'Demande de raccordement au réseau d''eau potable',
      'Réclamation concernant la collecte des déchets ménagers',
      'Demande d''autorisation d''occupation du domaine public',
      'Signalement d''un nid-de-poule avenue des Alpilles',
      'Demande de subvention de fonctionnement',
      'Contestation d''un avis de taxe de séjour',
      'Demande d''acte de naissance',
      'Réclamation — nuisances sonores de chantier',
      'Demande de rendez-vous avec le Président',
      'Recours gracieux contre un refus de permis de construire',
      'Demande de branchement au réseau d''assainissement',
      'Signalement de dépôt sauvage chemin de Camargue',
      'Demande de mise à disposition d''une salle communale',
      'Réclamation sur une facture d''eau',
      'Demande de place de stationnement PMR',
      'Invitation à la cérémonie commémorative du 8 mai',
      'Demande de documentation en urbanisme',
      'Plainte pour nuisances sonores de voisinage',
      'Demande d''agrément d''assistante maternelle',
      'Candidature spontanée — services techniques',
      'Demande de dérogation scolaire',
      'Signalement d''un éclairage public défectueux',
      'Demande de raccordement fibre optique',
      'Réclamation sur le calcul de la redevance ordures ménagères',
      'Demande d''attestation de domicile',
      'Proposition de partenariat associatif',
      'Signalement d''un dégât des eaux sur voirie',
      'Demande d''élagage d''arbres en limite de propriété',
      'Réclamation — retard de traitement de dossier',
      'Demande de copie d''un arrêté municipal'
    ] as sujets,
    array[
      'reçu par courrier postal, transmis au service instructeur',
      'reçu par voie dématérialisée via le portail usager',
      'transmis par la préfecture pour attribution',
      'déposé au guichet unique, accusé de réception remis',
      'reçu par recommandé avec accusé de réception'
    ] as corps
),
-- Pondération des organisations destinataires : le Cabinet et les Services
-- techniques concentrent l'essentiel du flux réel, on reproduit ce déséquilibre
-- pour que la pagination soit testée sur des volumes inégaux.
org_pool as (
  select s.id, s.name, (row_number() over (order by s.name, gs)) - 1 as i
  from (values
    ('Direction du Cabinet', 30),
    ('Services techniques', 25),
    ('ACCM', 15),
    ('Mairie de Saint Martin de Crau', 12),
    ('Service Etat Civil', 8),
    ('Mairie de Saint Rémy de Provence', 6),
    ('Marie d''Arles', 4)
  ) w(nm, wt)
  join socle_organizations s
    on s.name = w.nm
   and s.organization_id = '55dab847-7a67-4fa2-b878-70c25338fc9e'
  cross join generate_series(1, w.wt) gs
),
org_n as (select count(*)::int as n from org_pool),
-- États du workflow inbound « test » (le seul de ce tenant), pondérés : un stock
-- réaliste est majoritairement en cours, avec une longue traîne de traités.
state_pool as (
  select ws.id, (row_number() over (order by ws.name, gs)) - 1 as i
  from (values
    ('Reçu', 25),
    ('En cours de traitement', 22),
    ('En attente d''instruction par les services', 18),
    ('En attente d''information', 10),
    ('Traité', 18),
    (' Archivé', 5),
    ('Annulé', 2)
  ) w(nm, wt)
  join workflow_states ws
    on ws.name = w.nm
   and ws.workflow_id = '6f9f71a8-acee-4ed4-83df-fa4debfea0a3'
  cross join generate_series(1, w.wt) gs
),
state_n as (select count(*)::int as n from state_pool),
-- Pool de contacts RECALCULÉ à l'identique de 01-contacts-socle.sql : mêmes
-- tableaux, même hachage md5, donc mêmes UUID et mêmes noms. Les contacts
-- vivent dans le projet Socle et courier_participants n'en garde qu'une
-- référence (socle_contact_id, sans FK inter-projets) : reproduire le calcul
-- évite d'avoir à transporter 300 lignes d'un projet à l'autre.
contact_brut as (
  select
    g,
    case when g <= 240
      then nm[1 + (('x' || substr(md5('nom' || g),1,8))::bit(32)::bigint & 2147483647) % array_length(nm,1)]
    end as last_name,
    case when g <= 240 then
      case when g % 2 = 0
        then pf[1 + (('x' || substr(md5('prenom' || g),1,8))::bit(32)::bigint & 2147483647) % array_length(pf,1)]
        else pm[1 + (('x' || substr(md5('prenom' || g),1,8))::bit(32)::bigint & 2147483647) % array_length(pm,1)]
      end
    end as first_name,
    case
      when g <= 240 then null
      when g <= 270 then ent[1 + (g-241) % array_length(ent,1)] || case when g > 255 then ' ' || (g-255)::text else '' end
      when g <= 290 then asso[1 + (g-271) % array_length(asso,1)] || case when g > 280 then ' ' || (g-280)::text else '' end
      else adm[1 + (g-291) % array_length(adm,1)] || case when g > 295 then ' ' || (g-295)::text else '' end
    end as legal_name
  from generate_series(1, 300) g
  cross join (
    select
      array['Marie','Sophie','Camille','Nathalie','Isabelle','Julie','Claire','Émilie','Céline','Laura','Sandrine','Aurélie','Fatima','Amina','Christine','Hélène','Valérie','Corinne','Patricia','Nadia'] as pf,
      array['Jean','Pierre','Michel','Philippe','Nicolas','Thomas','Julien','Karim','Mehdi','Olivier','Laurent','Sébastien','Alain','Bruno','Yannick','Stéphane','Frédéric','Pascal','Vincent','Antoine'] as pm,
      array['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','André','Lefèvre','Mercier','Dupont','Lambert','Bonnet','François','Martinez','Legrand','Garnier','Faure','Rousseau','Blanc','Guérin','Muller','Henry','Roussel','Chevalier'] as nm,
      array['Boulangerie du Forum','Garage des Alpilles','SARL Provence Bâtiment','Camping Les Oliviers','Transports Rhône-Durance','Pharmacie du Centre','Hôtel du Cloître','Restaurant La Camargue','Menuiserie Crau Services','SCI Les Platanes','Ambulances Arlésiennes','Électricité Générale du Midi','Cabinet Vétérinaire Van Gogh','Imprimerie Rhodanienne','Terrassement Sud TP'] as ent,
      array['Comité des fêtes de Fontvieille','Club de pétanque arlésien','Association des commerçants du Centre','Les Amis du Patrimoine','Club de plongée Camargue','Sauvegarde des Alpilles','Association des parents d''élèves Mistral','Secours populaire — antenne Arles','Vélo Club de Crau','Chorale Les Voix du Rhône'] as asso,
      array['Préfecture des Bouches-du-Rhône','Conseil Départemental 13','Région Provence-Alpes-Côte d''Azur','DDTM 13','Agence Régionale de Santé PACA'] as adm
  ) a
),
contact_pool as (
  select
    md5('clara-bulk-contact-' || b.g)::uuid as id,
    -- display_name est une colonne générée côté Socle : « Nom Prénom » pour une
    -- personne, legal_name sinon. On reproduit la même règle.
    coalesce(b.legal_name, b.last_name || ' ' || b.first_name) as display_name,
    lower(translate(
      regexp_replace(coalesce(b.legal_name, b.first_name || '.' || b.last_name),
                     '[^[:alnum:]]+', '.', 'g'),
      'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ', 'aaaeeeeiioouuucAAAEEEEIIOOUUUC'
    )) || '.' || b.g || '@exemple.fr' as email,
    b.g - 1 as i
  from contact_brut b
),
contact_n as (select count(*)::int as n from contact_pool),
nouveaux as (
  select
    gen_random_uuid() as id,
    gen.g,
    o.id as socle_org_id,
    o.name as socle_org_name,
    st.id as state_id,
    -- Réception étalée sur 24 mois, resserrée sur les 6 derniers mois pour que
    -- le tri par date ait un « présent » dense comme en production.
    (now()
      - (case when gen.g % 3 = 0 then (gen.g % 180) else 180 + (gen.g % 550) end || ' days')::interval
      - ((gen.g * 37) % 86400 || ' seconds')::interval
    ) as received_at,
    p.sujets[1 + (gen.g * 7) % array_length(p.sujets, 1)] as sujet,
    p.corps[1 + (gen.g * 3) % array_length(p.corps, 1)] as corps,
    case when gen.g % 9 = 0 then 'outbound' else 'inbound' end as direction,
    (array['paper','email','portal'])[1 + (gen.g * 5) % 3] as channel,
    c.id as contact_id,
    c.display_name as contact_name,
    c.email as contact_email
  -- generate_series est aliasé en gen(g) et les jointures sont toutes explicites :
  -- avec « FROM a, b JOIN c ON (…a…) » la virgule lie moins fort que le JOIN et
  -- la clause ON ne voit pas a (« invalid reference to FROM-clause entry »).
  from generate_series(1, 5000) as gen(g)
  cross join params p
  cross join org_n
  cross join state_n
  cross join contact_n
  -- Index tirés de md5 et non de (g*k)%n : les pools organisation et état font
  -- tous deux 100 entrées, donc des multiplicateurs donneraient deux suites de
  -- même période 100 — chaque organisation resterait couplée au même état et
  -- certaines n'auraient jamais de courrier « Traité ».
  join org_pool o
    on o.i = (('x' || substr(md5('org' || gen.g),1,8))::bit(32)::bigint & 2147483647) % org_n.n
  join state_pool st
    on st.i = (('x' || substr(md5('etat' || gen.g),1,8))::bit(32)::bigint & 2147483647) % state_n.n
  left join contact_pool c
    on c.i = (('x' || substr(md5('contact' || gen.g),1,8))::bit(32)::bigint & 2147483647) % contact_n.n
),
ins_couriers as (
  insert into couriers (
    id, organization_id, direction, channel, subject,
    received_at, sent_at, assigned_service, socle_organization_id,
    workflow_state_id, metadata, created_at, updated_at
  )
  select
    n.id,
    '55dab847-7a67-4fa2-b878-70c25338fc9e'::uuid,
    n.direction::courier_direction,
    n.channel::courier_channel,
    '[' || n.socle_org_name || '] ' || n.sujet
      || ' — dossier ' || to_char(n.received_at, 'YYYY') || '-'
      || lpad(n.g::text, 5, '0'),
    case when n.direction = 'inbound' then n.received_at end,
    case when n.direction = 'outbound' then n.received_at end,
    n.socle_org_name,
    n.socle_org_id,
    n.state_id,
    jsonb_build_object(
      'seed_bulk', true,
      'body_text', 'Courrier ' || n.corps || '. Objet : ' || n.sujet || '.',
      'socle_organization_id', n.socle_org_id::text
    ),
    n.received_at,
    n.received_at
  from nouveaux n
  returning id
),
ins_sender as (
  insert into courier_participants (
    organization_id, courier_id, role, name, email, socle_contact_id, metadata
  )
  select
    '55dab847-7a67-4fa2-b878-70c25338fc9e'::uuid,
    n.id,
    'sender'::participant_role,
    n.contact_name,
    n.contact_email,
    n.contact_id,
    '{"seed_bulk": true}'::jsonb
  from nouveaux n
  where n.contact_id is not null
  returning courier_id
),
ins_recipient as (
  insert into courier_participants (
    organization_id, courier_id, role, name, organization, metadata
  )
  select
    '55dab847-7a67-4fa2-b878-70c25338fc9e'::uuid,
    n.id,
    'recipient'::participant_role,
    n.socle_org_name,
    n.socle_org_name,
    '{"seed_bulk": true}'::jsonb
  from nouveaux n
  returning courier_id
),
ins_events as (
  insert into courier_events (organization_id, courier_id, event_type, payload, created_at)
  select
    '55dab847-7a67-4fa2-b878-70c25338fc9e'::uuid,
    n.id,
    e.event_type,
    jsonb_build_object('seed_bulk', true, 'source', 'bulk-seed'),
    n.received_at + (e.rang || ' hours')::interval
  from nouveaux n
  cross join lateral (
    values
      (1, case when n.channel = 'email' then 'email_received' else 'state_changed' end),
      (2, 'instruction_started'),
      (3, 'service_transferred')
  ) e(rang, event_type)
  -- 1 à 3 événements selon le courrier : historiques de longueurs inégales.
  where e.rang <= 1 + (n.g % 3)
  returning courier_id
)
select
  (select count(*) from ins_couriers) as couriers,
  (select count(*) from ins_sender) as expediteurs,
  (select count(*) from ins_recipient) as destinataires,
  (select count(*) from ins_events) as evenements;
