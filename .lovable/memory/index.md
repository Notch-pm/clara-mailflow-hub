# Project Memory

## Core
Clara — SaaS gestion courrier administratif, multi-tenant (organization_id).
Design: Notch palette (vert #0acf83 / jaune #ffcd57), Nunito Sans, Airbnb shadows.
Toutes requêtes filtrées par organization_id. Services client-side Supabase.
Nouvelles tables OK si justifiées (ex. procedures), avec RLS x-org-id stricte.

## Memories
- [Data model constraints](mem://features/data-model) — Tables existantes et contraintes multi-tenant
- [Design system](mem://design/notch-palette) — Palette Notch, ombres Airbnb, compact mode
- [Démarches & cron Arpège](mem://features/procedures-arpege) — Table procedures + sync nocturne 02:00 UTC
