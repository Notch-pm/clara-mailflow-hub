# Project Memory

## Core
Clara — SaaS gestion courrier administratif, multi-tenant (organization_id).
Design: Notch palette (vert #0acf83 / jaune #ffcd57), Nunito Sans, Airbnb shadows.
DB tables existantes uniquement — aucune migration, aucune nouvelle table.
Toutes requêtes filtrées par organization_id. Services client-side Supabase.
RLS via header HTTP x-org-id (current_setting('request.header.x-org-id')).

## Memories
- [Data model constraints](mem://features/data-model) — Tables existantes et contraintes multi-tenant
- [Design system](mem://design/notch-palette) — Palette Notch, ombres Airbnb, compact mode
- [RLS pattern](mem://features/rls-pattern) — Isolation multi-tenant via request.header.x-org-id
