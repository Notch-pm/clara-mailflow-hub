# Clara Mailflow Hub

Clara est une solution SaaS de **gestion électronique de courrier (GEC)** pour collectivités publiques françaises. L'application centralise la réception, l'analyse, l'instruction, la réponse et la traçabilité des courriers — papier, emails, formulaires et autres sollicitations reprises par les agents — dans un contexte **multi-tenant strict**.

## Fonctionnalités principales

- **Réception des courriers** : saisie manuelle, import en masse, lecture automatique de boîtes IMAP et boîte dédiée à la numérisation.
- **Analyse assistée par IA** : OCR des pièces jointes, résumé, intentions, sentiment et actions suggérées via edge functions Supabase.
- **Instruction métier** : workflows configurables, affectation à une organisation Socle, tags, actions internes minimales, liens vers demandes partenaires, notes et historique d'événements.
- **Réponse** : brouillons assistés par IA, modèles, signature électronique et envoi SMTP.
- **Référentiels** : contacts/usagers, organisations, démarches et catégories synchronisés ou servis par le Socle.
- **Administration** : gestion multi-tenant, utilisateurs, rôles, paramètres d'organisation et intégrations.

## Stack technique

- **Frontend** : React 18, Vite 5, TypeScript, React Router, TanStack Query, Tailwind CSS et shadcn/ui.
- **Backend** : Supabase — Postgres, RLS, Auth, Storage, Edge Functions Deno et pg_cron.
- **IA** : **guichet du Socle** (`ai-api`) — complétions et OCR. Clara ne détient aucune clé de
  fournisseur ; le crédit est celui de la collectivité, commun à toute la gamme.
- **Tests** : Vitest, tests d'intégration Vitest et Playwright pour l'E2E.

## Prérequis

- [Bun](https://bun.sh/) pour installer les dépendances et lancer les scripts.
- Un projet Supabase configuré avec les migrations, edge functions et secrets attendus.
- Les variables d'environnement locales du frontend, à placer dans un fichier `.env` non versionné.

> Aucun secret ne doit être commité. Les clés service role, SMTP/IMAP, API Socle, IA et cron restent côté Supabase, CI ou environnement local sécurisé.

## Installation locale

```bash
bun install
```

Puis lancer le serveur de développement :

```bash
bun run dev
```

## Commandes utiles

| Commande | Usage |
|---|---|
| `bun run dev` | Lance le serveur Vite local. |
| `bun run build` | Produit le build de production. |
| `bun run build:dev` | Produit un build en mode développement. |
| `bun run lint` | Lance ESLint. |
| `bun run test` | Lance les tests unitaires Vitest. |
| `bun run test:integration` | Lance les tests d'intégration Vitest. |
| `bun run test:e2e` | Lance les tests Playwright. |
| `bun run audit` | Lance Knip pour l'audit de code mort. |

## Architecture du dépôt

```text
src/
  pages/                   # Pages routées par React Router
  components/              # UI réutilisable et composants métier
    courier/               # Composants du domaine courrier
    workflow/              # Éditeur de workflows
    ui/                    # Primitives shadcn/ui
  services/                # Accès Supabase typés, un fichier par domaine
  contexts/                # Contextes React globaux
  integrations/supabase/   # Client Supabase et types générés
  hooks/                   # Hooks React partagés
  lib/                     # Utilitaires métier et helpers
  test/                    # Tests unitaires
  test-integration/        # Tests d'intégration
supabase/
  functions/               # Edge functions Deno
  migrations/              # Migrations SQL versionnées
docs/                      # Documentation technique et opérationnelle
scripts/                   # Scripts d'audit, seed et outillage
```

## Documentation de référence

| Document | Contenu |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Guide court d'onboarding pour les agents et contributeurs techniques. |
| [`docs/product-user-flows.md`](docs/product-user-flows.md) | Vision produit, acteurs métier et parcours utilisateur critiques. |
| [`docs/conventions.md`](docs/conventions.md) | Conventions de code, React, Supabase, design system et sécurité. |
| [`docs/data-model.md`](docs/data-model.md) | Modèle de données, tables, storage et conventions de migration. |
| [`docs/database-rls.md`](docs/database-rls.md) | Policies RLS, helpers de sécurité et inventaire associé. |
| [`docs/security.md`](docs/security.md) | Modèle d'accès, secrets, buckets, edge functions et checklist sécurité. |
| [`docs/features.md`](docs/features.md) | Fonctionnalités métier et principaux flux applicatifs. |
| [`docs/edge-functions.md`](docs/edge-functions.md) | Liste des edge functions, auth, secrets et patterns. |
| [`docs/routes.md`](docs/routes.md) | Cartographie des routes et protections d'accès. |
| [`docs/deployment.md`](docs/deployment.md) | Procédure de déploiement et pièges connus des migrations Supabase. |
| [`docs/technical-debt.md`](docs/technical-debt.md) | Backlog de dette technique priorisé. |

## Sécurité et multi-tenant

Clara est multi-tenant : les données métier sont scopées par `organization_id`, et les accès sont contrôlés par les policies RLS Supabase via les helpers `is_member_of`, `is_admin_of` et `is_superadmin`.

Règles importantes :

- Filtrer explicitement les requêtes client par `organization_id`, même lorsque la RLS protège déjà l'accès.
- Ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` ni aucun secret côté client.
- Les rôles d'organisation vivent dans `organization_users`; `users.is_superadmin` est le seul rôle global.
- Le header `x-org-id` sert à contextualiser certaines edge functions, mais les policies RLS ne doivent pas lui faire confiance.
- Toute edge function doit vérifier l'authentification et l'organisation cible côté serveur.

## Déploiement Supabase

Lire [`docs/deployment.md`](docs/deployment.md) avant toute migration. Le registre local des migrations n'est pas toujours fiable dans ce projet : la base live fait foi et les migrations doivent rester rejouables/idempotentes.

Points d'attention :

- Ne pas utiliser `supabase db push` sans revue du contexte de dérive documenté.
- Vérifier les objets live avant de conclure qu'une migration est déjà appliquée.
- Déployer les migrations, edge functions, cron et frontend dans l'ordre documenté.

## Contribution

Avant de proposer une modification :

1. Lire les conventions adaptées au périmètre modifié.
2. Respecter le modèle multi-tenant et les règles RLS.
3. Ajouter ou mettre à jour la documentation concernée.
4. Exécuter au minimum les tests pertinents (`bun run test`, puis intégration/E2E selon l'impact).
5. Pour toute nouvelle table, route, edge function ou migration, mettre à jour les documents de référence correspondants.
