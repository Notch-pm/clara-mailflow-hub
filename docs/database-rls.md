# Clara — RLS & fonctions de sécurité

> Source de vérité extraite du remote Supabase le 2026-05-22.
> Dernière mise à jour : 2026-07-12 (migration `20260712090000_rls_consolidation_advisors`).
> À mettre à jour après toute migration qui touche aux policies ou aux fonctions.

## 🚨 Sécurité — action requise

**`trigger_fetch_inbound_emails`** contient une clé JWT anon hardcodée en clair dans le corps de la fonction SQL (visible dans `pg_proc`). Cette clé est publique par nature, mais sa présence dans le code source est un anti-pattern : toute personne ayant accès au schéma peut la lire.

**Corrigé** dans la migration `20260522160000` : les headers `Authorization` et `apikey` ont été supprimés. La fonction n'utilise désormais que `x-cron-secret`, comme `trigger_arpege_sync`.

## Fonctions de sécurité (SECURITY DEFINER)

| Fonction | Signature | Rôle |
|---|---|---|
| `is_superadmin` | `(uuid) → bool` | Vérifie `public.users.is_superadmin = true` pour l'uid donné |
| `is_admin_of` | `(uuid) → bool` | `is_superadmin(auth.uid()) OR` membre org avec rôle `admin`/`administrateur` |
| `is_member_of` | `(uuid) → bool` | `is_superadmin(auth.uid()) OR` membre actif de l'org |

**Règles d'or** :
- toute nouvelle policy utilise `is_member_of` ou `is_admin_of` — jamais un `EXISTS` inline sur `organization_users`, jamais `x-org-id` en dur ;
- jamais `auth.uid()` / `auth.role()` / `current_setting()` nus dans une policy : toujours wrappés `(select auth.uid())` (advisor `auth_rls_initplan`) — inutile pour les helpers, qui les encapsulent déjà ;
- une seule policy permissive par (table, rôle, action) (advisor `multiple_permissive_policies`) : `is_member_of`/`is_admin_of` incluent le superadmin, ne pas empiler de policy superadmin en plus ;
- les policies `service_role_full` sont déclarées `TO service_role` (jamais sans `TO`, sinon elles s'évaluent aussi pour `authenticated`).

### Trigger anti-escalade
`users_prevent_superadmin_escalation` — bloque tout `UPDATE SET is_superadmin` si `auth.uid()` n'est pas superadmin. En contexte migration (`auth.uid() = NULL`), il faut désactiver/réactiver le trigger autour de l'UPDATE :
```sql
ALTER TABLE public.users DISABLE TRIGGER users_prevent_superadmin_escalation;
UPDATE public.users SET is_superadmin = true WHERE email = '...';
ALTER TABLE public.users ENABLE TRIGGER users_prevent_superadmin_escalation;
```

---

## Modèle de policy standard

Toutes les tables métier suivent ce pattern à 5 policies :

| Policy | CMD | Condition |
|---|---|---|
| `auth_select` | SELECT | `is_member_of(organization_id)` |
| `auth_insert` | INSERT | `is_member_of(organization_id)` |
| `auth_update` | UPDATE | `is_member_of(organization_id)` |
| `auth_delete` | DELETE | `is_member_of(organization_id)` |
| `service_role_full` | ALL | `true` (edge functions) |

Pour les tables en écriture admin seulement, `auth_insert/update/delete` utilisent `is_admin_of` à la place.

---

## Policies par table

### Tables métier courrier (pattern member standard)
`couriers`, `courier_analyses`, `courier_document_extracts`, `courier_documents`,
`courier_events`, `courier_links`, `courier_notes`, `courier_participants`,
`courier_sequences`, `roles`, `service_signatories`, `action_tickets`

→ Toutes : `is_member_of(organization_id)` sur les 4 ops + `service_role_full`.

### Tables admin-only

| Table | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `courier_tags` | `is_member_of` | `is_admin_of` |
| `procedures` | `is_member_of` | `is_admin_of` |
| `services` | `is_member_of` | `is_admin_of` |
| `workflows` | `is_member_of` | `is_admin_of` |
| `workflow_states` | `is_member_of` | `is_admin_of` |
| `workflow_transitions` | `is_member_of` | `is_admin_of` |
| `organization_integrations` | `is_admin_of` (ALL) | `is_admin_of` |
| `smtp_settings` | `is_admin_of` (ALL) | `is_admin_of` |

### Tables spéciales

#### `organizations`
| Policy | CMD | Condition |
|---|---|---|
| `org_select` | SELECT | `is_member_of(id)` |
| `org_admin_update` | UPDATE | `is_admin_of(id)` |
| `superadmin_insert_orgs` | INSERT | `is_superadmin((select auth.uid()))` |
| `superadmin_delete_orgs` | DELETE | `is_superadmin((select auth.uid()))` |

#### `organization_users`
| Policy | CMD | Condition |
|---|---|---|
| `org_users_select` | SELECT | `user_id = (select auth.uid()) OR is_admin_of(organization_id)` |
| `admins_insert_members` | INSERT | `is_admin_of(organization_id)` |
| `admins_update_members` | UPDATE | `is_admin_of(organization_id)` |
| `admins_delete_members` | DELETE | `is_admin_of(organization_id)` |
| `service_role_full` | ALL | `true` (`TO service_role`) |

#### `imap_settings`
| Policy | CMD | Condition |
|---|---|---|
| `imap_admin` | ALL | `is_admin_of(organization_id)` |
| `service_role_full_imap` | ALL | `true` (`TO service_role`) |

#### `smtp_settings`
| Policy | CMD | Condition |
|---|---|---|
| `smtp_admin` | ALL | `is_admin_of(organization_id)` |
| `service_role_full_smtp` | ALL | `true` (`TO service_role`) |

#### `service_members` (table gelée, legacy Socle)
| Policy | CMD | Condition |
|---|---|---|
| `service_members_select` | SELECT | `is_member_of(organization_id)` |
| `service_members_insert` | INSERT | `is_admin_of(organization_id)` |
| `service_members_delete` | DELETE | `is_admin_of(organization_id)` |

#### `notifications`
| Policy | CMD | Condition |
|---|---|---|
| `notifications_select_own` | SELECT | `user_id = (select auth.uid())` |
| `notifications_update_own` | UPDATE | `user_id = (select auth.uid())` |
| `notifications_delete_own` | DELETE | `user_id = (select auth.uid())` |

#### `users`
Pas d'`organization_id` sur cette table → policies spécifiques (une par action) :

| Policy | CMD | Condition |
|---|---|---|
| `users_select` | SELECT | soi-même, superadmin, ou membre d'une org partagée (`EXISTS` sur `organization_users`, soumis à sa RLS : un membre voit ses collègues via un admin uniquement) |
| `users_insert` | INSERT | superadmin, ou header `x-org-id` présent **et** `is_superadmin = false` |
| `users_update` | UPDATE | soi-même, superadmin, ou admin d'une org du user cible ; `WITH CHECK` interdit `is_superadmin = true` aux non-superadmins (en plus du trigger) |
| `service_role_full_users` | ALL | `true` (`TO service_role`) |

#### `ai_usage_quotas`
| Policy | CMD | Condition |
|---|---|---|
| `auth_select` | SELECT | `is_member_of(organization_id)` |
| `superadmin_insert/update/delete` | INSERT/UPDATE/DELETE | `is_superadmin((select auth.uid()))` (les lignes globales `organization_id NULL` restent superadmin-only) |
| `service_role_full` | ALL | `true` (`TO service_role`) |

---

## Anomalies corrigées (migration 20260522150000)

Les 5 anomalies ci-dessous ont été corrigées :
- `organization_users.auth_*` (legacy x-org-id) → supprimées
- `service_members.*` → `is_member_of` / `is_admin_of`
- `imap_settings.org_admin_*` → `is_admin_of`
- `organization_integrations.superadmin_all_integrations` → supprimée (redondante)
- `organizations.*` → `is_superadmin(auth.uid())`

## Consolidation advisors (migration 20260712090000)

Résout les 32 lints `auth_rls_initplan` et les 29 `multiple_permissive_policies` :
- 8 policies `service_role_full` déclarées sans `TO` (donc évaluées aussi pour `authenticated`) recréées `TO service_role` : `portal_form_submissions`, `portal_forms`, `socle_*` ;
- `auth.uid()` / `current_setting()` wrappés `(select ...)` partout où ils restaient nus ;
- policies superadmin redondantes supprimées (`organization_users.superadmin_all`, `smtp_settings.superadmin_all_smtp` — les helpers incluent le superadmin) ;
- fusion par action sur `users`, `organizations`, `organization_users`, `ai_usage_quotas` ;
- `courier_relations` normalisée sur le pattern standard (dernier scoping x-org-id supprimé) ;
- durcissements au passage : les branches x-org-id de `users` (`org_members_select`/`org_members_update`) ne vérifiaient pas l'appartenance du demandeur à l'org du header (énumération/écriture cross-org) → remplacées par « admin d'une org du user cible » ; l'INSERT `users` n'autorise plus `is_superadmin = true` pour un non-superadmin.

---

---

## Inventaire des fonctions public.*

| Fonction | Type | Description |
|---|---|---|
| `is_superadmin(uuid)` | SECURITY DEFINER, STABLE | Vérifie `users.is_superadmin = true` pour l'uid donné |
| `is_admin_of(uuid)` | SECURITY DEFINER, STABLE | `is_superadmin OR` membre avec rôle `admin`/`administrateur` |
| `is_member_of(uuid)` | SECURITY DEFINER, STABLE | `is_superadmin OR` membre actif |
| `current_user_orgs()` | — | Retourne les `organization_id` de l'utilisateur courant |
| `set_updated_at()` | trigger | Met `updated_at = now()` avant UPDATE |
| `prevent_superadmin_escalation()` | trigger SECURITY DEFINER | Bloque le changement de `is_superadmin` si non-superadmin |
| `rls_auto_enable()` | event trigger | Active RLS automatiquement sur toute nouvelle table `public.*` |
| `fn_create_courier_notifications()` | trigger | Crée une notification `new_courier` pour tous les membres actifs de l'org à chaque INSERT de courrier inbound |
| `action_tickets_prevent_courier_change()` | trigger | Empêche la modification du `courier_id` d'un ticket |
| `get_cron_secret()` | SECURITY DEFINER | Lit `cron_secret` depuis `vault.decrypted_secrets` |
| `trigger_arpege_sync()` | SECURITY DEFINER | HTTP POST vers `sync-arpege-services` via `pg_net`, authentifié par `x-cron-secret` |
| `trigger_fetch_inbound_emails()` | SECURITY DEFINER | HTTP POST vers `fetch-inbound-emails` via `pg_net`, authentifié par `x-cron-secret` |
| `search_couriers(...)` | STABLE | Recherche full-text multi-champs avec filtres (direction, état, service, date, tags) |
| `stats_inbound_by_month(...)` | STABLE | Courriers entrants agrégés par mois |
| `stats_inbound_by_day(...)` | STABLE | Courriers entrants des 30 derniers jours par jour |
| `stats_by_channel(...)` | STABLE | Répartition des entrants par canal |
| `stats_by_service(...)` | STABLE | Répartition par service (inbound ou outbound) |
| `stats_replies_by_month(...)` | STABLE | Réponses envoyées par mois (`outbound` avec `parent_courier_id`) |
| `stats_tag_evolution(...)` | STABLE | Évolution mensuelle des tags sur les courriers entrants |
| `stats_processing_times(...)` | STABLE | Délais moyens de traitement par service (via `courier_events`) |

---

## Superadmins déclarés

| Email | `is_superadmin` |
|---|---|
| `jacquotlaurent@ik.me` | `true` |
| `jacquotlaurent@gmail.com` | `true` |
