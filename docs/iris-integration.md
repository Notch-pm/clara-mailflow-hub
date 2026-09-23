# Connecteur Iris — pousser une demande de Clara vers Iris

> **Livré le 2026-08-23.** Clara est une *source enregistrée* de l'API d'ingestion d'Iris.
> Rien n'a été modifié côté Iris : la route existait et était déployée.

## 1. La frontière entre les deux produits

**Iris est propriétaire exclusif des demandes d'usagers de la gamme.** Une action de courrier
fondée sur une **démarche du référentiel** y est déposée, puis instruite là-bas ; Clara n'en
garde qu'un suivi et ne la pilote pas.

La frontière n'est pas une règle de Clara, elle tombe du contrat : `socle_procedure_id` est
**obligatoire** côté Iris, qui ne gère aucune demande libre. Donc :

| Action créée dans Clara | Destination |
|---|---|
| Sur une démarche du référentiel (`procedures.socle_id` renseigné) | **Iris** |
| Sur une démarche **Arpège** (`arpege_config_fields`) | Arpège, flux inchangé |

**La « demande libre » n'existe plus depuis le 2026-09-11.** Le dialogue exige une démarche, et
ne propose que celles qu'un système instruit — Iris ou partenaire (`src/lib/procedure-origin.ts`).
Une action sans démarche était un pense-bête sans suite : ni Iris ni le partenaire ne la voyaient,
et Clara ne savait pas la faire avancer.

Le refus de `push-iris-request` sur une action sans démarche du référentiel **reste** : il couvre
les tickets d'avant cette date, les démarches Arpège (sans `socle_id`) et les appels directs. Ce
n'est pas un échec de dépôt, c'est le cas nominal de l'autre côté de la frontière — le produit ne
signale rien à l'agent.

### Une démarche ne vaut que pour l'organisme qui l'assure

Le référentiel active les démarches **par organisation**, et Iris le **fait respecter** au dépôt
(trigger `t18_requests_require_procedure_active` : « Cette démarche n'est pas activée pour cet
organisme dans le référentiel Socle. »). L'organisme vérifié est celui de l'enveloppe.

Depuis le 2026-09-10, l'agent **choisit l'organisation destinataire** dans le dialogue de demande,
et ne se voit proposer que les démarches qu'elle assure (miroir `procedure_organizations`, cf.
`docs/data-model.md`) : le refus est prévenu au lieu d'être subi. `push-iris-request` reprend la
même garde avant le réseau — mais **le miroir d'Iris reste le dernier mot** : il a sa propre
synchronisation nocturne, et peut être plus ancien que celui de Clara. Un dépôt refusé pour ce
motif après une activation toute fraîche se règle en synchronisant le référentiel **dans Iris**,
puis en cliquant « Renvoyer ». (Incident fondateur : le 2026-09-10, la démarche « Signalement
d'éclairage public défectueux » activée pour ACCM dans le Socle était refusée par Iris, dont le
miroir datait de 07:52 le matin même.)

## 2. Le contrat, et où le lire

- **OpenAPI 3.1, référence exclusive et publique** (aucune clé requise pour la lire) :
  <https://tqcoqlneybtbrrcvpkpk.supabase.co/functions/v1/requests-api/v1/openapi.json>
- Rendu lisible : `<origine Iris>/api-doc`.

Trois règles à ne pas re-déduire :

1. **Le contrat fait foi** sur les noms de champs et les statuts. La liste des statuts est
   **fermée** (`a_traiter`, `en_instruction`, `en_attente`, `annulee`, `resolue_positive`,
   `resolue_negative`, `archivee`) ; les **libellés d'affichage ne sont pas contractuels** —
   ils vivent dans `src/lib/iris.ts`, côté Clara.
2. **v1 est additive** : désérialisation tolérante, on ne code que sur les clés documentées.
3. **Les réponses sont enveloppées** : un dépôt rend `{ created, request }`, une liste rend
   `{ requests: [...] }`. (Piège vérifié en conditions réelles : lire `body.id` au lieu de
   `body.request.id` écrit des `null` partout sans lever d'erreur.)

## 3. Raccordement des champs

| Champ de l'enveloppe Iris | Source dans Clara |
|---|---|
| `source_system` | constante `"clara"` (code de la source enregistrée, vérifié contre la clé) |
| `external_id` | `action_tickets.id` — **l'id du ticket, jamais celui du courrier** : un courrier peut engendrer plusieurs demandes |
| `idempotency_key` | `action_tickets.iris_idempotency_key`, tirée à la création et **rejouée telle quelle** |
| `socle_root_organization_id` | `organization_integrations.socle_root_org_id` — **la racine de l'intégration**, pas celle du tenant (voir §5) |
| `socle_organization_id` | organisation destinataire **choisie sur l'action** : `action_tickets.socle_organization_id`, à défaut `couriers.socle_organization_id` → `socle_organizations.socle_id` (traversée du miroir : Iris attend l'UUID **Socle**) |
| `socle_procedure_id` | `procedures.socle_id` |
| `socle_contact_id` | `courier_participants.socle_contact_id` du participant `sender` |
| `subject` | `action_tickets.title`, à défaut le nom de la démarche (500 car. max) |
| `body` | `action_tickets.description` |
| `requester` | `socle_data.demandeur` (valeurs + `audience`) — identité **déclarée**, conservée intégralement |
| `form_data` | `socle_data.form`, indexé par **clé machine** (`key`) |
| `context` | canal, date de réception **d'origine**, permalien `APP_ORIGIN/courrier/<id>`, métadonnées |
| `links` | un lien `courrier` (chrono à défaut id, sujet en libellé) |
| `attachments` | `upload_id` des pièces DÉPOSÉES sur `/v1/uploads`, tirées de `socle_data.pieces_jointes` (pièces réclamées par le formulaire) + `form_field_key` = clé machine du champ — voir §5 bis |
| `consents` | `couriers.consents` (trace d'un dépôt portail), **`kind` + `granted` seulement** — Iris compose sa propre phrase (contrat 2.2.0). Omis si le courrier n'a pas de trace (saisie agent, IMAP) : Iris pose l'anomalie `consentement_absent`, jamais un refus. Omis aussi si la trace n'accorde pas `traitement` (théorique) : Iris répondrait 400 sur tout le dépôt |

Logique pure et testée : `supabase/functions/_shared/iris-envelope.ts`
(+ `src/test/iris/iris-envelope.test.ts`). Elle **refuse avant le réseau** ce qu'Iris
refuserait : pas de démarche, démarche obsolète, racine absente, aucun demandeur.

**Double écriture au Socle, assumée.** Pour un courrier portail rattaché à une fiche puis déposé
dans Iris, le référentiel porte deux recueils `source_app = clara` : celui de Clara au
rattachement (`source_reference = courier.id`, `collected_at` = date du dépôt) et celui d'Iris à
l'ingestion (`source_reference = ticket.id`, `collected_at` = date d'ingestion, Iris ne transmet
pas encore `context.received_at`). Même fait, deux traces bornées, même état dérivé. Seul défaut :
la date d'état devient celle de l'ingestion. Correctif d'une ligne côté Iris, hors de Clara.

## 4. Le chemin, bout en bout

1. L'agent crée une action sur une démarche du référentiel (`CreateTicketDialog`).
2. **Le ticket est créé d'abord** — son id EST l'`external_id`, il ne peut pas être connu
   avant —, puis `push-iris-request` dépose la demande. C'est la différence assumée avec
   `create-arpege-demande`, qui crée chez le partenaire *avant* le ticket.
3. **Un échec ne détruit rien** : le ticket reste, le message d'Iris est rangé dans
   `iris_last_error`, et l'onglet « Actions liées » propose **Renvoyer**. Le renvoi est sûr :
   la clé d'idempotence est rejouée, un contenu identique renvoie la demande existante
   (`200 created:false`) au lieu d'en créer une seconde.
4. `sync-iris-requests` (cron **03:30**, après le référentiel de 03:00) relit
   `GET /v1/requests?updated_since=` et met à jour statut, référence, version et URL.
   **Garde de version monotone** : une mise à jour n'est appliquée que si sa `version` dépasse
   celle connue, ce qui absorbe rejeux et arrivées en désordre.
5. `refresh-iris-status` fait la même chose **pour un seul courrier, à la demande** :
   l'onglet « Actions liées » l'appelle à chaque ouverture, comme il le fait déjà pour Arpège.
   Sans lui, l'écran montrerait l'état écrit **au dépôt** jusqu'au balayage de 03:30 — une
   demande déposée à 12:44 et résolue à 12:53 s'affichait « À traiter » pendant quinze heures
   (incident fondateur : 2026-09-11). Il lit `GET /v1/requests/{id}` demande par demande et
   partage le patch d'écriture avec le balayage (`irisTicketPatch`, testé), pour que l'état
   affiché ne dépende pas de qui a lu en dernier.

   Deux règles que ce chemin ne doit pas franchir : il **n'avance pas** le curseur
   `last_sync_at` (il appartient au balayage — l'avancer ferait sauter la nuit suivante les
   demandes des autres courriers modifiées entre-temps), et un **échec de lecture n'écrit
   jamais** `iris_last_error`, qui ne parle que du dépôt : ce serait proposer « Renvoyer » pour
   une demande déjà déposée.

Le suivi est une **réconciliation système** (service_role) : un consultant voit un statut à
jour sans déclencher d'écriture qui lui soit imputable.

## 5. Périmètre, clé, et le cas des sous-organisations

La clé d'intégration (`irs_…`) est **liée à une source, elle-même liée à UN tenant**. Iris
vérifie le `source_system` et le `socle_root_organization_id` déclarés **contre la clé** : un
écart vaut `403`, jamais un dépôt dans le mauvais tenant.

D'où `organization_integrations.socle_root_org_id`, configuré explicitement : il **ne se déduit
pas** de `organizations.socle_org_id`, puisqu'un tenant Clara peut être mappé sur une
**sous-organisation** (« Marie d'Arles », sous ACCM). Un tel tenant déposerait dans le tenant
Iris de sa racine, avec `socle_organization_id` pointant la sous-organisation.

La clé est un **secret serveur** : `organization_integrations` est réservée au superadmin et au
`service_role` (verrou du lot L2 partenaires), et l'`api_key` n'est jamais servie à un
navigateur. Elle porte une **expiration obligatoire** — celle en place expire le
**2027-08-23**, à renouveler côté Iris avant cette date.

Sémantique de la suspension (`is_active = false`), alignée sur les partenaires : le **dépôt est
bloqué**, le **suivi des demandes déjà déposées continue**. Un tenant **sans aucune** intégration
Iris n'est pas en erreur : le dépôt répond `{ skipped: true, reason: "absente" }` et l'agent ne
voit rien — cette collectivité ne dépose simplement pas ses demandes dans Iris.

## 5 bis. Les pièces jointes (contrat 2.0.0)

**Ce qui part : les pièces que le FORMULAIRE de la démarche réclame**, et elles seules — les
« Statuts de l'association » et le « Relevé d'identité bancaire » d'une demande de subvention,
cochés par l'agent dans le dialogue de demande (décision PO du 2026-09-11). Le reste des
documents du courrier ne suit pas : Iris instruit une démarche, pas un courrier, et le courrier
lui-même reste consultable par le permalien.

**Comment** : Iris ne va JAMAIS chercher un fichier chez Clara (le mode « URL signée » du
contrat 1.x a été retiré sans jamais servir), et un contenu inline vaut 400. Deux temps, dans
`push-iris-request` :

1. chaque fichier est déposé sur `POST /v1/uploads` (`multipart/form-data`, champ `file`, un
   fichier par appel, 25 Mo et 60 dépôts/minute/clé) → `upload_id` valable **24 h** ;
2. les `upload_id` entrent dans l'enveloppe : `attachments: [{ upload_id, form_field_key }]`.

Trois points qui ne se redevinent pas :

- **On ne dépose les fichiers qu'APRÈS avoir validé l'enveloppe** (`buildIrisEnvelope`) : un
  refus de démarche obsolète laisserait sinon des fichiers orphelins en zone d'attente. Inverse :
  un POST de demande qui échoue ne laisse rien traîner — un dépôt jamais référencé est purgé.
- **`form_field_key` est la clé MACHINE du champ** (`rib`, `statuts`), quand
  `socle_data.pieces_jointes` indexe par **id** de champ (`f-sub-13`). Le pont est le
  `form_schema` de la démarche (`planIrisAttachments`, logique pure testée). Champ disparu
  depuis la saisie ⇒ la pièce part quand même, « hors champ » : perdre le fichier serait pire.
- **Refus d'un fichier ≠ panne.** 400/413/415/422 (format hors liste, extension incohérente,
  25 Mo) sont définitifs : la demande part **sans** cette pièce et le ticket le dit
  (`action_tickets.iris_attachments_error`, affiché sous la référence Iris). Tout le reste
  (401, 403, 429, 5xx, réseau) est passager : **rien n'est déposé**, l'agent renvoie — amputer
  une demande d'une pièce que la démarche exige donnerait un dossier incomplet que plus rien
  ici ne viendrait compléter.

Formats admis par Iris, vérifiés sur le **contenu réel** (signature binaire) : PDF, JPEG, PNG,
WebP, HEIC, GIF, `.docx`, `.xlsx`, `.odt`, `.ods`. Ni SVG, ni HTML, ni archive, ni Office à
macros. Attention : le `acceptedFormats` d'un champ du référentiel peut être plus large que
cette liste (« statuts » accepte `doc`, qu'Iris refuse).

L'empreinte d'idempotence d'Iris **inclut le contenu** des pièces (nom, type détecté, taille,
sha256, clé de champ) et **ignore** les `upload_id` : renvoyer la même demande avec de nouveaux
téléversements des mêmes fichiers reste un rejeu identique (200). Corollaire à ne pas oublier :
ajouter des pièces à une demande **déjà déposée sans elles** changerait l'empreinte ⇒ **409**.
Le chemin pour celles-là est `POST /v1/requests/{id}/attachments` — non implémenté côté Clara
(décision PO : pas de rattrapage, les demandes concernées sont des essais).

## 5 ter. Lire les demandes d'un usager (contrat 2.4.0)

> **Livré le 2026-09-23.** La fiche contact et la page usager de l'espace élu montrent les
> demandes de l'usager instruites dans Iris, **toutes origines confondues** — portail,
> guichet, courrier —, à côté de ses courriers. Objectif : une vue centralisée de ce qu'un
> usager a adressé à la collectivité.

**Lecture en direct, rien de stocké.** `iris-contact-requests` appelle
`GET /v1/requests?socle_contact_id=` à chaque ouverture ; Clara ne garde aucune copie, comme
pour les contacts du Socle. Iris ne sert que sa liste blanche (ni notes internes, ni
`form_data`) et des identifiants : les libellés de démarche et d'organisme sont résolus dans
les miroirs (`procedures.socle_id`, `socle_organizations.socle_id`), et une demande déposée
depuis Clara est reliée à son courrier par `action_tickets.iris_request_id`.

**Le scope qui ouvre toutes les sources.** Par défaut, une clé ne lit que les demandes de sa
source. La clé de Clara porte en plus **`requests:read_tenant`**, qui lève ce filtre **à la
seule condition qu'un usager soit nommé** — jamais d'aspiration du tenant. Sans ce scope,
Iris ne rend que les demandes nées dans Clara : la vue est **partielle, pas en erreur**.

**Le périmètre est appliqué côté serveur**, dans la fonction : hors administrateur et
superadmin, seules sortent les demandes des organisations Socle de l'appelant
(`socle_organization_members` → `socle_id`) et celles sans organisme — même règle que les
courriers (`applyServiceFilter`), mais pas « UI seulement » : ce sont les données d'un autre
produit. Logique pure et testée : `_shared/iris-contact-requests.ts`
(+ `src/test/iris/iris-contact-requests.test.ts`).

Tenant sans connexion Iris ⇒ `{ skipped: true }` et la section disparaît de l'écran. Pas de
lien vers la fiche Iris : elle ne s'ouvre qu'avec un compte Iris.

**Le détail d'une demande (contrat 2.5.0).** Chaque demande s'ouvre dans Clara
(`/demandes/:id`, `/elu/demande/:id`) via `iris-request-detail` →
`GET /v1/requests/{id}/timeline` : texte de la demande, réponse apportée, **demandes
d'intervention** et leur état, **commentaires internes** des agents d'Iris, activité. Décision
du 2026-09-23 : les commentaires internes sont utiles à l'élu, mais ne doivent **jamais**
atteindre un tiers ni être en accès libre. D'où trois verrous : côté Iris, cette route est la
**seule** sortie des notes internes et exige `requests:read_tenant` (un partenaire reçoit 403) ;
côté Clara, un membre connecté du tenant, dans le périmètre de ses organisations (hors
périmètre ⇒ 404, comme une demande inexistante) ; rien n'est stocké ni mis en cache. Tous les
membres les lisent, comme les notes internes des courriers. Iris nomme les personnes et filtre
le détail des événements par type — jamais d'e-mail ni d'identifiant d'agent.

## 6. Limites connues

- **Pas de rattrapage des demandes déposées avant le 2026-09-11** : elles sont parties sans
  aucune pièce (dont `DEM-2026-000055`, constat fondateur du brief Iris du 2026-09-19). Aucun
  écran ne les complète ; leur `iris_attachments_error` est `null` et ne prouve donc rien.
- **Pas d'écran de configuration** : la connexion Iris se pose en SQL par le superadmin.
  `OrgIntegrations` ne gère que les champs Arpège (Hawk) ; y ajouter une carte Iris (URL, clé,
  racine, suspension, test) est le prolongement naturel.
- **Une demande déposée ne se retire pas** : le journal d'événements d'Iris est immuable
  (`DELETE` interdit). Une demande de test se solde côté Iris, elle ne s'efface pas.

## 7. Exploitation

Enregistrer une nouvelle collectivité (les deux côtés) :

```sql
-- Côté Iris : la source, puis la clé (SHA-256 de la valeur brute, expiration obligatoire)
insert into integration_sources (organization_id, code, name, status)
values ('<tenant Iris>', 'clara', 'Clara — gestion électronique de courrier', 'active');
insert into integration_credentials (integration_source_id, name, key_prefix, key_hash, scopes, expires_at)
values ('<source>', 'Clara', 'irs_xxxxxxxx', '<sha256 hex>', array['requests:write','requests:read'], now() + interval '1 year');

-- Côté Clara : la connexion du tenant (la clé BRUTE, jamais journalisée)
insert into organization_integrations (organization_id, provider, api_base_url, api_key, socle_root_org_id, is_active)
values ('<tenant Clara>', 'iris', 'https://<projet iris>.supabase.co/functions/v1/requests-api',
        '<clé brute irs_…>', '<racine Socle>', true);
```

Diagnostic :

```sql
-- Demandes déposées et leur dernier état connu
select t.id, t.iris_reference, t.iris_status, t.iris_version, t.iris_synced_at, t.iris_last_error
from action_tickets t where t.iris_request_id is not null or t.iris_last_error is not null;

-- Curseur de réconciliation du tenant (horloge d'Iris)
select organization_id, last_sync_at from organization_integrations where provider = 'iris';
```

Déclenchement manuel de la réconciliation : `select public.trigger_iris_sync();`
(ou POST sur `sync-iris-requests` avec l'en-tête `x-cron-secret`).
