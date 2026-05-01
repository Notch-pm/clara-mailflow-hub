## Objectif

Ajouter, sur chaque état d'un workflow de type "réponse", un booléen activable depuis le panneau d'édition d'un état, indiquant que cet état déclenche/exige la signature du courrier.

## Modifications

### 1. Base de données (migration)
- Ajouter une colonne `requires_signature boolean NOT NULL DEFAULT false` à la table `workflow_states`.

### 2. Service workflow (`src/services/workflowService.ts`)
- Ajouter `requires_signature?: boolean` dans les signatures de `addState` et `updateState`.
- Inclure le champ dans les `insert` / `update`.

### 3. Page WorkflowDetail (`src/pages/WorkflowDetail.tsx`)
- Lire `requires_signature` quand on charge les états et le propager dans les `data` du nœud React Flow.
- Le persister lors d'un update et le passer en prop au `StateEditPanel`.
- Détecter le type du workflow (`reply` vs `inbound`) déjà chargé pour ne montrer le toggle qu'aux workflows réponse.

### 4. Composant `StateEditPanel`
- Nouvelle prop `workflowType: "inbound" | "reply" | null` et `requiresSignature: boolean`.
- Ajouter un `Switch` "Signature requise à cet état" affiché uniquement si `workflowType === "reply"`.
- Émettre `onUpdate({ requires_signature })`.

### 5. Composant `StateNode` (visuel)
- Afficher une petite icône (stylo/Pen) discrète sur le nœud quand `requires_signature` est vrai, pour repérage visuel sur le canvas.

## Hors-périmètre (à confirmer dans une prochaine étape)
- L'utilisation effective du flag dans le composant de réponse (`ReplyComposer`) pour exiger/insérer la signature. La présente demande ne concerne que la déclaration au niveau du workflow.
