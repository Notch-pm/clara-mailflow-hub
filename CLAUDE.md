# Clara — Guide Claude Code

> **Lisez ce fichier en premier.** Il est court par design. Les détails sont dans `docs/` — n'ouvrez un fichier que si la tâche le concerne.

## Pitch produit

**Clara** est une solution SaaS de **gestion électronique de courrier (GEC)** pour collectivités et organisations administratives. Elle permet de :

- **Recevoir** des courriers (saisie manuelle + lecture automatique de boîtes mails IMAP, configurées par service).
- **Analyser** chaque courrier (OCR des pièces jointes + LLM via Lovable AI Gateway) : résumé, intentions, sentiment, actions suggérées.
- **Traiter** via workflows configurables (états + transitions), tags, assignation à un service, tickets d'action.
- **Répondre** : brouillon généré par IA, signature électronique (image), envoi via SMTP de l'organisation.
- **Tracer** : historique d'événements, notes, liens entre courriers, références séquentielles annuelles.
- **Référentiels** : usagers (expéditeurs/destinataires), signataires, modèles, démarches (sync nocturne depuis **Arpège**).

Multi-tenant strict : toute donnée est scopée par `organization_id`. Repo : <https://github.com/Notch-pm/clara-mailflow-hub>.

## Stack (résumé)

- **Frontend** : React 18 + Vite 5 + TypeScript + Tailwind + shadcn/ui + React Router + TanStack Query.
- **Backend** : Supabase (Postgres + RLS + Auth + Storage + Edge Functions Deno + pg_cron).
- **IA** : Lovable AI Gateway (modèles Gemini par défaut) via edge functions.
- **Tests** : Vitest.

## Règles d'or (à ne jamais violer)

1. **Multi-tenant** : toute requête DB filtre par `organization_id`. RLS appliquée via header `x-org-id` (voir `docs/data-model.md`).
2. **Rôles** : `is_superadmin` sur `public.users`, rôles d'org dans `memberships` (`admin`/`member`). Ne **jamais** stocker un rôle ailleurs. Pas d'escalade côté client.
3. **Services côté client** : un fichier par domaine dans `src/services/`, retourne du typé `Database["public"]...`. Pas de logique métier dans les composants.
4. **Design system** : tokens sémantiques HSL dans `src/index.css` + `tailwind.config.ts`. Pas de couleurs hardcodées dans les composants. Palette Notch (vert `#0acf83`, jaune `#ffcd57`), police Nunito Sans.
5. **Edge functions** : `supabase/functions/<name>/index.ts`, Deno, CORS, auth check explicite (JWT user OU service role OU `x-cron-secret`).
6. **Migrations** : toute modif de schéma passe par un fichier `supabase/migrations/<timestamp>_<slug>.sql`.

## Carte du projet

```
src/
  pages/          # Routes (voir docs/routes.md)
  components/     # UI réutilisable + shadcn dans ui/
    courier/     # Composants spécifiques au domaine courrier
    workflow/    # Editeur de workflow (React Flow)
  services/       # Accès Supabase typé, 1 fichier par entité
  contexts/       # AuthContext + OrganizationContext
  integrations/supabase/  # client.ts (inject x-org-id) + types.ts (généré)
  lib/            # utils, permissions, tag-color
  hooks/          # hooks React partagés
supabase/
  functions/      # Edge functions Deno (voir docs/edge-functions.md)
  migrations/     # SQL versionné
.lovable/memory/  # Mémoire de l'agent Lovable (ne pas modifier sans raison)
docs/             # Documentation détaillée pour Claude Code (ce répertoire)
```

## Index docs/ — chargez à la demande

| Fichier | Quand l'ouvrir |
|---|---|
| `docs/data-model.md` | Schéma DB, RLS multi-tenant, conventions tables/colonnes. |
| `docs/features.md` | Détail des grandes fonctionnalités (courriers, workflows, IA, réponses, Arpège). |
| `docs/edge-functions.md` | Liste des 12 edge functions, leur rôle, leurs secrets. |
| `docs/routes.md` | Map URL → page → rôle requis. |
| `docs/conventions.md` | Style de code, design system, patterns récurrents. |
| `docs/security.md` | Modèle de sécurité, RLS, secrets, ce qui est public intentionnellement. |

## Commandes utiles

```bash
bun install            # installe les deps
bun run dev            # vite dev
bun run build          # build prod
bun run test           # vitest run
bun run lint           # eslint
```

## Ce qu'il ne faut PAS faire

- Ajouter du backend Node/Python dans le repo (uniquement edge functions Deno).
- Stocker un rôle dans `users` ou `profiles` (toujours `memberships` ou table dédiée).
- Faire confiance au client pour vérifier `is_superadmin` côté edge function — toujours re-vérifier serveur.
- Ouvrir tous les fichiers `docs/` "au cas où" : sélectionnez selon la tâche pour économiser les tokens.
