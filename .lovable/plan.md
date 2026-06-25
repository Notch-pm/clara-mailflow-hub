## Objectif

Permettre, dans l'éditeur de workflow, de désigner explicitement pour chaque état une transition sortante **« Suivante »** (nominale, en avant) et/ou une transition sortante **« Précédente »** (retour en arrière nominal). Cette désignation servira de référence fiable pour les automatisations — notamment l'avancement automatique après signature d'une réponse — quand un état a plusieurs sorties.

## Modèle de données

Ajout d'une colonne sur `workflow_transitions` :

- `kind` (texte, valeurs : `next`, `previous`, ou `null` = transition « secondaire »)
- Index unique partiel par `(from_state_id, kind)` quand `kind IS NOT NULL` → garantit **au plus une** transition « next » et **au plus une** « previous » par état source.
- Valeur par défaut : `null` (toutes les transitions existantes restent neutres, l'utilisateur les marquera au besoin).

Migration unique : `ALTER TABLE` + index + commentaire.

## Éditeur de workflow

Quand l'utilisateur clique sur une arête (transition) dans le canvas React Flow :

- Affichage d'un mini-panneau latéral (ou popover ancré à l'arête) avec :
  - Le nom de la transition (éditable, comme aujourd'hui).
  - Un sélecteur de **rôle** : `Suivante` / `Précédente` / `Aucun` (par défaut).
  - Une note explicative : « La transition désignée comme Suivante sera utilisée par les automatisations (ex. après signature). »
- Si l'utilisateur désigne une transition « Suivante » alors qu'une autre l'est déjà pour le même état source, on bascule automatiquement l'ancienne sur « Aucun » (côté UI + contrainte DB en garde-fou).

Visualisation sur le canvas :

- Arête `next` : trait vert plus épais + flèche pleine + petit badge « → Suivante ».
- Arête `previous` : trait ambré pointillé + badge « ← Précédente ».
- Arête `null` : style actuel inchangé.

La sauvegarde existante du workflow (sync des transitions) est étendue pour persister `kind`.

## Utilisation côté courrier

Dans `ReplyComposer.doSign` (et tout futur point d'automatisation) :

1. Chercher parmi les transitions sortantes celle dont `kind = 'next'`.
2. Si trouvée → l'emprunter automatiquement après signature.
3. Sinon → ne **pas** transiter automatiquement et laisser l'utilisateur choisir (on retire le fallback heuristique actuel basé sur `CATEGORY_ORDER`, qui est ambigu).
4. Afficher un toast d'info si aucune « Suivante » n'est définie : « Aucune étape suivante désignée dans le workflow. »

## Détails techniques

- Fichiers DB : nouvelle migration `..._workflow_transition_kind.sql`.
- Fichiers front :
  - `src/pages/WorkflowDetail.tsx` : gestion `onEdgeClick`, sync `kind` dans la sauvegarde, styles d'arêtes calculés à partir de `kind`.
  - Nouveau composant `src/components/workflow/EdgeEditPanel.tsx` (sélecteur de rôle + nom).
  - `toEdges()` enrichi : passe `data.kind` aux edges + applique le style conditionnel.
  - `src/components/courier/ReplyComposer.tsx` : remplace l'heuristique `CATEGORY_ORDER` par un lookup direct sur `kind === 'next'`.
- Types : régénération automatique de `src/integrations/supabase/types.ts` après migration.

## Hors périmètre

- Pas de migration automatique des workflows existants vers des `next`/`previous` (l'admin marque manuellement).
- Pas de changement sur les boutons manuels de transition dans `ReplyComposer` (toujours toutes les transitions affichées dans le sélecteur).
