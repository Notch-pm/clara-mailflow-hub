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
- Les rôles d'org vivent dans `memberships` (jamais dans `users`).
- Voir `docs/security.md` pour le modèle complet.
