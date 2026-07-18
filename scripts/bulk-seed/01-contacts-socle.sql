-- Pool de contacts de charge — projet SOCLE (qhrokbkyxgcvkbpmbmna)
--
-- Crée 300 contacts sous la racine ACCM (d5227d25-…) pour que les expéditeurs
-- des courriers de charge pointent vers de vraies fiches : lien « voir la
-- fiche », badge quartier, détection de doublons. Sans ce pool, les 5 contacts
-- existants seraient réutilisés 1000 fois chacun.
--
-- Marqueur de purge : internal_notes = '[SEED-BULK]' (voir 99-purge.sql).
-- Rejouable : relancer crée un lot supplémentaire — purger d'abord si besoin.

with params as (
  select
    'd5227d25-f327-493a-a9a2-278397531e33'::uuid as socle_org,
    array['Marie','Sophie','Camille','Nathalie','Isabelle','Julie','Claire',
          'Émilie','Céline','Laura','Sandrine','Aurélie','Fatima','Amina',
          'Christine','Hélène','Valérie','Corinne','Patricia','Nadia'] as pf,
    array['Jean','Pierre','Michel','Philippe','Nicolas','Thomas','Julien',
          'Karim','Mehdi','Olivier','Laurent','Sébastien','Alain','Bruno',
          'Yannick','Stéphane','Frédéric','Pascal','Vincent','Antoine'] as pm,
    array['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit',
          'Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel',
          'Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel',
          'Girard','André','Lefèvre','Mercier','Dupont','Lambert','Bonnet',
          'François','Martinez','Legrand','Garnier','Faure','Rousseau','Blanc',
          'Guérin','Muller','Henry','Roussel','Chevalier'] as nm,
    array['Arles','Saint Martin de Crau','Saint Rémy de Provence','Tarascon',
          'Fontvieille','Les Baux-de-Provence','Saint-Étienne-du-Grès',
          'Boulbon'] as villes,
    array['13200','13310','13210','13150','13990','13520','13103','13150'] as cps,
    array['Boulangerie du Forum','Garage des Alpilles','SARL Provence Bâtiment',
          'Camping Les Oliviers','Transports Rhône-Durance','Pharmacie du Centre',
          'Hôtel du Cloître','Restaurant La Camargue','Menuiserie Crau Services',
          'SCI Les Platanes','Ambulances Arlésiennes',
          'Électricité Générale du Midi','Cabinet Vétérinaire Van Gogh',
          'Imprimerie Rhodanienne','Terrassement Sud TP'] as ent,
    array['Comité des fêtes de Fontvieille','Club de pétanque arlésien',
          'Association des commerçants du Centre','Les Amis du Patrimoine',
          'Club de plongée Camargue','Sauvegarde des Alpilles',
          'Association des parents d''élèves Mistral',
          'Secours populaire — antenne Arles','Vélo Club de Crau',
          'Chorale Les Voix du Rhône'] as asso,
    array['Préfecture des Bouches-du-Rhône','Conseil Départemental 13',
          'Région Provence-Alpes-Côte d''Azur','DDTM 13',
          'Agence Régionale de Santé PACA'] as adm,
    array['rue','avenue','boulevard','impasse','chemin'] as voies,
    array['de la République','Victor Hugo','des Lices','Jean Jaurès',
          'des Alpilles','du 8 Mai','Frédéric Mistral','de Camargue'] as rues
),
quartiers_pool as (
  select array_agg(id order by name) as ids, count(*)::int as n
  from quartiers
  where organization_id = 'd5227d25-f327-493a-a9a2-278397531e33'
),
lignes as (
  select
    g,
    case
      when g <= 240 then 'personne'
      when g <= 270 then 'entreprise'
      when g <= 290 then 'association'
      else 'administration'
    end as contact_type
  from generate_series(1, 300) g
),
construites as (
  select
    l.g,
    l.contact_type,
    case when l.contact_type <> 'personne' then null
         when l.g % 2 = 0 then 'madame' else 'monsieur' end as civility,
    -- Index tirés de md5, pas d'un multiplicateur : avec (g*7)%20 et (g*13)%40
    -- les deux index se resynchronisent tous les 40 tours et on ne produit que
    -- 40 noms distincts sur 240 fiches (un LCG fait à peine mieux : 113). md5
    -- donne 204 combinaisons ET reste identique d'une instance Postgres à
    -- l'autre — c'est ce qui permet à 02-couriers-clara.sql de recalculer les
    -- mêmes noms sans table de liaison entre les deux projets.
    case when l.contact_type <> 'personne' then null
         when l.g % 2 = 0
           then p.pf[1 + (('x' || substr(md5('prenom' || l.g), 1, 8))::bit(32)::bigint
                          & 2147483647) % array_length(p.pf, 1)]
         else p.pm[1 + (('x' || substr(md5('prenom' || l.g), 1, 8))::bit(32)::bigint
                        & 2147483647) % array_length(p.pm, 1)] end as first_name,
    case when l.contact_type <> 'personne' then null
         else p.nm[1 + (('x' || substr(md5('nom' || l.g), 1, 8))::bit(32)::bigint
                        & 2147483647) % array_length(p.nm, 1)] end as last_name,
    case
      when l.contact_type = 'entreprise'
        then p.ent[1 + (l.g - 241) % array_length(p.ent, 1)]
             || case when l.g > 255 then ' ' || (l.g - 255)::text else '' end
      when l.contact_type = 'association'
        then p.asso[1 + (l.g - 271) % array_length(p.asso, 1)]
             || case when l.g > 280 then ' ' || (l.g - 280)::text else '' end
      when l.contact_type = 'administration'
        then p.adm[1 + (l.g - 291) % array_length(p.adm, 1)]
             || case when l.g > 295 then ' ' || (l.g - 295)::text else '' end
      else null
    end as legal_name,
    p.villes[1 + (l.g * 3) % array_length(p.villes, 1)] as ville,
    p.cps[1 + (l.g * 3) % array_length(p.cps, 1)] as cp,
    (1 + (l.g * 17) % 120)::text || ' '
      || p.voies[1 + (l.g * 3) % array_length(p.voies, 1)] || ' '
      || p.rues[1 + (l.g * 5) % array_length(p.rues, 1)] as adresse
  from lignes l cross join params p
)
-- display_name, mobile_phone_normalized et landline_phone_normalized sont des
-- colonnes générées (display_name = « Nom Prénom » pour une personne, sinon
-- legal_name) : les renseigner ferait échouer l'INSERT.
insert into contacts (
  id, organization_id, contact_type, civility, first_name, last_name, legal_name,
  email, mobile_phone, landline_phone,
  address_line1, postal_code, city, country,
  preferred_channel, consent_email, consent_sms,
  internal_notes, status, quartier_id, quartier_auto, created_at, updated_at
)
select
  -- Identifiant déterministe : 02-couriers-clara.sql recalcule exactement les
  -- mêmes UUID pour renseigner courier_participants.socle_contact_id, alors que
  -- les deux tables vivent dans des projets Supabase distincts (aucune FK).
  md5('clara-bulk-contact-' || c.g)::uuid,
  'd5227d25-f327-493a-a9a2-278397531e33'::uuid,
  c.contact_type,
  c.civility,
  c.first_name,
  c.last_name,
  c.legal_name,
  -- Adresse mail dérivée du nom, translittérée et suffixée par l'index :
  -- garantit l'unicité même quand deux fiches portent le même patronyme.
  lower(
    translate(
      regexp_replace(
        coalesce(c.legal_name, c.first_name || '.' || c.last_name),
        '[^[:alnum:]]+', '.', 'g'
      ),
      'àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ',
      'aaaeeeeiioouuucAAAEEEEIIOOUUUC'
    )
  ) || '.' || c.g || '@exemple.fr',
  '06' || lpad(((c.g * 7919) % 100000000)::text, 8, '0'),
  case when c.g % 3 = 0
    then '04' || lpad(((c.g * 6151) % 100000000)::text, 8, '0') end,
  c.adresse,
  c.cp,
  c.ville,
  'France',
  (array['email','telephone','courrier'])[1 + c.g % 3],
  c.g % 4 <> 0,
  c.g % 5 = 0,
  '[SEED-BULK]',
  'active',
  -- 1 fiche sur 6 sans quartier : le badge doit aussi savoir ne rien afficher.
  case when c.g % 6 = 0 then null else qp.ids[1 + c.g % qp.n] end,
  false,
  now() - ((c.g % 700) || ' days')::interval,
  now() - ((c.g % 700) || ' days')::interval
from construites c cross join quartiers_pool qp;
