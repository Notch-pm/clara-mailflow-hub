# Clara — RLS & fonctions de sécurité

> Source de vérité extraite du remote Supabase le 2026-05-22.
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

**Règle d'or** : toute nouvelle policy doit utiliser `is_member_of` ou `is_admin_of` — jamais un `EXISTS` inline sur `organization_users`, jamais `x-org-id` en dur.

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
| `superadmin_select_orgs` | SELECT | `EXISTS(users WHERE is_superadmin)` |
| `superadmin_insert_orgs` | INSERT | `EXISTS(users WHERE is_superadmin)` |
| `superadmin_update_orgs` | UPDATE | `EXISTS(users WHERE is_superadmin)` |
| `superadmin_delete_orgs` | DELETE | `EXISTS(users WHERE is_superadmin)` |
| `users_read_own_org` | SELECT | membre via `organization_users` |
| `org_admin_update_own_org` | UPDATE | admin via `organization_users` |

#### `organization_users`
| Policy | CMD | Condition |
|---|---|---|
| `superadmin_all` | ALL | `is_superadmin(auth.uid())` |
| `admins_read_org_members` | SELECT | `is_admin_of(organization_id)` |
| `admins_insert_members` | INSERT | `is_admin_of(organization_id)` |
| `admins_update_members` | UPDATE | `is_admin_of(organization_id)` |
| `admins_delete_members` | DELETE | `is_admin_of(organization_id)` |
| `users_read_own_memberships` | SELECT | `user_id = auth.uid()` |
| `auth_select/insert/update/delete` | * | **`x-org-id` header** ⚠️ (legacy) |
| `service_role_full` | ALL | `true` |

#### `imap_settings`
| Policy | CMD | Condition |
|---|---|---|
| `superadmin_all_imap` | ALL | `is_superadmin(auth.uid())` |
| `org_admin_write_imap` | ALL | membre `organization_users` avec rôle admin ⚠️ (inline, pas `is_admin_of`) |
| `org_admin_read_imap` | SELECT | idem ⚠️ |
| `service_role_full_imap` | ALL | `true` |

#### `service_members`
| Policy | CMD | Condition |
|---|---|---|
| `service_members_select` | SELECT | **`x-org-id` header** ⚠️ |
| `service_members_insert` | INSERT | **`x-org-id` header** ⚠️ |
| `service_members_delete` | DELETE | **`x-org-id` header** ⚠️ |

#### `notifications`
| Policy | CMD | Condition |
|---|---|---|
| `notifications_select_own` | SELECT | `user_id = auth.uid()` |
| `notifications_update_own` | UPDATE | `user_id = auth.uid()` |

#### `users`
| Policy | CMD | Condition |
|---|---|---|
| `superadmin_all_users` | ALL | `is_superadmin(auth.uid())` |
| `service_role_full_users` | ALL | `true` |

---

## Anomalies corrigées (migration 20260522150000)

Les 5 anomalies ci-dessous ont été corrigées :
- `organization_users.auth_*` (legacy x-org-id) → supprimées
- `service_members.*` → `is_member_of` / `is_admin_of`
- `imap_settings.org_admin_*` → `is_admin_of`
- `organization_integrations.superadmin_all_integrations` → supprimée (redondante)
- `organizations.*` → `is_superadmin(auth.uid())`

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
