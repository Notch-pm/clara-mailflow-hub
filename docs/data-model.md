# Modèle de données

## Principes

- **PostgreSQL** managé par Supabase. Types générés dans `src/integrations/supabase/types.ts` (ne **jamais** éditer à la main).
- **Multi-tenant** : presque toutes les tables ont une colonne `organization_id uuid not null references organizations(id)`.
- **RLS activée partout**. Pas d'accès anonyme aux données métier.

## Pattern RLS — header `x-org-id`

Toutes les tables métier utilisent des policies par commande (SELECT/INSERT/UPDATE/DELETE) pour le rôle `authenticated` :

```sql
-- SELECT / UPDATE USING / DELETE USING
USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid))

-- INSERT WITH CHECK / UPDATE WITH CHECK
WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid))
```

⚠️ Utiliser `request.headers` (JSON) — **pas** `request.header.x-org-id` (singulier, instable en PostgREST récent).

### Injection du header côté client

- `src/integrations/supabase/client.ts` expose `setOrganizationId(orgId)`.
- Un `fetch` custom du client Supabase injecte `x-org-id` sur **chaque** requête.
- `AuthContext` appelle `setOrganizationId(...)` dès que le `membership` est résolu.

### Edge functions

Les edge functions doivent **ré-affirmer** l'org de l'appelant côté serveur (ne pas se fier au header). Pattern : lire le JWT, charger le membership, vérifier l'`organization_id` cible.

## Tables principales

### Identité & tenants
- `organizations` — tenants. RLS sur `id` (pas `organization_id`).
- `users` — profils étendus (mirroir de `auth.users`), porte `is_superadmin boolean`. Trigger `prevent_superadmin_escalation` empêche un user de se promouvoir.
- `memberships(user_id, organization_id, role)` — rôle = `admin` | `member`. Source unique des permissions d'org.

### Courriers (cœur métier)
- `couriers` — table centrale. Champs clés : `direction` (`inbound`/`outbound`), `channel` (`email`/`mail`/`form`/...), `subject`, `body_html`, `workflow_state_id`, `assigned_service`, `parent_courier_id` (réponses), `sent_at`, `received_at`, `metadata jsonb`.
- `courier_participants(courier_id, role, name, email, ...)` — expéditeurs/destinataires/copie.
- `courier_documents(courier_id, storage_path, mime_type, ...)` — pièces jointes (bucket `clara-documents`).
- `courier_events(courier_id, type, payload jsonb)` — journal d'audit.
- `courier_links(courier_id, target_courier_id, link_type)` — relations entre courriers.
- `courier_notes(courier_id, author_id, body)` — notes internes.
- `courier_tags` + `tags` — tagging libre.
- `courier_sequences(organization_id, direction, year, last_number)` — numérotation annuelle.

### Analyse IA (cache)
- `courier_document_extracts(courier_id, document_id, text, model, tokens_used)` — résultats OCR.
- `courier_analyses(courier_id, summary, intents text[], sentiment, suggested_actions text[], model, tokens_used)` — analyse LLM par courrier.

### Workflows
- `workflows(id, organization_id, name, kind)` — `kind` distingue workflow principal vs workflow de réponse.
- `workflow_states(workflow_id, name, category, is_initial)` — `category` ∈ `draft`/`in_progress`/`processed`/`archived`.
- `workflow_transitions(workflow_id, from_state_id, to_state_id, label)`.

### Référentiels d'org
- `usagers` — annuaire des personnes connues (auto-rempli depuis participants).
- `signatories` + bucket `signatures` — signataires avec image de signature.
- `templates` — modèles de réponses (Handlebars).
- `org_services` — services internes (ex. "Urbanisme", "État civil") pour assignation et IMAP par service.
- `procedures` — démarches administratives (sync nocturne Arpège). Cf `docs/features.md#démarches-arpège`.
- `imap_settings` / `smtp_settings` — config email par org (ou par service).

### Notifications & actions
- `notifications(user_id, type, payload, read_at)` — RLS scoped `authenticated` + `user_id = auth.uid()`.
- `action_tickets` — tâches dérivées d'un courrier.

## Storage buckets

| Bucket | Public ? | RLS |
|---|---|---|
| `clara-documents` | Non | `is_member_of(storage.foldername(name)[1])` — premier segment = `organization_id`. |
| `signatures` | Non | Idem, scoped org. |
| `user-avatars` | **Oui** | Public intentionnel (URL directe). |

## Fonctions SQL (helpers RLS — `SECURITY DEFINER`)

- `is_member_of(org_id uuid) returns boolean`
- `is_admin_of(org_id uuid) returns boolean`
- `is_superadmin() returns boolean`
- `has_role(user_id uuid, role app_role) returns boolean`
- `current_user_orgs() returns setof uuid`
- `prevent_superadmin_escalation()` (trigger)
- `trigger_arpege_sync()` (appelée par pg_cron)

Toutes en `SECURITY DEFINER` avec `search_path = public` figé.

## Conventions

- Toute nouvelle table métier : `organization_id` + RLS x-org-id + index sur `(organization_id, ...)` + `created_at`/`updated_at` + trigger `set_updated_at`.
- Migrations versionnées dans `supabase/migrations/<timestamp>_<slug>.sql`.
- Énumérations Postgres pour les valeurs fermées (`courier_direction`, `courier_channel`, `participant_role`, `document_type`, `workflow_category`, `sync_status`, `app_role`).
