# Sécurité

## Modèle d'accès

- **Auth** : Supabase Auth (email/password, magic link, reset). Pas de SSO actuellement.
- **Multi-tenant** : isolation forte par `organization_id`. Une fuite cross-org est une régression critique.
- **Rôles** :
  - `users.is_superadmin` (booléen, global) — accès `/superadmin/*`, bypass des filtres org via helpers `SECURITY DEFINER`.
  - `memberships.role` : `admin` | `member` au sein d'une org. `admin` peut gérer users, intégrations, workflows, modèles.

## RLS

Toutes les tables métier ont RLS activée (cf `docs/data-model.md`). Policies par commande, rôle `authenticated`. Le header `x-org-id` est injecté côté client par le fetch custom — il identifie l'org **active** de la session, mais la sécurité finale repose sur les policies + les helpers `SECURITY DEFINER` (`is_member_of`, `is_admin_of`).

⚠️ Le header `x-org-id` seul ne suffit pas : un user malveillant peut le forger. Les policies vérifient **toujours** via `is_member_of(...)` que `auth.uid()` appartient bien à l'org demandée.

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
- `LOVABLE_API_KEY` — Lovable AI Gateway (analyse + draft).
- `RESEND_API_KEY` — emails transactionnels (invite, reset).
- `CRON_SECRET` — header `x-cron-secret` pour pg_cron → edge functions. Doit aussi être inséré dans `vault.decrypted_secrets` (key = `cron_secret`).
- `ARPEGE_*` — credentials API Arpège (URL, client_id, secret).

## Risques acceptés / comportements intentionnels

- **`user-avatars` bucket public** : assumé, contenu non sensible.
- **Helpers `SECURITY DEFINER`** exposés (`is_member_of`, `is_admin_of`, `is_superadmin`, `has_role`, `current_user_orgs`, `set_updated_at`) : nécessaires aux policies, anonymous n'a rien à lire.
- **Realtime channels** : scoping configuré côté Dashboard Supabase (Realtime Policies), RLS sur `realtime.messages` filtre par `user_id`.
- **Leaked password protection** : à activer dans Supabase Dashboard → Auth → Policies (non scriptable par migration).

## Checklist avant de merger une feature

- [ ] Toute nouvelle table a RLS activée + policies par commande pour `authenticated`.
- [ ] Tous les `.from(...)` côté client filtrent par `organization_id`.
- [ ] Toute nouvelle edge function vérifie l'auth ET l'org cible.
- [ ] Aucun secret en dur ni dans les logs.
- [ ] Pas de rôle stocké hors de `memberships` / `users.is_superadmin`.
- [ ] Si nouveau bucket : RLS scoped par org (sauf justification documentée).
