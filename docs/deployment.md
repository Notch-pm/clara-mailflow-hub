# Déploiement

Projet Supabase : `aullweizxcjbvtdspjli`. Le frontend est un bundle statique Vite ; le backend tient dans Postgres + les edge functions Deno.

## ⚠️ Le registre des migrations n'est pas fiable

**La base live fait foi, pas `supabase_migrations.schema_migrations`.**

Constaté le 2026-07-18 : `search_couriers` tournait en production avec sa signature à 16 paramètres, et les cinq index de `20260718150000_search_couriers_list_pages.sql` existaient — alors que le registre s'arrêtait à `20260718093953`. Ces migrations avaient été appliquées via `execute_sql` (ou l'éditeur SQL du dashboard), qui n'écrit pas au registre.

Symétriquement, deux fichiers locaux (`20260718090000_action_titre…`, `20260718120000_notifications_insert_policy…`) correspondent à des entrées du registre portant un **horodatage différent** : ils ont été passés par `apply_migration`, qui génère sa propre version.

Conséquences pratiques :

1. **Ne pas utiliser `supabase db push`.** Il se fie au registre et rejouerait des migrations déjà appliquées sous un autre horodatage, sans garantie d'idempotence.
2. **Ne jamais conclure « déjà déployé » depuis `list_migrations`.** Vérifier l'objet lui-même :
   ```sql
   SELECT to_regclass('public.ma_table') IS NOT NULL;
   SELECT pg_get_function_result(p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ma_fonction';
   ```
3. **Écrire des migrations rejouables** : `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP FUNCTION IF EXISTS` avant un `CREATE` qui change le type de retour, `DROP POLICY IF EXISTS` avant `CREATE POLICY`. C'est ce qui rend la dérive rattrapable.

Voir aussi la mémoire d'agent « Lovable git drift » : Lovable a été décommissionné le 2026-07-12, mais le schéma qu'il a poussé reste la référence.

## Pré-vol

Avant toute migration, vérifier ce dont elle dépend — c'est là que les déploiements échouent :

```sql
SELECT
  to_regprocedure('public.is_member_of(uuid)')  IS NOT NULL AS has_is_member_of,
  to_regprocedure('public.get_cron_secret()')   IS NOT NULL AS has_get_cron_secret,
  (SELECT count(*) FROM pg_extension WHERE extname='pg_cron') AS pg_cron,
  (SELECT count(*) FROM pg_extension WHERE extname='pg_net')  AS pg_net,
  (SELECT count(*) FROM vault.decrypted_secrets WHERE name='cron_secret') AS cron_secret;
```

## `config.toml` : le piège des fonctions cron

Une edge function appelée par pg_cron ne reçoit **aucun en-tête `Authorization`**. Sans une entrée `verify_jwt = false` dans `supabase/config.toml`, la plateforme la rejette **avant d'exécuter la moindre ligne** — l'authentification par `x-cron-secret` à l'intérieur de la fonction ne sert alors à rien.

```toml
[functions.ma-fonction-cron]
verify_jwt = false
```

À l'inverse, une fonction appelée par une autre edge function avec `Authorization: Bearer <service_role>` peut garder `verify_jwt` : la clé service_role est un JWT valide.

## Ordre de déploiement

L'ordre général est **SQL → edge functions → frontend**, avec deux nuances :

- Le frontend lit les colonnes des RPC : le publier avant la migration casse les listes.
- **La migration qui planifie un cron passe en dernier**, après le déploiement de la fonction visée — même si son horodatage la place plus tôt. Sinon le cron échoue en boucle jusqu'au déploiement.

```bash
# 1-3, 5 : migrations, via apply_migration (MCP) — pas db push
# 4 : fonctions
bunx supabase functions deploy <nom> --project-ref aullweizxcjbvtdspjli
# 6 : frontend
bun run build
```

### Lot « numérisation » (2026-07-18) — appliqué le 2026-07-19

| # | Action | Pourquoi cet ordre | État |
|---|---|---|---|
| 1 | ~~`20260718150000_search_couriers_list_pages.sql` (rejeu)~~ | **Caduque — ne plus rejouer.** L'étape 1 du lot « tri » (sort_dir), appliquée le 18/07, a porté `search_couriers` à 17 paramètres avec `is_large_email`. Rejouer ce fichier ferait **régresser** la fonction (perte de `p_sort_dir` → toutes les listes en erreur). | Obsolète |
| 2 | `20260719090000_courier_analysis_jobs.sql` | Table + RPC d'enfilement et de réservation | **Appliqué le 2026-07-19** via `apply_migration` (registre : horodatage propre, dérive habituelle) |
| 3 | `20260719100000_imap_scan_inbox.sql` | Colonnes `imap_settings` | **Appliqué le 2026-07-19** (idem) |
| 4 | Déployer `analyze-courier`, `fetch-inbound-emails`, `process-analysis-queue` | Les fonctions lisent les objets créés en 2–3 | **Fait le 2026-07-19** (v53 / v74 / v1, `verify_jwt=false` pris de `config.toml`) |
| 5 | `20260719091000_analysis_queue_cron.sql` | **Hors ordre alphabétique** : planifier avant l'étape 4 produirait un échec toutes les 2 min | **Appliqué le 2026-07-19** ; cron `process-analysis-queue-every-2min` actif |
| 6 | Publier le frontend | Lit `is_large_email` via le RPC | À faire (même publication que l'étape 2 du lot « tri ») |

### Lot « tri des listes »

| # | Action | Pourquoi cet ordre | État |
|---|---|---|---|
| 1 | `20260720090000_search_couriers_sort_dir.sql` | Ajoute `p_sort_dir` et élargit `p_sort_by`. `DROP … IF EXISTS` des trois signatures + `CREATE` : rejeu sûr. | **Appliqué le 2026-07-18** via `apply_migration` — donc inscrit au registre sous SON horodatage, pas celui du fichier (dérive habituelle, cf. plus haut). |
| 2 | Publier le frontend | Les listes envoient `p_sort_dir` ; publié avant la migration, PostgREST rejette l'appel (paramètre inconnu) et **toutes les listes de courriers tombent en erreur**. | À faire |

Vérification : la fonction doit avoir 17 paramètres.

```sql
SELECT pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'search_couriers';
```

Une **seule** ligne doit sortir : deux signatures coexistantes rendraient la
résolution PostgREST ambiguë (`PGRST203`).

## Vérification post-déploiement

```sql
-- La file tourne-t-elle ?
SELECT status, count(*) FROM courier_analysis_jobs GROUP BY status;
-- Jobs bloqués (le worker devrait les reprendre au-delà de 10 min)
SELECT id, courier_id, attempts, last_error, started_at
FROM courier_analysis_jobs WHERE status = 'running' ORDER BY started_at;
-- Le cron est-il planifié ?
SELECT jobname, schedule, active FROM cron.job;
```

Et côté fonctions : `get_logs` sur `edge-function` pour repérer un 401 (secret cron absent du Vault) ou un rejet plateforme (entrée `config.toml` manquante).
