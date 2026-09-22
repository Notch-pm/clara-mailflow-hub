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

### Lot « consentements RGPD » (2026-09-22) — appliqué le 2026-09-22

Reprise dans Clara du modèle de consentement livré par le Socle (`contacts-api` 1.2.0,
2026-09-13) et par Iris : catalogue fermé partagé, carte à trois états sur la fiche contact,
recueil au formulaire portail, trace immuable `couriers.consents`, report au Socle au
rattachement, consignation manuelle par un agent, `consents` dans l'enveloppe Iris, fin des
anciens `consent_email` / `consent_sms` (Clara était le dernier à les écrire — le Socle peut
maintenant préparer sa rupture 2.0.0).

Pré-vol :

```sql
SELECT
  to_regprocedure('public.is_transition_guard_bypassed()') IS NOT NULL AS helper_present,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='couriers' AND column_name='consents') AS column_present;
-- attendu avant le lot : true / false
```

| # | Action | Pourquoi cet ordre | État |
|---|---|---|---|
| 1 | `20260922100000_courier_consents.sql` — colonne `consents`, CHECK, `couriers_guard_consents()` + deux triggers, `REVOKE EXECUTE` | Les fonctions de l'étape 3 lisent la colonne ; sans elle, `push-iris-request` tomberait en erreur PostgREST | **Appliqué le 2026-09-22 via `execute_sql`** (le classificateur du mode auto de Claude Code refuse `apply_migration`, l'utilisateur a tranché) — donc **absent du registre**, dérive habituelle ; le fichier garde son horodatage. |
| 2 | Jouer `supabase/tests/courier_consents.test.sql` (transaction annulée) | Un BEFORE INSERT fautif sur `couriers` casse les six portes d'entrée | **Fait le 2026-09-22** — « OK — les 8 scénarios de couriers.consents passent », aucun résidu |
| 3 | Déployer `socle-contacts`, `push-iris-request` | Compatibles avec l'ancien front : actions nouvelles inutilisées, aucune trace tant que `portal-form` n'écrit pas | **Fait le 2026-09-22** (`socle-contacts` v16, `push-iris-request` v14) |
| 4 | Publier le frontend (merge de `feat/consentements-rgpd`, build Cloudflare) | La page portail affiche les cases **avant** que la fonction ne les exige ; l'ancienne `portal-form` ignore les champs multipart inconnus | **Fait le 2026-09-22** — push de `main` (`bb34aeb`), bundle vérifié en ligne avant l'étape 5 |
| 5 | Déployer `portal-form` (`config.toml` porte déjà `verify_jwt = false`) | Rend `traitement` obligatoire : une page déjà ouverte avec l'ancien bundle recevrait un 400 sans case à cocher, d'où l'ordre 4 → 5 | **Fait le 2026-09-22** (v24) — `GET ?token=` sert `consents[]` avec le nom de la collectivité ; un POST sans `consent_traitement` répond 400 sans créer de courrier |

Vérification :

```sql
-- La colonne, ses gardes, et aucun droit client sur la fonction trigger.
SELECT column_name, column_default FROM information_schema.columns
 WHERE table_name='couriers' AND column_name='consents';
SELECT tgname FROM pg_trigger WHERE tgrelid='public.couriers'::regclass AND tgname LIKE 'trg_couriers_consents%';
SELECT has_function_privilege('authenticated','public.couriers_guard_consents()','EXECUTE'); -- false
-- Après un premier dépôt portail :
SELECT id, received_at, jsonb_array_length(consents) FROM couriers WHERE consents <> '[]' ORDER BY created_at DESC LIMIT 5;
```

Côté Socle (projet `qhrokbkyxgcvkbpmbmna`), après un premier rattachement :

```sql
SELECT source_app, count(*) FROM contact_consents GROUP BY 1;  -- `clara` doit apparaître
```

### Lot « notifications push » (2026-09-11) — appliqué le 2026-09-11

Web Push / VAPID : la cloche ne sonne que si Clara est ouverte, le push met la même information
sur l'écran verrouillé. Détail de la conception : `docs/features.md` §8.

| # | Action | Pourquoi cet ordre | État |
|---|---|---|---|
| 1 | Générer la paire VAPID (`npx web-push generate-vapid-keys`) | Les secrets de l'étape 3 et la variable de build de l'étape 6 en sortent | **Fait** — clé publique `BGijOnCO1vT78F4Xh_MgJfDfu5sWA3VBbN-uNa6ptMnSLmYCKmWWTfQW-WHknUadPHtjL8_TAgQc1cPUyrqNSqM` (publique par construction : elle voyage dans chaque abonnement) |
| 2 | Poser `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` dans les secrets d'edge functions | Sans elles la fonction répond 503 **sans réclamer** — inoffensif, mais rien ne part | **Fait** — `supabase secrets set --env-file` (la clé privée n'est jamais passée en argv). `VAPID_SUBJECT = https://clara.edilumen.fr` ; `APP_ORIGIN` existait déjà |
| 3 | Déployer `notifications-push` | Doit précéder le cron de l'étape 5 | **Fait** — `bunx supabase functions deploy notifications-push --project-ref aullweizxcjbvtdspjli` (817 ko, `web-push` embarqué). `verify_jwt = false` **vérifié après coup** : un POST sans `Authorization` répond `{"error":"Unauthorized"}` et un GET `{"error":"method_not_allowed"}` — les chaînes de la fonction, donc la plateforme laisse passer (cf. « le piège des fonctions cron ») |
| 4 | `20260911180000_notifications_push.sql` **en entier**, cron compris | La fonction étant déjà déployée (étape 3), le découpage prévu n'avait plus lieu d'être | **Appliqué** — cf. encadré ci-dessous sur la méthode |
| 5 | Vérifier la structure et le cron | | **Fait** — table + RLS (4 policies, **0 en INSERT**), 6 colonnes `push_*`, trigger, 4 RPC ; `EXECUTE` ouvert au seul `register_push_subscription` ; job `notifications-push-every-min` (jobid 8) actif, exécutions `succeeded` |
| 6 | Poser `VITE_VAPID_PUBLIC_KEY` dans les variables de build Cloudflare, puis publier le frontend | La clé publique est **figée dans le bundle au build**. Sans elle l'interrupteur affiche « non configuré » et personne ne peut inscrire d'appareil | **Fait le 2026-09-11** — vérifié en ligne : la clé est présente dans le bundle servi |
| 8 | Coquille d'installation (manifeste + icônes + métadonnées iOS) | Safari ≥ 16.4 n'expose le push qu'en application installée : sans elle, l'état `needs_install` envoyait les iPhone dans une impasse | **Fait le 2026-09-11** — omission du portage depuis Iris, rattrapée |
| 7 | Régénérer `src/integrations/supabase/types.ts` | `push_subscriptions` et `register_push_subscription` n'y sont pas : `pushSubscriptionService.ts` travaille sous `as never` en attendant | À faire |

⚠️ **`supabase db push` est inutilisable ici, constaté le 2026-09-11** : il refuse avec
`LegacyDbPushMissingLocalError` en listant **52 versions distantes absentes du dossier local**
(appliquées jadis par `apply_migration` ou l'éditeur SQL, qui génèrent leur propre horodatage).
C'est la dérive décrite en tête de ce document, vue de face. La migration est donc passée par la
**Management API** (`POST /v1/projects/{ref}/database/query`), la porte qu'utilise
`apply_migration` du MCP officiel, puis la ligne de registre a été posée à la main :

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260911180000', 'notifications_push') ON CONFLICT (version) DO NOTHING;
```

Cette version-là, au moins, porte le **même horodatage que son fichier** — contrairement aux
précédentes. Ne pas « réparer » le registre pour les 52 autres : la base live fait foi.

⚠️ **La migration est un seul fichier**, mais ses sections 1-4 et sa section 5 ne passent pas au
même moment (étapes 2 et 5). Elle est rejouable en entier (`IF NOT EXISTS`, `CREATE OR REPLACE`,
`cron.unschedule` gardé) : la repasser complète à l'étape 5 est sans effet de bord.

Vérification, une fois un appareil inscrit — **le piège du premier essai** : `new_courier` n'est
pas créée pour l'auteur du courrier (`fn_create_courier_notifications` exclut `created_by`). Un
essai demande donc que le courrier entre **autrement que par vous** (IMAP, portail, ou un
second compte).

```sql
-- 1. L'appareil est-il inscrit, et pour QUEL compte ?
SELECT u.email, s.user_agent, s.disabled_at, s.disabled_reason, s.created_at
  FROM public.push_subscriptions s JOIN public.users u ON u.id = s.user_id;

-- 2. La notification a-t-elle été produite, pour QUI, et qu'a décidé la file ?
--    skipped + push_error NULL → décidé à l'insertion : aucun appareil du DESTINATAIRE
--    skipped + « lue avant envoi » / « aucun appareil actif » → renoncement au claim
--    pending + push_error → envoi en échec, temporisation en cours
SELECT n.type, u.email AS destinataire, n.push_status, n.push_attempts, n.push_error,
       n.created_at, n.push_sent_at
  FROM public.notifications n JOIN public.users u ON u.id = n.user_id
 WHERE n.created_at > now() - interval '1 hour' ORDER BY n.created_at DESC;

-- 3. Le cron atteint-il la fonction ?
--    200 {claimed…sent…} attendu ; 401 = secret cron, 503 = VAPID, 404 = non déployée
SELECT status_code, left(content::text, 120), created FROM net._http_response
 WHERE created > now() - interval '10 minutes' ORDER BY created DESC;

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'notifications-push-every-min';
```

Côté navigateur, le texte sous l'interrupteur nomme l'état : « non configuré » = clé publique
absente du build ; « bloquées dans les réglages » = permission refusée. `Notification.permission`
et `navigator.serviceWorker.getRegistration('/')` dans la console confirment.

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

### Lot « référence du registre (chrono) » (2026-09-13) — appliqué le 2026-09-13

`couriers.chrono` était lue par six écrans et n'avait jamais été écrite : 0 référence sur
5 080 courriers depuis 2024. Conception : `docs/data-model.md` §`couriers`.

| # | Action | Pourquoi cet ordre | État |
|---|---|---|---|
| 1 | Éprouver le trigger **en base, en transaction annulée** | Un BEFORE INSERT fautif sur `couriers` casse les six portes d'entrée d'un coup, l'ingestion IMAP comprise. Rien ne devait être posé avant d'avoir vu le comportement réel | **Fait** — 11 scénarios verts : suites par sens et par organisation, valeur explicite respectée, référence définitive, `NULL → valeur` ouvert, doublon rejeté, même référence légitime dans deux organisations, **pas de trou après annulation**. Vérifié après coup : 0 ligne laissée |
| 2 | `20260913090832_courier_chrono.sql` | Fonction + 2 triggers + index unique partiel + fermeture de `courier_sequences` aux clients | **Appliqué** via `apply_migration` — registre `20260913090832` (fichier renommé pour coller) |
| 3 | Test de fumée sur le trigger **live**, toujours en transaction annulée | Confirmer que ce qui tourne en prod est bien ce qui a été éprouvé | **Fait** — `2026-E-00001` côté SNA, `2026-S-00001` côté ACCM, 0 ligne laissée |
| 4 | Supprimer `src/services/courierSequenceService.ts` | Unique lecteur de la table, sans appelant, et **il lisait le compteur sans l'incrémenter** : le garder aurait invité à s'en servir | **Fait** |
| 5 | Publier le frontend | Aucun changement de code nécessaire (le trigger fait tout, et `createCourier` relit la ligne insérée) — le push ne porte que docs et suppression | **Fait** — push sur `main` |

⚠️ **Aucune reprise de l'existant.** Les 5 080 courriers antérieurs restent à `NULL` et
s'affichent « sans référence ». Le trigger laisse la porte ouverte (`NULL → valeur` est le seul
changement autorisé sur une référence) ; la décision de numéroter rétroactivement, et selon quel
ordre, n'est pas prise.

Vérification :

```sql
-- Le registre avance, une suite par organisation x annee x sens :
SELECT o.name, s.year, s.direction, s.last_value
  FROM courier_sequences s JOIN organizations o ON o.id = s.organization_id
 ORDER BY o.name, s.year, s.direction;

-- Et plus aucun client ne peut le rembobiner :
SELECT count(*) FROM information_schema.table_privileges
 WHERE table_schema='public' AND table_name='courier_sequences'
   AND grantee IN ('anon','authenticated');  -- doit rendre 0
```

### Lot « charte graphique depuis le Socle » (2026-09-13) — appliqué le 2026-09-13

Logo, couleur principale et couleur secondaire ne se saisissent plus dans Clara : ils sont
recopiés du référentiel, comme le nom, le slug et le serveur d'envoi. Conception :
`docs/data-model.md` §`organizations`.

Appliqué en **deux temps le même jour** : les couleurs d'abord (étapes 2-4), puis le logo
(étapes 6-8) quand le PO a confirmé qu'il devait suivre le même chemin.

| # | Action | Pourquoi cet ordre | État |
|---|---|---|---|
| 1 | Rien à faire côté Socle | La route `/v1/organizations/{id}/branding` est **déjà déployée** (vérifié le 2026-09-13 dans la fonction `public-api` live) et demande le scope `read`, que la clé plateforme de Clara porte déjà | Sans objet |
| 2 | `20260913081355_organizations_charte_du_socle.sql` | Normalise l'existant, pose le CHECK `#rrggbb`, retire aux clients l'écriture des deux colonnes | **Appliqué** via `apply_migration` — registre : `20260913081355` (le fichier a été **renommé** pour porter cet horodatage, plutôt que d'ajouter une ligne de dérive de plus). Vérifié : 22 colonnes updatables pour `anon`/`authenticated`, 24 pour `service_role` |
| 3 | Déployer `sync-socle-referentiel` | Écrit le miroir ; la migration (2) doit précéder, sinon une couleur mal formée du référentiel ferait échouer la sync sans CHECK pour l'expliquer | **Fait** — `bunx supabase functions deploy sync-socle-referentiel --project-ref aullweizxcjbvtdspjli` (`branding.ts` bien poussé dans le lot) |
| 4 | Synchronisation réelle de chaque tenant mappé | Remplace les couleurs saisies à la main par celles du référentiel | **Fait** — dry-run puis passage réel sur les 5 tenants mappés, `charte_synchronisee: 1` partout, aucun avertissement. ⚠️ ACCM a échoué au premier passage réel sur `miroir démarches: Gateway Timeout` — **incident de catalogue, sans rapport avec la charte** (l'étape 0ter précède les démarches) ; rejoué avec succès |
| 5 | Publier le frontend | L'écran de saisie disparaît ; le faire avant (4) laisserait des couleurs Clara sans moyen de les corriger | **Fait** — push sur `main` |
| 6 | `20260913082647_organizations_logo_du_socle.sql` | Retire `logo_url` du GRANT client, le logo devenant lui aussi un miroir | **Appliqué** via `apply_migration` — registre : `20260913082647` (fichier renommé pour coller). Vérifié : 21 colonnes updatables côté client, aucune des trois de charte |
| 7 | Redéployer `sync-socle-referentiel` | `planTenantIdentityUpdate` ne fixe plus que `name`/`slug` ; le logo passe par `/branding` | **Fait** |
| 8 | Synchronisation réelle | Pose le logo hérité là où la colonne brute rendait `null` | **Fait** — 5 tenants, `charte_synchronisee: 1`, aucun avertissement. **« Marie d'Arles » affiche désormais le logo d'ACCM**, qu'elle n'avait pas |

⚠️ **Changement visible sur les mails**, constaté le 2026-09-13 : les couleurs du référentiel
n'étaient pas celles qui avaient été saisies dans Clara. ACCM est passée de `#00d084`/`#ffcd57` à
`#e52322`/`#f2c02c` ; « Marie d'Arles », qui hérite d'ACCM, de `#052a55`/`#a7291f` aux mêmes ;
Seine Normandie Agglomération, qui n'avait rien, a reçu `#3b7788`/`#accd76`. `[TEST]` et
« Test 2 » restent sans couleurs — le référentiel n'en déclare pas, les gabarits de mails prennent
alors leurs couleurs de repli. C'était l'objet du lot.

Côté logo, le changement va dans l'autre sens : « Marie d'Arles » n'en affichait **aucun** et porte
désormais celui d'ACCM, parce que la charte se résout le long de la hiérarchie là où la colonne
brute de l'organisation mappée rendait `null`. ACCM et SNA gardent le leur.

Vérification :

```sql
-- La charte Clara doit être celle que resolve_branding rend côté Socle.
SELECT name, logo_url, primary_color, secondary_color FROM organizations WHERE socle_org_id IS NOT NULL;
-- Et plus aucun client ne peut l'écrire :
SELECT grantee, string_agg(column_name, ', ' ORDER BY column_name)
  FROM information_schema.column_privileges
 WHERE table_schema='public' AND table_name='organizations' AND privilege_type='UPDATE'
   AND grantee IN ('anon','authenticated')
   AND column_name IN ('logo_url','primary_color','secondary_color')
 GROUP BY grantee;  -- doit rendre 0 ligne
```

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
