# Sécurité

## Modèle d'accès

- **Repo GitHub privé** (depuis le 2026-07-12). Ça ne relâche **pas** la règle « aucun secret dans git » : `.env` reste hors suivi, seul `.env.example` (valeurs publiques) est versionné.
- **Auth** : Supabase Auth (email/password, magic link, reset). Pas de SSO actuellement.
- **Multi-tenant** : isolation forte par `organization_id`. Une fuite cross-org est une régression critique.
- **Rôles** :
  - `users.is_superadmin` (booléen, global) — accès `/superadmin/*`, bypass des filtres org via helpers `SECURITY DEFINER`.
  - `organization_users.role` : `admin` | `administrateur` | `member` au sein d'une org. `admin`/`administrateur` peut gérer users, intégrations, workflows, modèles.

## RLS

Toutes les tables métier ont RLS activée (cf `docs/data-model.md`). Policies par commande, rôle `authenticated`. Le header `x-org-id` est injecté côté client par le fetch custom pour identifier l'org **active** auprès des edge functions qui en ont besoin, mais les policies RLS ne s'appuient pas sur ce header : la sécurité finale repose sur les helpers `SECURITY DEFINER` (`is_member_of`, `is_admin_of`).

⚠️ Le header `x-org-id` seul ne suffit jamais : un user malveillant peut le forger. Toute edge function qui le lit doit revérifier côté serveur que `auth.uid()` appartient bien à l'org demandée, et les policies doivent continuer à passer par `is_member_of(...)` / `is_admin_of(...)`.

## Garde-fous DB

- **Trigger `prevent_superadmin_escalation`** sur `public.users` : empêche un user d'updater son propre `is_superadmin` à `true`.
- **Policy `users_update_own`** : `WITH CHECK (id = auth.uid() AND is_superadmin = false)` — ceinture + bretelles.
- **Notifications** : policies scoppées au rôle `authenticated` + `user_id = auth.uid()`.

## Storage

| Bucket | Public | Règle |
|---|---|---|
| `clara-documents` | Non | `is_member_of(storage.foldername(name)[1])` — premier segment du path = `organization_id`. |
| `signatures` | Non | Idem. |
| `user-avatars` | **Oui** | Public **intentionnellement** (sert d'URL d'avatar directe). Ne contient pas de données sensibles. |

Pour servir un document privé : passer par l'edge function `storage-documents` qui vérifie l'accès et renvoie un signed URL.

## Edge functions

- `send-password-reset` : vérifie que la cible appartient à une org commune avec l'appelant (ou que l'appelant est superadmin).
- `invite-user` : exige `admin` de l'org cible.
- `sync-arpege-*` / `test-arpege-connection` : exigent admin de l'`organization_id` cible spécifiquement (ou service role, ou `x-cron-secret` pour le cron).
- Toutes : vérifient l'auth **avant** toute opération.

## Secrets (à configurer côté Supabase / Lovable Cloud)

- `SUPABASE_SERVICE_ROLE_KEY` — interne, jamais côté client.
- `SOCLE_API_KEY` — **clé plateforme unique Socle↔Clara**, scopes `read` + `contacts` + `smtp` +
  **`ai`**, avec une *application imputable* (`clara`) côté Socle. ⚠️ **Aucune clé de fournisseur
  LLM n'existe plus côté Clara** depuis le 2026-08-29 (`MISTRAL_API_KEY` et
  `MISTRAL_*_AGENT_ID` retirés des secrets) : le Socle détient la clé, et une application
  compromise ne la compromet plus. C'est le premier gain de la centralisation, avant même le
  budget unique.
- `SOCLE_API_URL` — base des edge functions du Socle ; l'URL du guichet IA en est dérivée
  (`public-api` → `ai-api`). `SOCLE_AI_API_URL` la surcharge si besoin.
- `RESEND_API_KEY` — emails transactionnels (invite, reset).
- `CRON_SECRET` — header `x-cron-secret` pour pg_cron → edge functions. Doit aussi être inséré dans `vault.decrypted_secrets` (key = `cron_secret`).
- `ARPEGE_*` — credentials API Arpège (URL, client_id, secret).

## Risques acceptés / comportements intentionnels

- **`user-avatars` bucket public** : assumé, contenu non sensible (le listing du bucket est possible — advisor 0025 accepté).
- **Helpers `SECURITY DEFINER`** exposés (`is_member_of`, `is_admin_of`, `is_superadmin`, `has_role`, `current_user_orgs`, `set_updated_at`) : nécessaires aux policies, anonymous n'a rien à lire.
- **`search_couriers`** : SECURITY DEFINER exposée à `authenticated` (voulu — garde `is_member_of` interne) ; EXECUTE révoqué pour `PUBLIC`/`anon` (migration `20260711210000`). ⚠️ **À chaque re-création de la fonction, re-révoquer PUBLIC** : `CREATE FUNCTION` re-grante EXECUTE à PUBLIC par défaut.
- ~~**postgis** (`spatial_ref_sys` sans RLS, `st_estimatedextent` SECURITY DEFINER exécutable)~~ — **résolu le 2026-07-21** par `DROP EXTENSION postgis CASCADE` (`20260721090000_drop_postgis.sql`). Retrait total plutôt que risque accepté : plus aucune table métier ne portait de géométrie depuis le démontage des quartiers (2026-07-16), et rien dans le code n'appelait de fonction PostGIS. Cinq advisors éteints d'un coup (RLS `spatial_ref_sys`, extension dans `public`, trois signatures `st_estimatedextent`). ⚠️ **Le découpage des quartiers vit dans le Socle**, qui porte l'extension PostGIS et la colonne `quartiers.geom` (`geometry`) — vérifié le 2026-08-30. Clara affiche des quartiers, elle n'en calcule aucun : c'est la frontière qui rend ce retrait possible, pas un arbitrage de risque. Réinstaller PostGIS ici voudrait dire que cette frontière a bougé — à instruire, pas à faire par réflexe.
- **Colonnes en lecture seule côté client** : `organizations.logo_url` / `primary_color` / `secondary_color` (charte graphique, miroir du Socle depuis le 2026-09-13). La policy `org_admin_update` porte sur la LIGNE entière : un admin d'org pouvait donc réécrire le miroir par PostgREST, même sans écran de saisie. Le `GRANT UPDATE` de table a été retiré à `anon`/`authenticated` puis reposé **colonne par colonne**, les deux couleurs exclues (`20260913081355_organizations_charte_du_socle.sql` pour les couleurs, `20260913082647_organizations_logo_du_socle.sql` pour le logo). ⚠️ **Toute colonne ajoutée à `organizations` doit être ajoutée à ce GRANT** si le client doit l'écrire — sinon l'écriture échoue en 403, sans rapport apparent avec la RLS. ⚠️ `revoke update (colonne)` seul est **sans effet** tant que le rôle détient l'UPDATE de table.
- **Realtime channels** : scoping configuré côté Dashboard Supabase (Realtime Policies), RLS sur `realtime.messages` filtre par `user_id`.
- **Leaked password protection** : à activer dans Supabase Dashboard → Auth → Policies (non scriptable par migration).

## Rotation des secrets

- **`cron_secret`** (Vault) : tourné le 2026-07-11 (l'ancienne valeur figurait en clair dans la migration `20260417133227` — ne JAMAIS mettre une valeur de secret dans une migration). Procédure : `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='cron_secret'), '<nouvelle valeur>');` puis vérifier ancien → 401 / nouveau → 200 sur une edge function cron.
- **Mots de passe IMAP/SMTP en clair en DB** : dette P1 connue (chantier chiffrement, cf. `docs/technical-debt.md`). Atténuation posée le 2026-08-23 pour le SMTP : `smtp_settings` n'est plus exposée au client (aucun `GRANT` pour `anon`/`authenticated`, plus de policy `authenticated`), le mot de passe vient du Socle et ne traverse plus que `sync-socle-referentiel` → RPC de service. Il ne doit apparaître dans aucun journal, compteur ou message d'erreur. `imap_settings`, elle, reste lisible par les admins d'org.

## Checklist avant de merger une feature

- [ ] Toute nouvelle table a RLS activée + policies par commande pour `authenticated`.
- [ ] Tous les `.from(...)` côté client filtrent par `organization_id`.
- [ ] Toute nouvelle edge function vérifie l'auth ET l'org cible.
- [ ] Aucun secret en dur ni dans les logs.
- [ ] Pas de rôle stocké hors de `organization_users` / `users.is_superadmin`.
- [ ] Si nouveau bucket : RLS scoped par org (sauf justification documentée).
