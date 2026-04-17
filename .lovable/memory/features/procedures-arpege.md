---
name: Démarches & sync Arpège
description: Table procedures, page paramètres Démarches, sync nocturne Arpège via pg_cron + CRON_SECRET
type: feature
---

# Démarches administratives

## Table `procedures`
- Multi-tenant via `organization_id` (RLS x-org-id, écriture admin uniquement)
- Champs : `name`, `description`, `icon` (URL ou nom lucide), `color`, `external_reference_id`, `external_source` (`arpege`), `is_displayed`, `display_order`
- Index unique partiel `(organization_id, external_source, external_reference_id)` pour upsert depuis Arpège

## UI
- `src/pages/ProceduresSettings.tsx` : CRUD, toggle visibilité, badge "Arpège" sur démarches importées
- Accessible via tuile "Démarches" dans `SettingsPage.tsx` et `OrgSettings.tsx`
- Service : `src/services/procedureService.ts`

## Sync Arpège
- Edge function `sync-arpege-services` upsert dans `procedures` (matching par `external_reference_id`)
- Auth multi-mode : service role JWT, admin user, ou header `x-cron-secret` (env var `CRON_SECRET`)
- Bouton manuel "Récupérer les démarches" dans `OrgIntegrations.tsx`

## Cron nocturne
- Tâche `pg_cron` : `sync-arpege-procedures-nightly` à `0 2 * * *` (02:00 UTC)
- Fonction SQL `public.trigger_arpege_sync()` lit le secret `cron_secret` depuis `vault.decrypted_secrets` et POST l'edge function
- **Setup requis** : insérer le secret dans le Vault avec la même valeur que la variable d'env `CRON_SECRET` :
  ```sql
  SELECT vault.create_secret('VOTRE_VALEUR_CRON_SECRET', 'cron_secret');
  ```
- Champs Arpège exclus volontairement (vs GFA-Ariane) : sites, durée, priorité, ordre kiosque, traduction, sans rendez-vous
