-- Index de tri pour la liste des courriers.
--
-- getCouriers() trie par created_at décroissant (src/services/courierService.ts).
-- Il existait déjà un index (organization_id, received_at DESC) mais aucun sur
-- created_at : le planificateur retombait sur un Seq Scan de tout le tenant
-- suivi d'un tri, à chaque chargement de page.
--
-- Mesuré sur ACCM à 5 061 courriers :
--   ORDER BY received_at DESC  → Index Scan, 0,25 ms, 25 buffers
--   ORDER BY created_at  DESC  → Seq Scan + tri, 5,8 ms, 519 buffers
-- Le coût croît linéairement avec la taille du tenant.
--
-- created_at est NOT NULL (DEFAULT now()), donc la question NULLS FIRST/LAST ne
-- se pose pas ici — l'index DESC couvre le tri émis par PostgREST.

create index if not exists idx_couriers_org_created_at
  on public.couriers (organization_id, created_at desc);
