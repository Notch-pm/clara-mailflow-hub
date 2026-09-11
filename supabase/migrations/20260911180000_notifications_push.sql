-- ============================================================================
-- Notifications — second canal : le PUSH sur appareil (Web Push / VAPID).
--
-- La cloche ne sonne que si l'agent a Clara ouverte. Un courrier qui arrive à
-- 17 h 50, une action qu'on vous affecte pendant une réunion : personne ne
-- l'apprend avant le lendemain. Le push met la même information sur l'écran
-- verrouillé, application fermée comprise.
--
-- Trois principes, repris du connecteur éprouvé d'Iris (`20260915100000`) :
--
-- 1. **Le push SUIT la cloche.** Aucun réglage par type d'événement : ce qui
--    apparaît dans `notifications` part sur les appareils inscrits. Le seul
--    réglage est PAR APPAREIL — un abonnement existe ou n'existe pas.
--    ⚠️ Conséquence à connaître : `new_courier` est un fan-out vers TOUS les
--    membres actifs de l'organisation (`fn_create_courier_notifications`). Une
--    collectivité qui reçoit trente courriers par jour fera vibrer trente fois
--    tous les téléphones inscrits. Si cela se révèle trop bruyant, la règle
--    vit dans `notifications_push_queue()` ci-dessous — UN endroit à changer,
--    pas huit sites d'insertion.
--
-- 2. **Un événement, une ligne, N canaux** : le push s'ajoute en colonnes
--    `push_*` sur `notifications`. Leur valeur initiale est décidée par un
--    trigger BEFORE INSERT, jamais par le producteur — le trigger de courrier
--    entrant, l'insertion cliente de `useCourierWorkspace` (transfert) et
--    l'edge function `send-assignment-notification` n'ont rien à savoir.
--
-- 3. **L'envoi ne part jamais du déclencheur.** Un appel réseau dans la
--    transaction métier la ferait traîner et la ferait échouer quand un
--    service de push tousse — on n'annule pas l'arrivée d'un courrier pour
--    autant. La ligne est une boîte d'envoi que draine l'edge function
--    `notifications-push` sur pg_cron, avec réclamation atomique, reprise
--    temporisée et abandon franc au bout de 5 tentatives.
--
-- L'abonnement (`push_subscriptions`) est l'adresse d'un APPAREIL, pas d'un
-- compte : sur un poste partagé d'accueil, le navigateur rend le même endpoint
-- au titulaire suivant. D'où l'enregistrement par RPC qui REPREND la ligne
-- (`on conflict (endpoint) do update set user_id = auth.uid()`) — un `insert`
-- client borné à `user_id = auth.uid()` ne le pourrait pas, et une clé
-- (user_id, endpoint) ferait recevoir à l'agent du guichet les notifications
-- de son collègue de la veille.
--
-- ⚠️ Règle d'or n°1 (tout est scopé par `organization_id`) : `push_subscriptions`
-- ne l'est délibérément PAS. Un téléphone appartient à un COMPTE, pas à une
-- collectivité, et un agent rattaché à deux organisations ne va pas inscrire
-- son téléphone deux fois. Le cloisonnement reste porté par `notifications`,
-- qui est bien scopée : on ne pousse jamais que des lignes déjà filtrées.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Abonnements : un par appareil (endpoint du service de push du navigateur)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- URL rendue par le navigateur (FCM, Mozilla, Apple…) : identifie l'appareil.
  endpoint        TEXT        NOT NULL UNIQUE,
  -- Clé publique ECDH et sel d'authentification de l'abonnement (RFC 8291).
  -- Publics par construction : ils servent à CHIFFRER vers l'appareil.
  p256dh          TEXT        NOT NULL,
  auth            TEXT        NOT NULL,
  -- Libellé dérivé du User-Agent (« Android · Chrome »), pour l'affichage seul.
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Posé par le facteur quand le service de push répond 404/410 : l'appareil a
  -- retiré son abonnement (désinstallation, permission révoquée).
  disabled_at     TIMESTAMPTZ,
  disabled_reason TEXT
);

COMMENT ON TABLE public.push_subscriptions IS
  'Abonnements Web Push, UN PAR APPAREIL. L''endpoint est l''adresse de l''appareil, pas un secret ; p256dh/auth sont la clé publique et le sel de chiffrement vers cet appareil. Enregistrement par la RPC register_push_subscription (reprise d''un endpoint par son nouveau titulaire) ; lecture, last_seen_at et suppression en direct sous RLS. Non scopée par organisation : un appareil appartient à un compte.';
COMMENT ON COLUMN public.push_subscriptions.disabled_at IS
  'Désactivé par le facteur sur 404/410 du service de push (abonnement retiré côté appareil). Une ligne désactivée ne compte plus comme appareil actif ; un nouvel enregistrement la réactive.';

CREATE INDEX IF NOT EXISTS push_subscriptions_user_active_idx
  ON public.push_subscriptions (user_id) WHERE disabled_at IS NULL;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Ses lignes seulement. Pas de policy INSERT cliente : l'enregistrement passe
-- par la RPC, seule à pouvoir reprendre un endpoint (cf. en-tête).
DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS push_subscriptions_service ON public.push_subscriptions;
CREATE POLICY push_subscriptions_service ON public.push_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enregistrement (ou reprise) d'un appareil par le compte connecté.
CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT, p_user_agent TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_id   UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'register_push_subscription : session absente' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_endpoint, '') !~ '^https://' OR length(p_endpoint) > 2048 THEN
    RAISE EXCEPTION 'register_push_subscription : endpoint invalide' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_p256dh, '') = '' OR length(p_p256dh) > 512
     OR COALESCE(p_auth, '') = '' OR length(p_auth) > 512 THEN
    RAISE EXCEPTION 'register_push_subscription : clés d''abonnement invalides' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  ON CONFLICT (endpoint) DO UPDATE
     SET user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         disabled_at = NULL,
         disabled_reason = NULL,
         last_seen_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
COMMENT ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT, TEXT) IS
  'Enregistre l''abonnement push de CET appareil pour le compte connecté. Un endpoint déjà connu est REPRIS (nouveau titulaire sur un poste partagé) et réactivé. Seule porte d''écriture : la table n''a pas de policy INSERT cliente.';
REVOKE EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. État du canal push sur la notification
-- ----------------------------------------------------------------------------

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS push_status TEXT NOT NULL DEFAULT 'skipped',
  ADD COLUMN IF NOT EXISTS push_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS push_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_push_status_check') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_push_status_check
      CHECK (push_status IN ('pending','sending','sent','skipped','failed'));
  END IF;
END
$$;

COMMENT ON COLUMN public.notifications.push_status IS
  'Boîte d''envoi push : pending (à pousser) · sending (réclamée par le facteur) · sent · skipped (aucun appareil actif, ou lue avant l''envoi) · failed (abandon après 5 tentatives). Valeur initiale décidée par trg_notifications_push_queue, jamais par le producteur.';

CREATE INDEX IF NOT EXISTS notifications_push_queue_idx
  ON public.notifications (push_next_attempt_at NULLS FIRST, created_at)
  WHERE push_status IN ('pending','sending');

-- ----------------------------------------------------------------------------
-- 3. Décision à l'insertion : une règle, tous les producteurs
-- ----------------------------------------------------------------------------

-- ⚠️ Un producteur qui poserait `push_status` explicitement serait écrasé :
-- c'est voulu, la règle vit ici et nulle part ailleurs.
CREATE OR REPLACE FUNCTION public.notifications_push_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.push_subscriptions s
              WHERE s.user_id = NEW.user_id AND s.disabled_at IS NULL) THEN
    NEW.push_status := 'pending';
  ELSE
    NEW.push_status := 'skipped';
  END IF;
  NEW.push_next_attempt_at := NULL;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notifications_push_queue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_push_queue ON public.notifications;
CREATE TRIGGER trg_notifications_push_queue
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_push_queue();

-- ----------------------------------------------------------------------------
-- 4. Boîte d'envoi : réclamation atomique, règlement, renoncement
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notification_push_max_attempts()
RETURNS INT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 5 $$;
REVOKE EXECUTE ON FUNCTION public.notification_push_max_attempts() FROM PUBLIC, anon, authenticated;

-- Avant de réclamer, deux renoncements sans appel réseau :
--   · une ligne déjà LUE dans la cloche ne mérite plus un push — et Clara en
--     marque en masse (`fn_mark_courier_notifications_read` quand le courrier
--     quitte la catégorie « à traiter »), donc le cas est fréquent ;
--   · un destinataire sans appareil actif n'en recevra pas.
-- Puis réclamation atomique (`for update skip locked`) avec reprise des lignes
-- 'sending' figées depuis 15 min, et les abonnements actifs du destinataire
-- agrégés en JSON — le facteur n'a rien d'autre à relire.
DROP FUNCTION IF EXISTS public.claim_notification_pushes(INT);
CREATE OR REPLACE FUNCTION public.claim_notification_pushes(p_limit INT DEFAULT 50)
RETURNS TABLE (
  notification_id   UUID,
  organization_id   UUID,
  organization_name TEXT,
  type              TEXT,
  title             TEXT,
  resource_id       UUID,
  attempts          INT,
  subscriptions     JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.notifications n
     SET push_status = 'skipped', push_error = 'lue avant envoi', push_next_attempt_at = NULL
   WHERE n.push_status = 'pending' AND n.read;

  UPDATE public.notifications n
     SET push_status = 'skipped', push_error = 'aucun appareil actif', push_next_attempt_at = NULL
   WHERE n.push_status = 'pending'
     AND NOT EXISTS (SELECT 1 FROM public.push_subscriptions s
                      WHERE s.user_id = n.user_id AND s.disabled_at IS NULL);

  RETURN QUERY
  WITH due AS (
    SELECT n.id FROM public.notifications n
     WHERE (n.push_status = 'pending'
            AND (n.push_next_attempt_at IS NULL OR n.push_next_attempt_at <= now()))
        OR (n.push_status = 'sending'
            AND n.push_attempted_at IS NOT NULL
            AND n.push_attempted_at < now() - interval '15 minutes')
     ORDER BY n.created_at
     LIMIT greatest(1, least(COALESCE(p_limit, 50), 200))
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.notifications n
       SET push_status = 'sending',
           push_attempts = n.push_attempts + 1,
           push_attempted_at = now()
     WHERE n.id IN (SELECT id FROM due)
    RETURNING n.id, n.organization_id, n.type, n.title, n.resource_id,
              n.user_id, n.push_attempts
  )
  SELECT c.id, c.organization_id, o.name, c.type, c.title, c.resource_id, c.push_attempts,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                     FROM public.push_subscriptions s
                    WHERE s.user_id = c.user_id AND s.disabled_at IS NULL), '[]'::jsonb)
    FROM claimed c
    JOIN public.organizations o ON o.id = c.organization_id;
END;
$$;
COMMENT ON FUNCTION public.claim_notification_pushes(INT) IS
  'Réclame un lot de notifications à pousser et le marque ''sending'' atomiquement, avec les abonnements actifs du destinataire en JSON. Renonce d''abord aux lignes lues et à celles sans appareil. service_role uniquement.';
REVOKE EXECUTE ON FUNCTION public.claim_notification_pushes(INT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.settle_notification_push(
  p_id UUID, p_ok BOOLEAN, p_error TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts INT;
BEGIN
  IF p_ok THEN
    UPDATE public.notifications
       SET push_status = 'sent', push_sent_at = now(),
           push_next_attempt_at = NULL, push_error = NULL
     WHERE id = p_id;
    RETURN;
  END IF;

  SELECT push_attempts INTO v_attempts FROM public.notifications WHERE id = p_id;
  IF v_attempts IS NULL THEN RETURN; END IF;

  IF v_attempts >= public.notification_push_max_attempts() THEN
    UPDATE public.notifications
       SET push_status = 'failed', push_error = left(COALESCE(p_error, 'inconnue'), 500),
           push_next_attempt_at = NULL
     WHERE id = p_id;
  ELSE
    UPDATE public.notifications
       SET push_status = 'pending', push_error = left(COALESCE(p_error, 'inconnue'), 500),
           push_next_attempt_at = now() + (interval '1 minute' * power(2, v_attempts))
     WHERE id = p_id;
  END IF;
END;
$$;
COMMENT ON FUNCTION public.settle_notification_push(UUID, BOOLEAN, TEXT) IS
  'Règle un push : succès (au moins un appareil servi) → ''sent'' ; échec → retour en file avec temporisation croissante, puis ''failed'' au-delà de 5 tentatives. service_role uniquement.';
REVOKE EXECUTE ON FUNCTION public.settle_notification_push(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;

-- Le service de push a répondu 404/410 : l'appareil n'écoute plus.
CREATE OR REPLACE FUNCTION public.disable_push_subscription(p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.push_subscriptions
     SET disabled_at = now(), disabled_reason = left(COALESCE(p_reason, ''), 200)
   WHERE id = p_id AND disabled_at IS NULL;
$$;
COMMENT ON FUNCTION public.disable_push_subscription(UUID, TEXT) IS
  'Désactive un abonnement dont le service de push a signifié la disparition (404/410). service_role uniquement.';
REVOKE EXECUTE ON FUNCTION public.disable_push_subscription(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Cron — drainage de la file toutes les minutes.
--
-- ⚠️ Cette section doit passer APRÈS le déploiement de l'edge function
-- `notifications-push` (cf. docs/deployment.md, « la migration qui planifie un
-- cron passe en dernier »). Avant, l'appel répond 404 : inoffensif, mais la
-- file s'accumule sans que rien ne le dise.
--
-- Motif Clara : une fonction SECURITY DEFINER qui lit le secret au Vault, car
-- pg_cron n'envoie aucun en-tête Authorization (d'où aussi l'entrée
-- `verify_jwt = false` dans supabase/config.toml).
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_notifications_push()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  SELECT net.http_post(
    url     := 'https://aullweizxcjbvtdspjli.supabase.co/functions/v1/notifications-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body    := '{}'::jsonb
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

COMMENT ON FUNCTION public.trigger_notifications_push() IS
  'Draine la boîte d''envoi push des notifications (edge function notifications-push) — appelée par pg_cron chaque minute.';

REVOKE EXECUTE ON FUNCTION public.trigger_notifications_push() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('notifications-push-every-min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notifications-push-every-min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'notifications-push-every-min',
  '* * * * *',
  $$ SELECT public.trigger_notifications_push(); $$
);
