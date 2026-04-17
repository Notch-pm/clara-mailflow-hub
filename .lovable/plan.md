

## Plan: Classification (tags) dans les paramètres

### Objectif
Ajouter une section "Classification" dans Paramètres permettant de gérer les tags de l'organisation. Les administrateurs créent/suppriment les tags ; tous les utilisateurs peuvent les attribuer aux courriers (via le volet de la boîte aux lettres). Les tags du courrier deviennent un sélecteur parmi la liste prédéfinie.

### 1. Base de données (migration)
Nouvelle table `courier_tags` :
- `id uuid PK`
- `organization_id uuid NOT NULL`
- `name varchar NOT NULL`
- `color varchar NULL` (hex, optionnel pour l'affichage)
- `created_at timestamptz default now()`
- `created_by uuid NULL`
- `UNIQUE(organization_id, name)`

RLS (pattern projet `x-org-id` via JSON header) :
- `auth_select` : tous les `authenticated` de l'org peuvent lire.
- `auth_insert` / `auth_update` / `auth_delete` : restreints aux admins via sous-requête `organization_users` (role = 'administrateur').

### 2. Service
`src/services/courierTagService.ts` : `listTags(orgId)`, `createTag(orgId, name, color?)`, `deleteTag(orgId, id)`.

### 3. UI Paramètres
- `src/pages/SettingsPage.tsx` : ajouter section `classification` (icône `Tags`) dans le menu et le router interne.
- `src/pages/ClassificationSettings.tsx` (nouveau) :
  - Liste des tags (badges avec nom + pastille couleur).
  - Si l'utilisateur est admin (`membership.role === 'administrateur'`) : input + bouton "Ajouter", bouton supprimer sur chaque tag, sélecteur de couleur simple (palette prédéfinie ~6 couleurs).
  - Sinon : lecture seule + message "Seuls les administrateurs peuvent modifier les tags".
- Idem dans `src/pages/OrgSettings.tsx` (vue superadmin par organisation) : ajouter la même section.

### 4. Boîte aux lettres
`src/components/courier/MailboxSidePanel.tsx` :
- Remplacer le champ texte libre par un Popover/Command qui liste les tags disponibles de l'org.
- Cocher/décocher pour ajouter/retirer du courrier (toujours stocké dans `courier.metadata.tags` comme noms).
- Si un tag stocké n'existe plus dans la liste, l'afficher quand même avec style atténué + croix pour le retirer.
- Affichage des badges utilise la couleur du tag définie en paramètres.

### Détails techniques
- Détection admin : utiliser `useAuth().membership.role === 'administrateur'` (déjà disponible dans `AuthContext`).
- Couleurs : palette fixe de ~6 valeurs HSL alignées sur le design system (vert, jaune, bleu, rouge, gris, violet).
- Aucune modification des types Supabase nécessaire côté client (le fichier `types.ts` est régénéré automatiquement après la migration).
- Aucun changement aux données existantes (`metadata.tags` reste un `string[]` de noms).

### Diagramme rapide
```text
Settings → Classification
   ├── Liste tags (badge + couleur)
   ├── [admin] Ajouter tag (input + couleur)
   └── [admin] Supprimer tag

MailboxSidePanel
   └── Tags du courrier
        └── Popover → liste tags org → toggle
```

