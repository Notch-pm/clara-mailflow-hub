

# Plan : Editeur visuel de Workflows avec @xyflow/react

## Aucune migration, aucune nouvelle table

Toutes les opérations utilisent exclusivement `workflows`, `workflow_states`, `workflow_transitions` et `couriers`.

## Fichiers a creer/modifier

### 1. Installer `@xyflow/react`

### 2. Service layer — `src/services/workflowService.ts`
Compléter avec les fonctions CRUD manquantes :
- `createWorkflow`, `updateWorkflow`, `deleteWorkflow`
- `createState`, `updateState`, `deleteState`
- `createTransition`, `deleteTransition`
- `getAffectedCouriers(stateIds)` — compte les courriers liés à des states modifiés

### 3. Page liste — `src/pages/Workflows.tsx`
Refondre complètement :
- Charger les workflows via `getWorkflows` + `useQuery`
- Cards avec nom, nombre d'états, badge "default"
- Dialog de création (nom du workflow)
- Clic sur card → navigation `/workflows/:id`

### 4. Page editeur — `src/pages/WorkflowDetail.tsx` (nouveau)
Layout 3 colonnes :
- **Gauche** : palette (boutons pour ajouter un noeud par catégorie)
- **Centre** : canvas `<ReactFlow>` avec nodes/edges
- **Droite** : panneau d'édition du noeud sélectionné (name, category dropdown, is_initial toggle, is_final toggle, bouton supprimer)

Comportement :
- Charger workflow + states + transitions → convertir en nodes/edges React Flow
- Positions des noeuds stockées dans `workflow_states.metadata` (le champ n'existe pas — on utilisera un layout automatique dagre ou des positions calculées en grille, stockées en state local)
- Drag entre handles → crée une transition
- Bouton "Sauvegarder" → sync complet (upsert states, upsert transitions, supprime les orphelins)
- Validation avant save : au moins 1 état initial, cohérence transitions

**Note** : `workflow_states` n'a pas de colonne `metadata` ni de colonne position. Les positions des noeuds seront calculées automatiquement via un algorithme dagre layout (bibliothèque `dagre` ou calcul en grille simple) à chaque chargement. Pas de persistance des positions.

### 5. Noeud custom — `src/components/workflow/StateNode.tsx`
- Affiche le nom de l'état
- Badge coloré par catégorie (pending=jaune, processing=bleu, processed=vert, archived=gris)
- Indicateurs visuels initial (eclair) / final (check)
- Handles source (bottom) et target (top) pour connexions

### 6. Panneau d'edition — `src/components/workflow/StateEditPanel.tsx`
- Formulaire : name (input), category (select parmi les 4 valeurs), is_initial (switch), is_final (switch)
- Bouton supprimer l'état (avec confirmation)

### 7. Regles metier dans l'editeur
- 1 seul état initial : si on toggle `is_initial` sur un noeud, les autres sont automatiquement désactivés
- Un état `archived` ne peut pas avoir de transitions sortantes
- Un état `processed` ne peut pas avoir de transition vers `pending`
- Suppression d'un état → supprime aussi ses transitions associées

### 8. Integration courriers
- Avant suppression d'un état lié à des courriers, afficher un dialog de confirmation avec le nombre de courriers impactés
- Option de réassigner les courriers à un autre état du workflow

### 9. Routing — `src/App.tsx`
- Ajouter route `/workflows/:id` → `WorkflowDetail`

## Fichiers crees

| Fichier | Role |
|---------|------|
| `src/pages/WorkflowDetail.tsx` | Page editeur canvas |
| `src/components/workflow/StateNode.tsx` | Noeud custom React Flow |
| `src/components/workflow/StateEditPanel.tsx` | Panneau lateral d'edition |
| `src/components/workflow/WorkflowToolbar.tsx` | Barre d'outils (save, add state) |

## Fichiers modifies

| Fichier | Modification |
|---------|-------------|
| `src/services/workflowService.ts` | Ajout CRUD complet |
| `src/pages/Workflows.tsx` | Liste dynamique + creation |
| `src/App.tsx` | Route `/workflows/:id` |
| `package.json` | `@xyflow/react`, `dagre` |

