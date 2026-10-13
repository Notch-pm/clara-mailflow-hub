-- Écran « Courriers sortants » classé par état (2026-10-13).
--
-- Une ligne par sortant, avec ce qu'il faut pour le ranger côté client
-- (`src/lib/outbox.ts`) : drapeaux de l'état, signature, envoi (courriel ou
-- posté), destinataire, depuis quand il attend dans son état. Calquée sur
-- `mailroom_couriers` : SECURITY DEFINER gardée par `is_member_of`.
--
-- Les sortants partis ou clôturés ne remontent que depuis `p_since` ; les
-- autres, quel que soit leur âge — c'est le travail en cours.

CREATE OR REPLACE FUNCTION public.outbound_couriers(
  p_organization_id uuid,
  p_since timestamptz DEFAULT (now() - interval '30 days')
)
RETURNS TABLE (
  id uuid,
  chrono text,
  subject text,
  channel text,
  parent_courier_id uuid,
  parent_chrono text,
  parent_subject text,
  socle_organization_id uuid,
  created_at timestamptz,
  sent_at timestamptz,
  state_id uuid,
  state_name text,
  state_is_initial boolean,
  state_is_final boolean,
  state_is_send boolean,
  state_requires_visa boolean,
  state_requires_signature boolean,
  signed_at timestamptz,
  sent_email_at timestamptz,
  posted_at timestamptz,
  recipient_name text,
  recipient_contact_id uuid,
  state_since timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id,
    c.chrono::text,
    c.subject,
    c.channel::text,
    c.parent_courier_id,
    p.chrono::text AS parent_chrono,
    p.subject AS parent_subject,
    c.socle_organization_id,
    c.created_at::timestamptz,
    c.sent_at::timestamptz,
    c.workflow_state_id AS state_id,
    ws.name::text AS state_name,
    COALESCE(ws.is_initial, false),
    COALESCE(ws.is_final, false),
    COALESCE(ws.is_send, false),
    COALESCE(ws.requires_visa, false),
    COALESCE(ws.requires_signature, false),
    NULLIF(c.metadata->>'signed_at', '')::timestamptz,
    NULLIF(c.metadata->>'sent_email_at', '')::timestamptz,
    NULLIF(c.metadata->>'posted_at', '')::timestamptz,
    COALESCE(NULLIF(btrim(r.name), ''), NULLIF(btrim(concat_ws(' ', r.first_name, r.last_name)), '')),
    r.socle_contact_id,
    COALESCE(ev.at, c.created_at::timestamptz)
  FROM couriers c
  LEFT JOIN workflow_states ws ON ws.id = c.workflow_state_id
  LEFT JOIN couriers p ON p.id = c.parent_courier_id AND p.organization_id = c.organization_id
  -- Une seule personne : le destinataire du sortant, à défaut l'expéditeur du
  -- courrier reçu (même règle que `outboundRecipient`, src/lib/outbound-kind.ts).
  LEFT JOIN LATERAL (
    SELECT x.name, x.first_name, x.last_name, x.socle_contact_id
    FROM (
      SELECT cp.name, cp.first_name, cp.last_name, cp.socle_contact_id, 0 AS rank, cp.id
      FROM courier_participants cp
      WHERE cp.courier_id = c.id AND cp.role = 'recipient'
      UNION ALL
      SELECT cp.name, cp.first_name, cp.last_name, cp.socle_contact_id, 1 AS rank, cp.id
      FROM courier_participants cp
      WHERE cp.courier_id = c.parent_courier_id AND cp.role = 'sender'
    ) x
    ORDER BY x.rank, x.id
    LIMIT 1
  ) r ON true
  -- Entrée dans l'état courant : l'événement d'une réponse est journalisé sur
  -- son parent, celui d'un sortant à l'initiative sur lui-même (`eventAnchor`).
  LEFT JOIN LATERAL (
    SELECT max(ce.created_at)::timestamptz AS at
    FROM courier_events ce
    WHERE ce.courier_id = COALESCE(c.parent_courier_id, c.id)
      AND ce.event_type = 'reply_state_changed'
      AND ce.payload->>'reply_id' = c.id::text
      AND ce.payload->>'to_state_id' = c.workflow_state_id::text
  ) ev ON true
  WHERE c.organization_id = p_organization_id
    AND public.is_member_of(p_organization_id)
    AND c.direction = 'outbound'
    AND c.deleted_at IS NULL
    AND (
      NOT (
        COALESCE(ws.is_final, false)
        OR c.metadata ? 'sent_email_at'
        OR c.metadata ? 'posted_at'
      )
      OR COALESCE(
        NULLIF(c.metadata->>'sent_email_at', '')::timestamptz,
        NULLIF(c.metadata->>'posted_at', '')::timestamptz,
        c.sent_at::timestamptz,
        c.updated_at::timestamptz
      ) >= p_since
    )
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT 8000;
$function$;

REVOKE EXECUTE ON FUNCTION public.outbound_couriers(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.outbound_couriers(uuid, timestamptz) TO authenticated, service_role;
