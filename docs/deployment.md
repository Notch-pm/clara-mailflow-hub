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

**Le piège se referme au premier déploiement par la CLI.** Constaté le 2026-08-23 :
`sync-socle-referentiel` tournait depuis des mois sans entrée dans `config.toml` — elle
avait été déployée à la main avec `--no-verify-jwt`, réglage porté par la fonction
déployée et invisible dans le dépôt. Le premier `bunx supabase functions deploy` sans le
drapeau a réappliqué le défaut (`verify_jwt = true`) et l'appel du cron est reparti en
`401 UNAUTHORIZED_NO_AUTH_HEADER` — sans que rien n'échoue au déploiement. L'entrée est
désormais dans `config.toml`. **Vérifier après chaque déploiement d'une fonction cron** :

```sql
SELECT status_code, left(content, 120)
FROM net._http_response ORDER BY id DESC LIMIT 3;
```

À l'inverse, une fonction appelée par une autre edge function avec `Authorization: Bearer <service_role>` peut garder `verify_jwt` : la clé service_role est un JWT valide.

## Frontend : Cloudflare Workers

**En production, Clara est servie sur <https://clara.edilumen.fr>** — un push sur la branche
connectée est donc une mise en ligne devant les agents, pas un geste de dépôt.

Le bundle Vite est servi comme **assets statiques d'un Worker** (`clara-mailflow-hub`), déployé par
Workers Builds à chaque push de la branche connectée : `bun install --frozen-lockfile`, puis
`bun run build`, puis `npx wrangler deploy`. La configuration tient dans `wrangler.jsonc` :
`assets.directory = ./dist` et `not_found_handling = single-page-application` (React Router en
`BrowserRouter` : toute URL profonde doit renvoyer `index.html`, sinon un rechargement sur
`/courriers/<id>` répond 404).

⚠️ **`wrangler.jsonc` doit exister.** Sans lui, `wrangler deploy` détecte un projet Vite et tente de
réécrire `vite.config.ts` pour y injecter `@cloudflare/vite-plugin` — et échoue sur notre tableau
`plugins` construit avec `.filter(Boolean)` : « Cannot modify Vite config: could not find a valid
plugins array ». Constaté le 2026-09-09 : le build passait, le déploiement tombait là. Ne pas
« corriger » en ajoutant le plugin Cloudflare : le Worker n'a pas de script, il n'y a rien à brancher.

Les variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` sont **figées dans le bundle au
build** : elles doivent être posées dans les variables de build du projet Cloudflare (valeurs
publiques par design, cf. `.env.example`). Absentes, le build passe quand même et l'application
s'ouvre sur une page blanche (`createClient` refuse une URL vide).

Vérification locale, sans compte Cloudflare :

```bash
npx wrangler deploy --dry-run   # valide wrangler.jsonc et le manifeste d'assets
npx wrangler dev                # sert dist/ en local, avec le repli SPA
```

## Ordre de déploiement

> **Le frontend est déployé sur Cloudflare Workers** (assets statiques, Workers Builds) — voir la
> section « Frontend : Cloudflare Workers » ci-dessus. Jusqu'au 2026-09-09, Clara n'existait qu'en
> dépôt git et en exécution locale : les lignes « Publier le frontend » des lots antérieurs étaient
> sans objet à l'époque. L'ORDRE, lui, vaut désormais pour de vrai — et il valait déjà pour le projet
> Supabase `aullweizxcjbvtdspjli` (migrations + edge functions), qui est bien commun et vivant.

L'ordre général est **SQL → edge functions → frontend**, avec deux nuances :

- Le frontend lit les colonnes des RPC : le publier avant la migration casse les listes.
- **La migration qui planifie un cron passe en dernier**, après le déploiement de la fonction visée — même si son horodatage la place plus tôt. Sinon le cron échoue en boucle jusqu'au déploiement.

```bash
# 1-3, 5 : migrations, via apply_migration (MCP) — pas db push
# 4 : fonctions
bunx supabase functions deploy <nom> --project-ref aullweizxcjbvtdspjli
# 6 : frontend — Workers Builds le fait au push (cf. « Frontend : Cloudflare Workers »)
bun run build && npx wrangler deploy --dry-run
```

### Lot « connecteur Iris » (2026-08-23) — appliqué le 2026-08-23

| # | Action | Pourquoi cet ordre | État |
|---|---|---|---|
| 1 | Enregistrer Clara comme source côté Iris (`integration_sources` + `integration_credentials`) | Sans source ni clé, tout appel répond 401 | **Fait** — source `clara` du tenant ACCM, clé `irs_76EIrWD5` (scopes `requests:write` + `requests:read`), **expire le 2027-08-23** |
| 2 | `20260823190000_connecteur_iris.sql` | Colonnes de connexion (`api_key`, `socle_root_org_id`, `last_sync_at`) et de suivi (`action_tickets.iris_*`) | **Appliqué** via `apply_migration` |
| 3 | Poser la connexion du tenant dans `organization_integrations` | La clé brute ne doit transiter ni par un journal ni par un dépôt | **Fait** (écriture directe, valeur jamais affichée) |
| 4 | Déployer `push-iris-request` et `sync-iris-requests` | Lisent les colonnes créées en 2 | **Fait** — `sync-iris-requests` a `verify_jwt = false` dans `config.toml` (cron) ; `push-iris-request` garde la vérification (appelée par le navigateur) |
| 5 | `20260823200000_iris_sync_cron.sql` | **Hors ordre alphabétique** : planifier avant l'étape 4 produirait un échec toutes les nuits | **Appliqué** ; cron `iris-sync-nightly` actif à 03:30 |
| 6 | ~~Publier le frontend~~ | Sans objet (cf. note en tête) | Sans objet |

Vérification : une demande déposée porte sa référence et son statut.

```sql
SELECT iris_reference, iris_status, iris_version, iris_synced_at, iris_last_error
FROM action_tickets WHERE iris_request_id IS NOT NULL;
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'iris-sync-nightly';
```

### Lot « pièces jointes vers Iris » (2026-09-11) — appliqué le 2026-09-11

Constat fondateur : `DEM-2026-000055`, créée depuis un courrier qui portait une pièce, est
arrivée **sans aucune pièce** — le connecteur (2026-08-23) est antérieur au contrat 2.0.0 d'Iris,
qui impose le **dépôt** des fichiers (`POST /v1/uploads`). Brief Iris du 2026-09-19,
`docs/briefs/2026-09-19-clara-pieces-jointes.md` du dépôt Iris.

| # | Action | Pourquoi cet ordre | État |
|---|---|---|---|
| 1 | `20260911170000_iris_pieces_jointes.sql` (`action_tickets.iris_attachments_error`) | La fonction écrit cette colonne au dépôt | **Appliqué** via `apply_migration` |
| 2 | Déployer `push-iris-request` | Dépose les fichiers puis référence les `upload_id` ; écrit la colonne créée en 1 | **Fait** — `bunx supabase functions deploy push-iris-request --project-ref aullweizxcjbvtdspjli` (pas de `--no-verify-jwt` : appelée par le navigateur). `sync-iris-requests` redéployée dans la foulée : son passage à `irisTicketPatch` n'était pas encore en ligne |
| 3 | Publier le frontend | Affiche `iris_attachments_error` sous la référence Iris ; sans lui, une demande incomplète ne le dit qu'au toast | **Fait** — push sur `main` (Workers Builds) |

Vérification (un courrier avec une pièce cochée sur un champ du formulaire, ex. « Demande de
subvention associative ») : la demande porte ses pièces côté Iris, et le journal `[iris]` de la
fonction annonce le nombre déposé.

```sql
SELECT iris_reference, iris_attachments_error FROM action_tickets
WHERE iris_request_id IS NOT NULL ORDER BY created_at DESC LIMIT 5;
```

Côté Iris (lecture) : `request_attachments` non vide pour la demande, et `integration_api_logs`
montre **un `POST /v1/uploads` par fichier** avant le `POST /v1/requests`.

### Lot « serveur d'envoi depuis le Socle » (2026-08-23) — appliqué le 2026-08-23

| # | Action | Pourquoi cet ordre | État |
|---|---|---|---|
| 1 | Scope `smtp` sur la clé Socle de Clara (projet `qhrokbkyxgcvkbpmbmna`) | Sans lui, la route répond `403` et la sync ne produit que des avertissements | **Fait** — `update api_keys set scopes = scopes \|\| array['smtp'] where name = 'Clara — clé plateforme (read+contacts)'` (la clé porte maintenant `read, contacts, smtp` ; son **nom** n'a pas été changé) |
| 2 | `20260823170000_smtp_depuis_socle.sql` | Retire les droits clients, ajoute provenance/fraîcheur, pose les deux RPC de service | **Appliqué** via `apply_migration` (registre : horodatage propre, dérive habituelle) |
| 3 | Déployer `sync-socle-referentiel` | Lit les RPC créées en 2 | **Fait** — ⚠️ a nécessité l'ajout de `[functions.sync-socle-referentiel] verify_jwt = false` dans `config.toml` (cf. piège ci-dessus) |
| 4 | Synchronisation réelle | Remplace la ligne saisie à la main par celle du référentiel | **Fait** — ACCM et Marie d'Arles synchronisés, aucun avertissement |
| 5 | Supprimer la fonction déployée `send-test-email` | Après l'envoi réel de test, pas avant | **Fait** (`bunx supabase functions delete send-test-email`) |
| 6 | ~~Publier le frontend~~ | Sans objet : le frontend n'est publié nulle part (cf. note ci-dessus). L'écran « Emails (SMTP) » disparaît dès le prochain `bun run dev` / `bun run build`. | Sans objet |

Vérification : la ligne ne doit plus être d'origine manuelle.

```sql
SELECT o.name, s.socle_org_id, s.socle_updated_at, s.synced_at
FROM smtp_settings s JOIN organizations o ON o.id = s.organization_id;
-- socle_org_id / synced_at NULL = ligne jamais synchronisée (saisie manuelle héritée)
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

## Bascule vers le guichet IA du Socle (2026-08-29)

⚠️ **CHANTIER À DEUX DÉPÔTS, ET L'ORDRE N'EST PAS NÉGOCIABLE.** Clara appelle deux routes du
guichet qui n'existaient pas dans sa v1 : `POST /v1/ocr` et `response_format: "json"` sur
`POST /v1/completions`. Déployer Clara avant le Socle laisserait l'analyse de courrier en `400`
sur chaque appel — traduit en « erreur interne » pour l'agent, sans indice sur la cause.

**Dans le Socle, d'abord :**

1. Déployer `ai-api` (aucune migration : `ai_usage_events.resource_type` accepte `'ocr'` depuis
   l'origine).
2. Vérifier que le contrat est bien publié — `GET {SOCLE_URL}/functions/v1/ai-api/openapi.json`
   doit lister `/v1/ocr`, et `CompletionRequest` porter `response_format`.
3. Créer (ou compléter) la clé API de Clara : scope **`ai`** en plus de `read` + `contacts` +
   `smtp`, et surtout une **application imputable** (`consumer = "clara"`). Sans elle, le guichet
   refuse tout appel en `403` — une dépense non imputable n'a pas lieu.
4. Poser le plafond mensuel de chaque collectivité côté Socle. **Aucun plafond = illimité** : le
   déploiement progressif ne casse personne, mais personne n'est plafonné non plus.

**Dans Clara, ensuite :**

5. Déployer les edge functions : `analyze-courier`, `draft-reply`, `extract-courier-info`,
   `process-analysis-queue`, et la nouvelle `socle-ai-usage`.
6. Mettre à jour les secrets Supabase :
   - **ajouter** `SOCLE_API_KEY` s'il n'a pas déjà le scope `ai` (c'est la même clé plateforme que
     pour les contacts — il suffit de lui ajouter le scope côté Socle) ;
   - ⚠️ **vérifier que `SOCLE_API_URL` existe** — et ne pas se fier au fait que la synchro du
     référentiel marche. Constaté le 2026-08-29 : le secret n'avait **jamais** été posé, et
     personne ne s'en apercevait parce que `sync-socle-referentiel` a un repli codé en dur
     (`socleBaseUrl()`, ligne 76). `socleAi.ts` n'en a pas : `deriveAiApiBaseUrl` rend la chaîne
     vide plutôt qu'une URL fantaisiste, et `callSocleAi` refuse alors **avant le `fetch`** par un
     `503 not_configured` — « L'assistant IA n'est pas configuré sur cette instance ». Le symptôme
     trompe : le message accuse la configuration du guichet, la clé est hors de cause, et les logs
     du Socle sont **vides** puisque aucun appel n'est parti. Valeur attendue, celle du repli :
     `https://…supabase.co/functions/v1/public-api` (le dernier segment est réécrit en `ai-api`).
     `SOCLE_AI_API_URL` reste facultatif : il ne sert qu'à pointer un autre Socle.
   - **retirer** `MISTRAL_API_KEY`, `MISTRAL_EXTRACTION_AGENT_ID`, `MISTRAL_REDACTION_AGENT_ID` :
     plus aucun code ne les lit, et les laisser entretiendrait l'idée qu'un appel direct reste
     possible. C'est le premier gain de la bascule — la clé du fournisseur n'est plus distribuée.
     ⚠️ **Mais reporter d'abord les deux identifiants d'agent côté Socle**, en secrets
     `MISTRAL_AGENT_EXTRACTION_COURRIER` et `MISTRAL_AGENT_REDACTION_REPONSE` (alias
     `extraction-courrier` et `redaction-reponse`, cf. `Socle/docs/operations.md`). Sans eux,
     `agentIdForAlias` rend `null`, le guichet retombe sur le modèle par défaut, et l'extraction
     structurée se dégrade **silencieusement** : aucune erreur, aucun journal, juste des champs
     moins bons. Les supprimer de Clara avant de les avoir reportés, c'est les perdre.
7. **La migration `20260829140000_retrait_plafond_ia.sql` EN DERNIER**, une fois les fonctions
   déployées et un appel vérifié de bout en bout. Avant, elle supprimerait les RPC dont l'ancien
   code encore en ligne dépend.

   ⚠️ **Elle supprime le journal `ai_usage_events` sans sommation** — là où la migration jumelle
   d'Iris refuse de s'exécuter sur une table non vide. Le garde-fou n'a pas été oublié : il a été
   **levé sciemment** le 2026-08-29, les lignes présentes étant des **essais de recette** dont
   aucune facturation ne dépend. Le script annonce en `NOTICE` le nombre d'événements et de jetons
   détruits — c'est la seule trace qui subsistera, la sortie du déploiement mérite donc d'être
   conservée.

   ⚠️ **Cette décision ne vaut que pour cette base, à cette date.** Rejouer le script sur une base
   restaurée ou dérivée où de la consommation réelle aurait été enregistrée détruirait des pièces
   comptables. Dans ce cas seulement, exporter d'abord :

   ```sql
   COPY (SELECT * FROM public.ai_usage_events) TO STDOUT WITH CSV HEADER;
   ```

   Le journal du Socle ne reprend rien rétroactivement : il commence à la bascule, et c'est assumé.

8. Régénérer `src/integrations/supabase/types.ts` : sans cela le typage annonce trois tables et
   trois RPC qui n'existent plus.

**Vérifications qui valent le détour :**

```sql
-- Le retrait est complet (aucune ligne attendue) :
SELECT to_regclass('public.ai_usage_quotas'), to_regclass('public.ai_usage_counters'),
       to_regclass('public.ai_usage_events');
SELECT jobname FROM cron.job WHERE jobname LIKE '%ai%';
```

Puis, dans l'application : analyser un courrier **avec une pièce jointe scannée** (le seul chemin
qui exerce `/v1/ocr`), et ouvrir Paramètres › Consommation IA — la ventilation par application
doit montrer la ligne `clara`. Un `403` ici signifie une clé sans scope `ai` ou sans application
imputable ; un `503`, un tenant sans `socle_org_id`.

### Ce qui a été appliqué le 2026-08-29

| # | Action | État |
|---|---|---|
| Socle 1–2 | `ai-api` déployé (`--no-verify-jwt`) | **Fait** — l'`openapi.json` en ligne liste `/v1/completions`, `/v1/ocr`, `/v1/usage`, et `CompletionRequest` porte `response_format`. La version qui tournait jusque-là ignorait les deux : Clara aurait pris un `400` sur chaque appel |
| Socle 3 | Clé de Clara avec scope `ai` + `consumer` | **Fait** — clé « **Clara avec IA** » : **plateforme** (`organization_id` NULL), `read, contacts, smtp, ai`, `consumer = clara`. Elle porte désormais tout : guichet IA, référentiel, SMTP, contacts. Une première clé *liée à ACCM* avait été posée puis écartée — voir l'avertissement ci-dessous. Les deux clés remplacées (« Clé ai utilisée par Clara » et « Clara — clé plateforme (read+contacts) ») ont été révoquées le jour même |
| Socle 4 | Plafond mensuel | **Fait** — ACCM, 2 000 000 jetons, actif. Les autres collectivités restent illimitées |
| Clara 5 | `analyze-courier`, `draft-reply`, `extract-courier-info`, `process-analysis-queue`, `socle-ai-usage` déployées | **Fait** (v57 / v28 / v26 / v4 / v1). Le piège `config.toml` ne s'est pas refermé : `process-analysis-queue` est resté en `verify_jwt = false` et son passage suivant a répondu 200 |
| Clara 6 | Secrets | **Fait** — `SOCLE_API_KEY` posé, **`SOCLE_API_URL` créé** (il n'avait jamais existé : c'est la panne du jour, cf. l'étape 6 ci-dessus), les deux identifiants d'agent reportés côté Socle, puis `MISTRAL_API_KEY`, `MISTRAL_EXTRACTION_AGENT_ID` et `MISTRAL_REDACTION_AGENT_ID` retirés. Clara ne détient plus **aucun** secret `MISTRAL_*` — seulement `SOCLE_API_KEY`, `SOCLE_API_URL`, `SOCLE_CONTACTS_API_URL`. La source déployée d'`analyze-courier` ne contient plus aucun appel à `api.mistral.ai` |
| Clara 7 | `20260829140000_retrait_plafond_ia.sql` | **Appliqué** via `apply_migration`. **Volume détruit : 83 événements, 142 936 jetons cumulés** (périodes 2026-06 à 2026-08), plus 1 plafond et 3 compteurs — essais de recette, décision confirmée le jour même. C'est la seule trace qui subsiste. Vérifié ensuite : les trois tables et les trois RPC ont disparu, le job `release-stale-ai-reservations-every-5min` est déprogrammé, les cinq autres crons sont intacts |
| Clara 8 | `src/integrations/supabase/types.ts` régénéré | **Fait** — corrige au passage une dérive plus ancienne : le fichier ignorait onze RPC bien réelles (`claim_analysis_jobs`, `enqueue_courier_analysis`, `sync_smtp_settings_from_socle`, `trigger_iris_sync`…) et déclarait `trigger_arpege_sync`, supprimée en juillet |

⚠️ **`SOCLE_API_KEY` EST PARTAGÉ, ET UNE CLÉ LIÉE RÉTRÉCIT LE PÉRIMÈTRE DE TOUT LE MONDE.**
Le secret ne sert pas qu'au guichet IA : `sync-socle-referentiel` s'en sert pour le référentiel
et le serveur d'envoi de **tous** les tenants, et `socleContactsClient` en fait son repli
contacts. Une clé liée à une organisation ne voit que le sous-arbre de celle-ci — `ai-api`
ignore alors purement et simplement `X-Organization-Id`, et `syncOrganizations` journalise
`socle_org_id … introuvable dans le périmètre de la clé` puis laisse le miroir en l'état,
**sans échouer**. Une clé liée à ACCM aurait donc fait débiter la dépense IA de Marie d'Arles
sur le crédit d'ACCM, et arrêté silencieusement la synchro de 03:00 pour Marie d'Arles, Test 2
et [TEST]. La clé **plateforme** (`organization_id` NULL) évite les deux — c'est pourquoi
l'étape 6 dit « c'est la même clé plateforme que pour les contacts ». Le cas s'est présenté le
2026-08-29 et a été corrigé avant tout appel : la clé liée n'a jamais servi (`last_used_at`
resté nul), « Clara avec IA » l'a remplacée. **Retenir la règle : sur ce secret, une clé liée
n'est jamais le bon choix, quelle que soit la politique de facturation voulue.**

### Recette de bout en bout, 2026-08-29

Vérifiée à la source, dans `ai_usage_events` du Socle — c'est ce jeu de lignes qui fait foi :

| Heure UTC | `feature` | `resource_type` | Réel | Ce que ça prouve |
|---|---|---|---|---|
| 17:54 | `analyse-courrier` | `chat` | 2 984 | La chaîne passe par le guichet, mais les alias d'agent ne résolvent pas encore |
| 17:54 | `analyse-courrier` | **`ocr`** | 404 | `/v1/ocr` exercé pour de vrai — la route qui manquait le matin même |
| 18:14 · 18:17 | `analyse-courrier` | **`agent`** | 3 049 · 3 128 | Les secrets `MISTRAL_AGENT_*` posés côté Socle : les alias résolvent |
| 18:14 · 18:17 | `preremplissage-demarche` | **`agent`** | 2 598 | Idem sur le second point d'appel |

Toutes en `completed`, aucune `failed`. Le passage `chat` → `agent` est le signal à regarder :
c'est `ai-api` qui dit avoir résolu l'alias. Un identifiant d'agent **erroné** sortirait en
`failed` + 502 ; un identifiant **absent** ne dit rien et dégrade en silence — d'où l'intérêt de
lire cette colonne après chaque changement de secret d'agent.

Et le compteur unique, qui est la raison d'être de toute la bascule : **ACCM, 2026-08, 12 220
jetons** au premier relevé — 6 368 d'Iris et 5 852 de Clara dans la **même** ligne, là où Clara
comptait jusqu'alors dans sa propre base et restait invisible du Socle.

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
