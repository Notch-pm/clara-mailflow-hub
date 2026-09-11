# Conventions de code

## Structure des fichiers

- **Pages** : `src/pages/PascalCase.tsx`. Une page = une route. Pages lourdes peuvent être `lazy()`.
- **Composants** : `src/components/...`. Spécifiques au domaine dans des sous-dossiers (`courier/`, `workflow/`). Primitives shadcn dans `components/ui/` — **ne pas modifier** sauf pour ajouter une variante.
- **Services** : `src/services/<entite>Service.ts`. Un fichier par entité métier. Toujours typé avec `Database["public"]["Tables"][...]`. Pas d'effet UI ici.
- **Hooks** : `src/hooks/`. Préfixe `use*`.
- **Contexts** : `src/contexts/`. `AuthContext` et `OrganizationContext` sont déjà branchés dans `App.tsx`.
- **Types** : `src/types/<domaine>.ts` ré-exporte les types DB générés + types UI dérivés.

## React / TanStack Query

- Préférer `useQuery` pour les lectures, `useMutation` + `queryClient.invalidateQueries` pour les écritures.
- Clés de query : tableaux préfixés par l'entité, ex. `["couriers", orgId, filters]`.
- Toasts via `sonner` (`import { toast } from "sonner"`) pour les succès/erreurs.

## Supabase côté client

```ts
import { supabase } from "@/integrations/supabase/client";

// Lecture
const { data, error } = await supabase
  .from("couriers")
  .select("*, courier_participants(*)")
  .eq("organization_id", orgId)
  .order("created_at", { ascending: false });
```

- **Toujours** filtrer par `organization_id` (même si RLS le ferait) — clarté + perf.
- Pour les tables non encore typées : cast `as never` sur les payloads et `as unknown as MaTable` sur les retours (cf `courierAnalysisService.ts`).

## Design system

- **Tokens HSL** dans `src/index.css` (`--background`, `--foreground`, `--primary`, `--accent`, `--card`, etc.).
- **Tailwind** : utiliser les classes sémantiques (`bg-primary`, `text-foreground`, `border-border`). **Jamais** de couleurs hardcodées dans les composants.
- **Palette Notch** : vert principal `#0acf83`, jaune accent `#ffcd57` (définis comme HSL dans `index.css`).
- **Typo** : Nunito Sans (chargée via Google Fonts dans `index.html`).
- **Ombres** : style Airbnb (soft, layered) — variables `--shadow-*` dans `index.css`.
- **shadcn** : composants dans `components/ui/`. Étendre via `cva` plutôt que créer une variante inline.
- **Icônes** : `lucide-react` exclusivement.

## Formulaires

- `react-hook-form` + `@hookform/resolvers/zod` + `zod` pour la validation.
- Composants `Form*` de shadcn (`components/ui/form.tsx`).
- **Formulaire d'une démarche du référentiel** (`SocleDemandeForm.tsx`) : le rendu suit celui
  d'**Iris** (`ProcedureFormFields.tsx` du dépôt `iris`) — sections en cartes titrées, grille à
  deux colonnes, choix courts en pastilles, repère « conditionnel », aide **sous** le champ.
  C'est la même demande, saisie ici et instruite là-bas : un agent qui passe d'un produit à
  l'autre doit retrouver le même formulaire. Avant d'y toucher, regarder ce que fait Iris.

## Adresse et carte

- **Champ d'adresse assisté** : `components/address/AddressField.tsx` — une ligne unique qui
  propose (Base Adresse Nationale), une carte de contrôle, un dépliant pour les précisions
  d'accès. Il **propose, il ne garde pas la porte** : le texte libre est toujours conservé, et
  « Adresse introuvable ? » ouvre la saisie manuelle. Logique pure dans `lib/adresse.ts`.
- **Carte** : `components/map/TileLayer.tsx` + `lib/carto.ts` (projection Web Mercator, tuiles).
  **Aucune bibliothèque de carte** : des `<img>` positionnées suffisent pour une carte de
  contrôle, et rien ne s'ajoute au bundle. (`leaflet` / `react-leaflet` traînent encore dans
  `package.json` sans aucun import : reliquat du module quartiers décommissionné.)
- L'**attribution OpenStreetMap (ODbL) est obligatoire** et vit dans `TileLayer` pour suivre
  toutes les cartes : ne pas la retirer.
- Deux services publics, sans clé ni compte, substituables par `VITE_MAP_TILE_URL` et
  `VITE_GEOCODE_URL`. Ce qui y transite : une adresse, jamais un nom ni une référence de
  courrier. **Aucune coordonnée n'est stockée** — ce que la demande garde, c'est l'adresse.
- Bloc « Lieu d'intervention » d'une démarche : reconnu par `lib/socle-intervention.ts` (mêmes
  règles qu'Iris) et rendu en UN champ d'adresse. La reconnaissance ne décide que d'un
  affichage : on écrit dans les champs que la démarche pose, sans jamais en inventer.

## Éditeur de texte riche

- Tiptap (`@tiptap/react` + `starter-kit` + `image` + `link`). Wrapper : `components/ui/rich-text-editor.tsx`.

## Tests

- Vitest + `src/test/setup.ts`. Mocker Supabase au besoin. Exemple : `src/test/example.test.ts`.

## i18n

- App **en français** (textes UI, slugs d'URL, noms de pages). Garder cette cohérence pour toute nouvelle string visible utilisateur.
- Noms de produits / techniques restent en anglais (Lovable Cloud, Supabase, GitHub).

## Sécurité — réflexes

- Ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` côté client.
- Ne jamais checker `is_superadmin` uniquement côté client → toujours doublé d'un check serveur (RLS + edge function).
- Les rôles d'org vivent dans `organization_users` (jamais dans `users`, sauf `users.is_superadmin` pour le rôle global).
- Voir `docs/security.md` pour le modèle complet.
