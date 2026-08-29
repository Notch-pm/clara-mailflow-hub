# Clara — Guide Claude Code

> **Lisez ce fichier en premier.** Il est court par design. Les détails sont dans `docs/` — n'ouvrez un fichier que si la tâche le concerne.

## Pitch produit

**Clara** est une solution SaaS de **gestion électronique de courrier (GEC)** pour collectivités publiques françaises. Elle permet de :

- **Recevoir** des courriers (papier, emails, formulaires et autres sollicitations ressaisies par les agents) via saisie manuelle, import en masse, IMAP ou boîte de numérisation.
- **Analyser** chaque courrier (OCR des pièces jointes + LLM) **via le guichet IA du Socle** : résumé, intentions, sentiment, actions suggérées.
- **Traiter** via workflows configurables (états + transitions), tags, assignation à une **organisation** (hiérarchie synchronisée depuis le Socle — les organisations remplacent les anciens « services »), actions internes minimales. Une action fondée sur une **démarche du référentiel** est déposée dans **Iris**, propriétaire exclusif des demandes d’usagers — les « demandes libres » restent dans Clara ; les démarches partenaires (Arpège) gardent leur connecteur.
- **Répondre** : brouillon généré par IA, signature électronique (image), envoi via le serveur d’envoi (SMTP) de l’organisation — **défini dans le Socle**, dont Clara ne tient qu’un miroir rafraîchi par la sync (plus aucune saisie SMTP dans Clara).
- **Tracer** : historique d'événements, notes, liens entre courriers, références séquentielles annuelles.
- **Référentiels** : contacts/usagers (servis par l’API du **Socle** — aucune identité stockée dans Clara, seulement des références `socle_contact_id`), signataires, modèles, démarches (sync nocturne depuis le Socle — plus de paramétrage des démarches dans Clara).

Multi-tenant strict : toute donnée est scopée par `organization_id`. Repo (privé) : <https://github.com/Notch-pm/clara-mailflow-hub>.

## Stack (résumé)

- **Frontend** : React 18 + Vite 5 + TypeScript + Tailwind + shadcn/ui + React Router + TanStack Query.
- **Backend** : Supabase (Postgres + RLS + Auth + Storage + Edge Functions Deno + pg_cron).
- **IA** : **guichet du Socle** (edge function `ai-api`) depuis le 2026-08-29 — Clara n'a plus de
  clé de fournisseur et ne compte plus les jetons. Voir la règle d'or n°7.
- **Tests** : Vitest.

## Règles d'or (à ne jamais violer)

1. **Multi-tenant** : toute requête DB filtre par `organization_id`. La RLS repose sur les helpers `is_member_of` / `is_admin_of` / `is_superadmin` ; le header `x-org-id` ne sert qu’à contextualiser certaines edge functions (voir `docs/data-model.md`).
2. **Rôles** : `is_superadmin` (global) sur `public.users` ; rôle d'org dans `organization_users` parmi `administrateur`, `gestionnaire`, `elu`, `superviseur`, `consultant` (legacy `admin` = `administrateur`). L'attribut `is_signataire` (droit de signer une réponse) est **indépendant** du rôle. Détail des droits par rôle : `docs/permissions.md`. Ne **jamais** stocker un rôle ailleurs. Pas d'escalade côté client.
3. **Services côté client** : un fichier par domaine dans `src/services/`, retourne du typé `Database["public"]...`. Pas de logique métier dans les composants.
4. **Design system** : tokens sémantiques HSL dans `src/index.css` + `tailwind.config.ts`. Pas de couleurs hardcodées dans les composants. Palette Notch (vert `#0acf83`, jaune `#ffcd57`), police Nunito Sans.
5. **Edge functions** : `supabase/functions/<name>/index.ts`, Deno, CORS, auth check explicite (JWT user OU service role OU `x-cron-secret`).
6. **Migrations** : toute modif de schéma passe par un fichier `supabase/migrations/<timestamp>_<slug>.sql`.
7. **IA : jamais de fournisseur en direct.** Tout appel LLM ou OCR passe par
   `_shared/socleAi.ts` → guichet du Socle (`ai-api`), qui détient la clé et compte les jetons pour
   toute la gamme. Un `fetch("https://api.mistral.ai/…")` rouvrirait un **second compteur** : le
   total par collectivité redeviendrait faux, sans que rien n'échoue visiblement. Clara ne stocke
   plus ni plafond, ni compteur, ni nombre de jetons (tables `ai_usage_*` supprimées le
   2026-08-29). Un test de non-régression scanne `supabase/functions/` (`src/test/socle/socle-ai.test.ts`).

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
| `docs/product-user-flows.md` | Vision métier, acteurs, parcours critiques et frontière Clara/Iris/partenaires. |
| `docs/data-model.md` | Schéma DB, RLS multi-tenant, conventions tables/colonnes. |
| `docs/features.md` | Détail des grandes fonctionnalités (courriers, workflows, IA, réponses, Arpège). |
| `docs/edge-functions.md` | Liste des edge functions, leur rôle, leurs secrets. |
| `docs/iris-integration.md` | Connecteur Iris : dépôt des demandes fondées sur une démarche, suivi de leur état. |
| `docs/routes.md` | Map URL → page → rôle requis. |
| `docs/conventions.md` | Style de code, design system, patterns récurrents. |
| `docs/security.md` | Modèle de sécurité, RLS, secrets, ce qui est public intentionnellement. |
| `docs/deployment.md` | Ordre de déploiement, pièges `config.toml`/cron, **dérive du registre de migrations**. À lire avant toute migration. |

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
- Stocker un rôle d’organisation dans `users` ou `profiles` (toujours `organization_users` ; seul `users.is_superadmin` est global).
- Faire confiance au client pour vérifier `is_superadmin` côté edge function — toujours re-vérifier serveur.
- Ouvrir tous les fichiers `docs/` "au cas où" : sélectionnez selon la tâche pour économiser les tokens.
