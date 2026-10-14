-- Notification du viseur (suite du visa des réponses, 20261001140000).
--
-- Jusqu'ici, le viseur désigné découvrait la réponse à viser au tableau de
-- bord. Une réponse (ou un courrier à l'initiative) qui ENTRE dans une étape
-- de visa notifie désormais qui peut la viser — cloche, et push par
-- `notifications_push_queue` qui suit la cloche :
--
--   - le viseur désigné pour cette étape (metadata.visa_viseurs[state_id]),
--     s'il est toujours viseur habilité ;
--   - sinon, tous les viseurs habilités de l'organisation gestionnaire.
--
-- « Habilité » = la règle exacte de `courier_visas_validate` (rattachement
-- socle_organization_viseurs + organization_users.is_viseur + membre actif).
-- Elle coïncide avec la lecture d'un courrier CONFIDENTIEL
-- (`is_designated_on_courier`) : on ne notifie jamais quelqu'un qui ne pourrait
-- pas ouvrir la réponse ; `notifications_mask_confidential` masque l'objet.
--
-- Une désignation posée PENDANT l'étape (avant visa) notifie le nouveau désigné.
-- L'auteur du geste n'est jamais notifié de son propre geste.
-- En quittant l'étape, les notifications « à viser » de la réponse passent en
-- lues : il n'y a plus rien à viser.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.fn_notify_visa_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor       uuid := auth.uid();
  v_old_state   uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD.workflow_state_id END;
  v_entered     boolean;
  v_designated  text;
  v_old_desig   text;
  v_target      uuid;
BEGIN
  -- Sortie d'une étape de visa : plus rien à viser.
  IF v_old_state IS NOT NULL AND NEW.workflow_state_id IS DISTINCT FROM v_old_state THEN
    UPDATE public.notifications
       SET read = true
     WHERE resource_id = NEW.id
       AND type = 'visa_requested'
       AND read = false;
  END IF;

  IF NEW.deleted_at IS NOT NULL OR NEW.workflow_state_id IS NULL OR NEW.socle_organization_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_states ws
    WHERE ws.id = NEW.workflow_state_id AND ws.requires_visa
  ) THEN
    RETURN NULL;
  END IF;

  v_entered := NEW.workflow_state_id IS DISTINCT FROM v_old_state;
  v_designated := NULLIF(NEW.metadata #>> ARRAY['visa_viseurs', NEW.workflow_state_id::text], '');

  IF NOT v_entered THEN
    -- Même étape : seule une nouvelle désignation, avant visa, notifie.
    v_old_desig := NULLIF(OLD.metadata #>> ARRAY['visa_viseurs', NEW.workflow_state_id::text], '');
    IF v_designated IS NULL OR v_designated IS NOT DISTINCT FROM v_old_desig THEN
      RETURN NULL;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.courier_visas cv
      WHERE cv.courier_id = NEW.id
        AND cv.workflow_state_id = NEW.workflow_state_id
        AND cv.superseded_at IS NULL
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  IF v_designated ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_target := v_designated::uuid;
  END IF;

  INSERT INTO public.notifications (organization_id, user_id, type, title, resource_id)
  SELECT NEW.organization_id, v.user_id, 'visa_requested',
         'À viser : ' || COALESCE(NULLIF(btrim(NEW.subject), ''), 'Réponse'),
         NEW.id
  FROM public.socle_organization_viseurs v
  JOIN public.organization_users ou
    ON ou.user_id = v.user_id AND ou.organization_id = v.organization_id
  WHERE v.organization_id = NEW.organization_id
    AND v.socle_organization_id = NEW.socle_organization_id
    AND ou.is_viseur
    AND COALESCE(ou.is_active, true)
    AND v.user_id IS DISTINCT FROM v_actor
    -- Le désigné s'il est habilité ; sinon (aucun, ou plus habilité) tous.
    AND (
      v_target IS NULL
      OR v.user_id = v_target
      OR NOT EXISTS (
        SELECT 1 FROM public.socle_organization_viseurs v2
        JOIN public.organization_users ou2
          ON ou2.user_id = v2.user_id AND ou2.organization_id = v2.organization_id
        WHERE v2.user_id = v_target
          AND v2.organization_id = NEW.organization_id
          AND v2.socle_organization_id = NEW.socle_organization_id
          AND ou2.is_viseur
          AND COALESCE(ou2.is_active, true)
      )
    )
    -- Pas de doublon non lu pour la même réponse.
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.resource_id = NEW.id
        AND n.user_id = v.user_id
        AND n.type = 'visa_requested'
        AND n.read = false
    );

  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_notify_visa_requested() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_visa_requested ON public.couriers;
CREATE TRIGGER trg_notify_visa_requested
  AFTER INSERT OR UPDATE OF workflow_state_id, metadata ON public.couriers
  FOR EACH ROW
  WHEN (NEW.direction = 'outbound')
  EXECUTE FUNCTION public.fn_notify_visa_requested();
