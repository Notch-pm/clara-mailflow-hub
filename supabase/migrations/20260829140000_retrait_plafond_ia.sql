-- ============================================================================
-- Retrait du plafond IA de Clara — défait 20260616210000, 20260616210100 et
-- 20260617090000.
--
-- ⚠️ UNE MIGRATION, PAS UN ROLLBACK, et la distinction n'est pas cosmétique.
-- La suppression est le geste VOULU : le plafond de Clara laisse la place à
-- celui du Socle. Un lecteur futur doit voir la création PUIS le retrait —
-- les cacher lui ferait chercher pendant une heure pourquoi trois tables
-- documentées sont absentes.
--
-- POURQUOI CE RETRAIT. Depuis le 2026-08-29, la clé du fournisseur LLM et la
-- comptabilité des jetons vivent dans le SOCLE (edge function `ai-api`) :
-- Clara compose ses prompts et les confie au guichet, qui réserve, appelle et
-- solde. Le plafond est désormais celui de la COLLECTIVITÉ, commun à toute la
-- gamme (Clara, Iris, Ariane) — Clara n'en voit qu'une part et ne peut donc
-- plus en être le comptable. Iris a fait la même bascule le même jour
-- (`20260829120000_retrait_plafond_ia.sql` dans son dépôt).
--
-- ⚠️ CE QUI RESTERAIT SI ON LAISSAIT CES TABLES EN PLACE n'est pas « du code
-- mort », c'est un SECOND COMPTEUR. Un jour quelqu'un lirait
-- `ai_usage_counters`, y verrait zéro pour le mois en cours, et en conclurait
-- que la collectivité n'a rien consommé — alors qu'elle aurait dépensé son
-- mois via le Socle. Un chiffre faux est pire qu'un chiffre absent : on ne se
-- méfie pas d'un tableau qui s'affiche.
--
-- ⚠️ POURQUOI CE SCRIPT NE PROTÈGE PAS LE JOURNAL, ALORS QUE CELUI D'IRIS LE
-- FAISAIT. La migration jumelle d'Iris refuse de s'exécuter si `ai_usage_events`
-- contient la moindre ligne : une consommation enregistrée est une pièce
-- comptable, et l'effacer au passage serait une faute. Le garde-fou n'a pas été
-- oublié ici — il a été LEVÉ, sciemment, et voici sur quoi.
--
-- Décision du 2026-08-29, prise en connaissance du contenu de la table : les
-- lignes présentes dans `ai_usage_events` sont des **essais de recette**, pas
-- de la consommation facturable. Aucune facturation, aucun rapport et aucun
-- engagement client n'en dépend. Il n'y a donc rien à reprendre : ni export à
-- archiver, ni report dans le journal du Socle.
--
-- ⚠️ CE QUE CETTE DÉCISION NE COUVRE PAS. Elle porte sur ce qui existait AVANT
-- la bascule, et sur rien d'autre. Si ce script devait un jour être rejoué sur
-- une base où de la consommation réelle a été enregistrée — restauration d'une
-- sauvegarde antérieure, environnement dérivé — la décision ci-dessus ne
-- s'appliquerait plus, et il faudrait exporter avant de supprimer :
--
--   COPY (SELECT * FROM public.ai_usage_events) TO STDOUT WITH CSV HEADER;
--
-- C'est la raison pour laquelle l'étape 0 COMPTE ET ANNONCE ce qu'elle détruit
-- au lieu de le faire en silence : la trace du volume supprimé reste dans la
-- sortie du déploiement, à défaut de rester en base.
--
-- ⚠️ Le journal du Socle ne reprend rien rétroactivement : il commence à la
-- bascule. La consommation d'avant n'existera nulle part, et c'est assumé —
-- c'était de la recette.
--
-- ⚠️ pg_cron RESTE INSTALLÉ : d'autres jobs de Clara en dépendent
-- (`process-analysis-queue`, `fetch-inbound-emails`, `sync-socle-referentiel`).
-- Seul le job `release-stale-ai-reservations-every-5min` est déprogrammé.
--
-- ⚠️ REGISTRE DE MIGRATIONS NON FIABLE (voir `docs/deployment.md`) : ce script
-- est REJOUABLE. Chaque `drop` porte son `if exists`, et la vérification finale
-- passe aussi bien sur une base déjà nettoyée.
--
-- Après exécution : régénérer `src/integrations/supabase/types.ts`, sans quoi
-- le typage annonce trois tables et trois RPC qui n'existent plus.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Ce que l'on détruit, dit à voix haute
--
-- Aucun refus (voir l'en-tête : décision du 2026-08-29, essais de recette).
-- Mais le volume part dans la sortie du déploiement : c'est la seule trace qui
-- subsistera de ce qui a été effacé, et elle ne coûte rien.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_events bigint := 0;
  v_tokens bigint := 0;
BEGIN
  -- `to_regclass` d'abord : sur une base déjà nettoyée, interroger la table
  -- lèverait une erreur et rendrait le script non rejouable.
  IF to_regclass('public.ai_usage_events') IS NOT NULL THEN
    EXECUTE 'SELECT count(*), coalesce(sum(coalesce(actual_tokens, estimated_tokens)), 0)
               FROM public.ai_usage_events'
       INTO v_events, v_tokens;
  END IF;

  IF v_events = 0 THEN
    RAISE NOTICE 'Journal IA local : déjà vide, rien à supprimer.';
  ELSE
    RAISE NOTICE
      'Journal IA local supprimé : % événement(s), % jeton(s) cumulés — essais de recette, décision du 2026-08-29 (voir l''en-tête de ce fichier).',
      v_events, v_tokens;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Le job planifié (migration 20260616210100)
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('release-stale-ai-reservations-every-5min')
 WHERE EXISTS (
   SELECT 1 FROM cron.job WHERE jobname = 'release-stale-ai-reservations-every-5min'
 );

-- ---------------------------------------------------------------------------
-- 2. Les RPC (migrations 20260616210100 et 20260617090000)
--
-- Signatures explicites : un `DROP FUNCTION` sans arguments échoue dès qu'une
-- surcharge existe, et laisserait le script à moitié appliqué. La sentinelle
-- (20260617090000) a REMPLACÉ les deux premières par `CREATE OR REPLACE` sans
-- changer leur signature — il n'y a donc qu'une version de chacune à retirer.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.reserve_ai_usage(uuid, text, text, bigint, uuid);
DROP FUNCTION IF EXISTS public.settle_ai_usage(uuid, bigint, text);
DROP FUNCTION IF EXISTS public.release_stale_ai_reservations(int);

-- ---------------------------------------------------------------------------
-- 3. Les tables (migration 20260616210000)
--
-- `CASCADE` emporte policies, index et contraintes. L'ordre suit les
-- dépendances : le journal d'abord, le plafond en dernier.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.ai_usage_events CASCADE;
DROP TABLE IF EXISTS public.ai_usage_counters CASCADE;
DROP TABLE IF EXISTS public.ai_usage_quotas CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Vérification — le script échoue s'il reste quoi que ce soit.
--
-- Un retrait à moitié appliqué est le pire des états : il laisse croire que
-- c'est fait. On le fait donc dire à voix haute.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_reste text;
BEGIN
  SELECT string_agg(nom, ', ') INTO v_reste
    FROM (
      SELECT unnest(ARRAY['ai_usage_quotas', 'ai_usage_counters', 'ai_usage_events']) AS nom
    ) t
   WHERE to_regclass('public.' || nom) IS NOT NULL;
  IF v_reste IS NOT NULL THEN
    RAISE EXCEPTION 'Tables encore présentes : %', v_reste;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE '%ai_usage%' OR p.proname = 'release_stale_ai_reservations')
  ) THEN
    RAISE EXCEPTION 'Des fonctions de plafond IA subsistent.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'release-stale-ai-reservations-every-5min'
  ) THEN
    RAISE EXCEPTION 'Le job cron est encore programmé.';
  END IF;

  RAISE NOTICE 'Retrait du plafond IA de Clara : terminé. Régénérer src/integrations/supabase/types.ts.';
END $$;
