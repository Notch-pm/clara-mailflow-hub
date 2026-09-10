# Spec — Garde serveur de validation des transitions de workflow

> **Statut : spécifié, à implémenter.** Date : 2026-07-23.
> Cadré via `/spec` (analyse métier + architecture). Aucun code écrit à ce stade.
> Contexte : prérequis #2 du plan de tests QA (validité serveur des transitions).

## 1. Problème

La transition d'état d'un courrier (ou d'une réponse) est un **simple UPDATE** de `couriers.workflow_state_id` :

- Courrier entrant : `useCourierWorkspace.ts:400` → `updateCourier({ workflow_state_id })` (update générique).
- Réponse : `courierReplyService.ts:205` → `.update({ workflow_state_id })`. Les réponses **sont** des lignes `couriers` (`direction='outbound'`, `parent_courier_id`, workflow `type='reply'`).

**Aucun filet serveur** ne valide la légalité de la transition (vérifié en base) :

- Aucune fonction ne référence `workflow_transitions` ; aucune contrainte `CHECK` hors `check_dates`.
- Les 3 seuls triggers de `couriers` sont `trg_create_courier_notifications`, `trg_mark_courier_notifications_read`, `trigger_set_updated_at` — aucun ne valide.
- La FK `couriers_workflow_state_id_fkey` (**ON DELETE NO ACTION** — un état référencé n'est pas supprimable) garantit seulement que l'état **existe**, pas qu'il soit **atteignable**.
- La RLS `is_editor_of(organization_id)` garde « peut écrire ce courrier », pas « la transition est-elle légale ».

**Threat model** : un éditeur (rôle ≠ consultant) qui parle directement à Supabase (`UPDATE couriers SET workflow_state_id=…`) peut sauter à n'importe quel état valide au sens FK — état d'un autre workflow, d'un autre tenant, ou franchir des étapes. La validation faite aujourd'hui **uniquement côté React** ne protège rien.

## 2. Retour arrière — vérifié, non bloquant

Un retour arrière d'état **est** une `workflow_transitions` de `kind='previous'` :

- `ReplyComposer.tsx:285-291,751` : toutes les transitions offertes (suivante, précédente, autres) proviennent exclusivement des `workflow_transitions` configurées (`from_state_id = état courant`).
- `CourierWorkspacePage.tsx` / `MailboxSidePanel.tsx` : le bouton retour cherche une transition `kind='previous'` parmi celles servies par `useCourierWorkspace`.

Le garde vérifie l'existence d'une transition `(from=OLD, to=NEW)` **sans regarder le `kind`** → il **autorise** tout retour arrière configuré. **Aucune régression, aucun travail de config requis.** (Prod au 2026-07-23 : `kind` ∈ {`next` ×17, `NULL` ×12}, aucune arête `previous` → aucun retour arrière n'est même proposé aujourd'hui.)

## 3. Règles métier — matrice AUTORISÉ / INTERDIT (`OLD → NEW`)

### Workflow de référence W* (le courrier n'a pas de `workflow_id`)

1. Si `NEW.socle_organization_id` renseigné → W* = `socle_organizations.reply_workflow_id` (si `direction='outbound'`) sinon `workflow_id`.
2. Sinon → W* = workflow de `OLD.workflow_state_id`, à défaut de `NEW.workflow_state_id` (amorçage d'un courrier non assigné).

### Matrice

| Cas | Verdict | Raison |
|---|---|---|
| `NEW IS NULL` | **AUTORISÉ** | Désassignation ; couvre `NULL → NULL`. |
| Garde tenant : `workflow_states[NEW].organization_id ≠ courier.organization_id` | **INTERDIT** | Bloque l'état d'un autre tenant (durcissement recommandé par Loïc). |
| `NEW ∈ workflow ≠ W*` | **INTERDIT** | Cœur du garde : état d'un autre workflow. |
| `OLD = NEW` (∈ W*) | **AUTORISÉ** | No-op (placé après le contrôle W*, pour bloquer un état devenu étranger via changement d'org). |
| `NEW.is_final` (OLD ∈ W* ou non) | **AUTORISÉ** | Clôture / cascade : **tout** `is_final` (y compris `initial → final` direct). |
| `OLD ∈ W*` et `EXISTS transition(W*, OLD→NEW)` | **AUTORISÉ** | Successeur légal configuré (kind-agnostique → couvre le retour arrière). |
| `OLD ∈ W*`, `NEW` non-final **sans** transition | **INTERDIT** | Saut d'étape. |
| `OLD ∉ W*` (NULL / obsolète / réassignation) et `NEW.is_initial` | **AUTORISÉ** | Amorçage / reset du nouveau workflow. |
| `OLD ∉ W*` et `NEW` non-initial / non-final | **INTERDIT** | Atterrissage au milieu d'un autre workflow. |

Les réponses (`outbound`) suivent la même matrice, W* via `reply_workflow_id`.

## 4. Décision d'architecture — trigger

**Trigger `BEFORE INSERT OR UPDATE OF workflow_state_id, socle_organization_id` sur `couriers`.**

- **CHECK** : impossible (ne peut pas lire d'autres tables). Rejeté.
- **RPC `apply_transition`** : insuffisante seule — le client fait un UPDATE **direct** autorisé par la RLS (`is_editor_of`), pas une RPC. Une RPC ne ferme le trou que si l'UPDATE direct de la colonne est aussi verrouillé, ce que Postgres ne fait pas par colonne → il faudrait un trigger de toute façon. Rejetée comme mécanisme unique (reste possible plus tard comme sucre de journalisation).
- **Trigger** : fire pour **tout** writer (client direct, edge service_role, cron, migration), **sous** la RLS. Seule option qui ferme le threat model « appel Supabase direct ».

Déclenché aussi sur changement de `socle_organization_id` (sinon un état devenu étranger après réassignation passerait). Un update qui ne touche que `metadata` (envoi, `resetSendMarker`, contenu) ne fire pas — voulu.

## 5. Bypass (service_role + migrations passent, superadmin humain non)

Helper `public.is_transition_guard_bypassed()` → vrai si :

- `request.jwt.claims ->> 'role' = 'service_role'` — couvre **toutes** les edge/cron (IMAP `fetch-inbound-emails`, `send-courier-reply`, worker analyse) **sans modifier une ligne de leur code**. Le claim est posé par PostgREST depuis le JWT vérifié → inforgeable côté client.
- **OU** `current_setting('clara.bypass_transition_guard', true) = 'on'` — posé par une migration de backfill via `SET LOCAL`.

**Superadmin humain : pas de bypass** — son JWT porte `role='authenticated'` (jamais `service_role`), et aucune surface `SET` n'est exposée via PostgREST. La matrice lui donne déjà reset→initial et →final pour débloquer un courrier.

**Conséquence clé de séquencement** : le bypass ne dépendant pas du code edge, la migration SQL peut être déployée **seule**, sans risque de casser l'ingestion IMAP / l'envoi / le cron.

## 6. Plan de migration (idempotent, `apply_migration` — jamais `db push`)

Pré-vol (lire l'objet en base, pas le registre) :
```sql
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='public.couriers'::regclass AND NOT tgisinternal;
SELECT indexname FROM pg_indexes WHERE tablename='workflow_transitions';
```
Migration `<ts>_courier_transition_guard.sql` :
1. `is_transition_guard_bypassed()` — `LANGUAGE sql STABLE`, les deux signaux du §5, grants cohérents.
2. `CREATE INDEX IF NOT EXISTS idx_workflow_transitions_from_to ON workflow_transitions(workflow_id, from_state_id, to_state_id);`
3. `couriers_enforce_transition()` — `plpgsql SECURITY DEFINER SET search_path=public` ; bypass en tête, puis W* (§3) et prédicats (§3, dans l'ordre) ; `RAISE EXCEPTION` avec `ERRCODE` dédié pour un mapping client propre ; `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (moule `fn_mark_courier_notifications_read`).
4. `DROP TRIGGER IF EXISTS … ; CREATE TRIGGER trg_couriers_enforce_transition BEFORE INSERT OR UPDATE OF workflow_state_id, socle_organization_id ON couriers FOR EACH ROW EXECUTE FUNCTION couriers_enforce_transition();`

Post-vérif : re-`SELECT … FROM pg_trigger` + suite d'intégration.
**Ordre de déploiement : SQL seul → (rien côté edge) → tests.** Reseed obligatoire avant `test:integration`.

## 7. Fixtures & tests

Enrichir `scripts/seed-test-env.ts` (+ `TenantFixture` dans `helpers.ts:22-34`) :
- un **état intermédiaire non-final sans transition entrante** (AC-S3) ;
- une **2ᵉ org Socle à workflow distinct WF_B** (aujourd'hui racine et sous-org partagent le même workflow, `seed-test-env.ts:214`) (AC-S4).

Nouveau `src/test-integration/garde-transitions.itest.ts` (moule `droits-roles.itest.ts`) :
- **Serveur (refus)** : AC-S1 état d'un autre workflow · AC-S2 état d'un autre tenant · AC-S3 saut vers intermédiaire sans transition · AC-S4 réassignation atterrissant au milieu · AC-S5 état inexistant (FK).
- **Flux légitimes (OK)** : AC-L1 création→initial · AC-L2 initial→processing→final · AC-L3 initial→final (clôture) · AC-L4 réassignation reset · AC-L5 →NULL · AC-L6 réponse initial→signature→final · AC-L7 courrier non assigné · AC-L8 service_role bypass (⚠️ exige d'injecter un client `service_role` dans le harnais, aujourd'hui anon-only `helpers.ts:45-46`).

## 8. Décisions actées / hors périmètre

- **Bypass** : service_role (claim JWT) + migrations (GUC). Superadmin humain non.
- **Clôture** : tout `is_final` autorisé, pas d'exigence d'atteignabilité.
- **NULL → NEW** : seulement si `NEW.is_initial`.
- **Garde tenant** ajouté (`new_state.org = courier.org`) : recommandé, à entériner.
- **Retour arrière** : compatible (transitions `previous` = successeurs légaux).
- **Hors périmètre** : permissions par transition/rôle ; préconditions de données (`requires_signature` avant `processed`) ; refonte de l'éditeur de workflow ; transitions inter-workflow ; effets de bord métier (SMTP, `instruction_started`).

## 9. Chemins de production à re-tester manuellement après implémentation

`useCourierWorkspace.ts:400` (transition), `:334` (réassignation reset) · `CloseLinkedCouriersDialog.tsx:162` (clôture cascade) · `courierReplyService.ts:205` (transition réponse) · `NewCourierDialog.tsx:254` (création) · import en masse.

## 10. Risques

- Récursion via `updated_at` : nulle (le garde n'écrit rien) ; ajouter `pg_trigger_depth()=0` si un jour il écrit.
- Perf import en masse : service_role court-circuite avant tout lookup ; lookups O(1) indexés.
- Blocage accidentel cron/IMAP/envoi : neutralisé par le bypass claim ; `process-analysis-queue` n'écrit pas `couriers` (vérifié). Un futur chemin cron écrivant des états **en SQL direct** devrait poser le GUC — à documenter.
