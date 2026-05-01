## Objectif

Compléter le workflow existant avec deux nouveaux états supplémentaires (qui s'ajoutent aux états actuels Reçu / En traitement / Traité / Archivé), tous deux classés dans la catégorie **En traitement** (`processing`) :

- **Réponse en cours de validation**
- **Réponse envoyée**

Aucune modification de schéma ni de catégorie n'est nécessaire : la table `workflow_states` accepte déjà des états libres, et la catégorie `processing` est utilisée pour les regrouper côté UI (boîte « Courriers en instruction »).

## État actuel constaté

Un seul workflow existe en base : **« test »** sur l'organisation **Laurentville**, avec 7 états :

| Catégorie | Nom |
|---|---|
| pending | Reçu (initial) |
| processing | En cours de traitement |
| processing | En attente d'instruction par les services |
| processing | En attente d'information |
| processed | Traité (final) |
| processed | Annulé (final) |
| archived | Nouveau - Archivé (final) |

## Ce qui sera fait

### 1. Insertion des deux nouveaux états

Insérer dans `workflow_states` deux lignes pour le workflow `6f9f71a8-acee-4ed4-83df-fa4debfea0a3` (org `55dab847-7a67-4fa2-b878-70c25338fc9e`) :

- `Réponse en cours de validation` — category=`processing`, is_initial=false, is_final=false
- `Réponse envoyée` — category=`processing`, is_initial=false, is_final=false

Aucune transition n'est créée automatiquement : vous pourrez les tracer visuellement ensuite dans l'éditeur (page Workflows → ouvrir le workflow → glisser une connexion d'un état à l'autre → Sauvegarder).

### 2. Vérification

Relire les états du workflow pour confirmer que les deux entrées sont présentes et bien rattachées à la bonne organisation.

## Hors périmètre

- Pas de migration de schéma (la table existe et accepte déjà des états libres).
- Pas d'ajout de transitions automatiques — à vous de définir depuis quel(s) état(s) on peut passer à « Réponse en cours de validation » et où va « Réponse envoyée » (typiquement vers « Traité » ou « Archivé »).
- Pas de changement d'UI : les nouveaux états apparaîtront automatiquement dans le sélecteur d'état d'un courrier et seront comptés dans la vue « Courriers en instruction ».

## Détails techniques

Insertions SQL équivalentes (exécutées via l'outil d'insertion de données, pas via migration) :

```sql
INSERT INTO workflow_states (organization_id, workflow_id, name, category, is_initial, is_final)
VALUES
  ('55dab847-7a67-4fa2-b878-70c25338fc9e',
   '6f9f71a8-acee-4ed4-83df-fa4debfea0a3',
   'Réponse en cours de validation', 'processing', false, false),
  ('55dab847-7a67-4fa2-b878-70c25338fc9e',
   '6f9f71a8-acee-4ed4-83df-fa4debfea0a3',
   'Réponse envoyée', 'processing', false, false);
```

## Question avant exécution

Souhaitez-vous que je crée aussi automatiquement des transitions de base, par exemple :

```text
En cours de traitement  ──▶  Réponse en cours de validation  ──▶  Réponse envoyée  ──▶  Traité
```

Ou préférez-vous tracer vous-même les flèches dans l'éditeur visuel après l'insertion ?
