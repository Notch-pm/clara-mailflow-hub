# Memory: index.md
Updated: now

# Project Memory

## Core
Clara — SaaS gestion courrier administratif, multi-tenant (organization_id).
Design: Notch palette (vert #0acf83 / jaune #ffcd57), Nunito Sans, Airbnb shadows.
Toutes requêtes filtrées par organization_id. Services client-side Supabase.
Super admin (is_superadmin on users) → layout dédié /superadmin avec gestion orgs + SMTP.
Auth emails via SMTP custom par organisation (auth-email-hook edge function).

## Memories
- [Data model constraints](mem://features/data-model) — Tables existantes et contraintes multi-tenant
- [Design system](mem://design/notch-palette) — Palette Notch, ombres Airbnb, compact mode
