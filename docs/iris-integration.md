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
| Sans démarche — « demande libre » | **reste dans Clara** |
| Sur une démarche **Arpège** (`arpege_config_fields`) | Arpège, flux inchangé |

Une action libre n'est donc pas un échec de dépôt : c'est le cas nominal de l'autre côté de la
frontière, et le produit ne doit rien signaler à l'agent.

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
| `socle_organization_id` | organisation destinataire du courrier : `couriers.socle_organization_id` → `socle_organizations.socle_id` (traversée du miroir : Iris attend l'UUID **Socle**) |
| `socle_procedure_id` | `procedures.socle_id` |
| `socle_contact_id` | `courier_participants.socle_contact_id` du participant `sender` |
| `subject` | `action_tickets.title`, à défaut le nom de la démarche (500 car. max) |
| `body` | `action_tickets.description` |
| `requester` | `socle_data.demandeur` (valeurs + `audience`) — identité **déclarée**, conservée intégralement |
| `form_data` | `socle_data.form`, indexé par **clé machine** (`key`) |
| `context` | canal, date de réception **d'origine**, permalien `APP_ORIGIN/courrier/<id>`, métadonnées |
| `links` | un lien `courrier` (chrono à défaut id, sujet en libellé) |
| `attachments` | **rien pour l'instant** — voir §6 |

Logique pure et testée : `supabase/functions/_shared/iris-envelope.ts`
(+ `src/test/iris/iris-envelope.test.ts`). Elle **refuse avant le réseau** ce qu'Iris
refuserait : pas de démarche, démarche obsolète, racine absente, aucun demandeur.

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

## 6. Limites connues

- **Pièces jointes : rien n'est envoyé.** Le contrat le demande explicitement — le worker de
  copie d'Iris n'est pas actif, les pièces resteraient en `copy_status: pending`. La sélection
  de l'agent reste dans `socle_data.pieces_jointes`, prête pour le jour où le worker tournera
  (endpoint dédié `POST /v1/requests/{id}/attachments`, références signées uniquement).
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
