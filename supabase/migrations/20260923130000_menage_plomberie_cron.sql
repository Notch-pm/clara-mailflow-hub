-- Versionne les deux jobs de ménage posés en direct (`execute_sql`) lors de l'incident
-- mémoire du 2026-09-22 (docs/deployment.md, lot « alerte mémoire », étape 3 — jobid 10
-- et 11). Sans ce fichier, toute base reconstruite depuis les migrations (staging, reprise
-- après sinistre) reproduirait l'incident : `cron.job_run_details` 112 417 lignes jamais
-- purgées, `net._http_response` 82 Mo de tas pour 252 lignes.
--
-- `ALTER TABLE net._http_response SET (autovacuum_*)` est refusé (le schéma `net`
-- appartient à `supabase_admin`), d'où le VACUUM planifié explicite.
--
-- Rejouable : `cron.schedule` sur un nom existant met à jour la commande — sur la base
-- live, les jobs 10 et 11 sont conservés à l'identique.

SELECT cron.schedule(
  'purge-cron-history',
  '15 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);

SELECT cron.schedule(
  'vacuum-net-http-response',
  '45 3 * * *',
  $$ vacuum (analyze) net._http_response $$
);
