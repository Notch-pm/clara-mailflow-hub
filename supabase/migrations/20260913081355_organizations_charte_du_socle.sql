-- La charte graphique (couleurs) n'est plus saisie dans Clara : c'est un miroir
-- du référentiel, écrit par `sync-socle-referentiel` depuis le 2026-09-13.
--
-- Retirer l'écran de saisie ne suffirait pas : la policy `org_admin_update`
-- autorise un administrateur d'organisation à écrire N'IMPORTE QUELLE colonne de
-- sa ligne `organizations` — donc les couleurs, par PostgREST, sans passer par
-- l'interface. Un miroir qu'un client peut réécrire n'est plus un miroir : il
-- diverge de sa source jusqu'à la synchronisation suivante, qui le rattrape en
-- silence (motif `smtp_settings`, dont les GRANT client ont été retirés le
-- 2026-08-23).
--
-- `service_role` n'est pas concerné : il contourne RLS et GRANT, c'est par lui
-- qu'écrit la synchronisation.

-- 1) Normalisation de l'existant à la forme servie par le référentiel
--    (`#rrggbb` minuscule). Ce qui n'est pas une couleur hexadécimale part à
--    NULL — la prochaine synchronisation réécrira ces deux colonnes de toute
--    façon, depuis le Socle.
update public.organizations
   set primary_color = case
         when primary_color ~* '^#[0-9a-f]{6}$' then lower(primary_color)
         else null
       end,
       secondary_color = case
         when secondary_color ~* '^#[0-9a-f]{6}$' then lower(secondary_color)
         else null
       end
 where primary_color is not null
    or secondary_color is not null;

-- 2) Même contrainte que la table `organizations` du Socle : le miroir ne peut
--    pas porter ce que sa source refuse.
alter table public.organizations drop constraint if exists organizations_branding_colors_hex;
alter table public.organizations add constraint organizations_branding_colors_hex check (
  (primary_color is null or primary_color ~ '^#[0-9a-f]{6}$')
  and (secondary_color is null or secondary_color ~ '^#[0-9a-f]{6}$')
);

-- 3) Plus aucun client n'écrit ces deux colonnes.
--
--    ⚠️ `revoke update (colonne)` est SANS EFFET tant que le rôle détient
--    l'UPDATE de table — et `anon` comme `authenticated` le détiennent
--    (grants par défaut de Supabase). Il faut donc retirer le privilège global,
--    puis le reposer colonne par colonne, les deux couleurs exclues.
--    Le reste de la ligne (coordonnées, gabarit de réponse, rétention,
--    rattachement au référentiel) continue de s'éditer comme avant.
--
--    `anon` est traité comme `authenticated` pour ne rien changer d'autre que
--    les couleurs : son privilège est de toute façon inerte, la policy
--    `org_admin_update` exigeant `is_admin_of(id)`.
revoke update on public.organizations from anon, authenticated;

grant update (
  id,
  name,
  slug,
  metadata,
  status,
  created_at,
  updated_at,
  logo_url,
  multiple_imap,
  reply_template_storage_key,
  reply_template_data,
  reply_template_html,
  reply_template_design,
  address_street,
  address_complement,
  address_postal_code,
  address_city,
  phone,
  website,
  contact_email,
  courier_retention_days,
  socle_org_id
) on public.organizations to anon, authenticated;

comment on column public.organizations.primary_color is
  'Charte graphique : couleur principale (#rrggbb), MIROIR du referentiel — ecrite par sync-socle-referentiel (GET /v1/organizations/{tenant}/branding, heritage resolu cote Socle). Aucune saisie dans Clara.';
comment on column public.organizations.secondary_color is
  'Charte graphique : couleur secondaire (#rrggbb), MIROIR du referentiel — voir primary_color.';
