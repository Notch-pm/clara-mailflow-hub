-- Le logo rejoint les couleurs : toute la charte graphique est un miroir.
--
-- `logo_url` était déjà recopié du référentiel depuis le 2026-07-12, mais par
-- `planTenantIdentityUpdate`, qui lit la colonne BRUTE de l'organisation mappée.
-- Une sous-organisation sans logo propre recevait donc `null` alors que la
-- charte de sa collectivité en résout un (« Marie d'Arles » n'affichait aucun
-- logo). Il passe désormais par `GET /v1/organizations/{tenant}/branding`, qui
-- résout l'héritage — comme les deux couleurs.
--
-- Le privilège d'écriture suit : la colonne est retirée du GRANT client, au même
-- titre que `primary_color` / `secondary_color`
-- (cf. `20260913081355_organizations_charte_du_socle.sql`, dont ce fichier
-- reprend la mécanique : un `revoke update (colonne)` seul resterait sans effet
-- si le rôle détenait l'UPDATE de table — il ne l'a plus depuis cette
-- migration, mais on repose la liste complète pour rester rejouable).
--
-- Aucun écran de Clara n'écrivait `logo_url` : ce retrait ne casse rien. La
-- lecture, elle, ne change pas (`AppHeader`, `/superadmin/organisations`).

revoke update on public.organizations from anon, authenticated;

grant update (
  id,
  name,
  slug,
  metadata,
  status,
  created_at,
  updated_at,
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

comment on column public.organizations.logo_url is
  'Charte graphique : logo couleur (URL), MIROIR du referentiel — ecrit par sync-socle-referentiel (GET /v1/organizations/{tenant}/branding, heritage resolu cote Socle). Aucune saisie dans Clara.';
