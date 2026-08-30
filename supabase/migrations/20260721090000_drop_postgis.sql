-- Retrait de PostGIS. La feature quartiers a été démontée le 2026-07-16
-- (migration 20260716200000_socle_contacts_referentiel.sql) et aucune table
-- métier ne porte plus de geometry/geography. L'extension traînait dans
-- public, exposant spatial_ref_sys sans RLS (advisor 0013) et
-- st_estimatedextent SECURITY DEFINER exécutable par anon/authenticated
-- (advisors 0028/0029). Supprimer l'extension éteint la source.
--
-- CASCADE : par sécurité — vérifié préalablement qu'aucun objet
-- non-extension ne dépendait de postgis (pg_depend deptype 'n'/'a' vide).

DROP EXTENSION IF EXISTS postgis CASCADE;
