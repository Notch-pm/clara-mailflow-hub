-- Test du courrier de réponse déposé par Iris (migration 20261112160000) : création par
-- la porte de service, avis « sent » / « cancelled » mis en file une seule fois, réclamation,
-- privilèges. À jouer dans une transaction annulée, après la migration — il réutilise une
-- organisation existante qui a un workflow de réponse.
do $t$
declare
  v_org uuid; v_so uuid; v_courier uuid; v_fail text[] := '{}'; v_n int; v_ev text; v_req uuid := gen_random_uuid();
  v_wf uuid; v_init uuid; v_arch uuid; v_proc uuid;
begin
  -- Une organisation Clara qui a un workflow de réponse.
  select so.organization_id, so.id, so.reply_workflow_id into v_org, v_so, v_wf
    from public.socle_organizations so
   where so.reply_workflow_id is not null and so.status = 'active' and so.obsoleted_at is null
   limit 1;
  if v_org is null then raise exception 'pas de jeu d''essai (aucune organisation avec workflow de réponse)'; end if;
  select id into v_init from public.workflow_states where workflow_id = v_wf and is_initial order by created_at limit 1;
  select id into v_arch from public.workflow_states where workflow_id = v_wf and category = 'archived' limit 1;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_courier := public.create_outbound_courier_from_iris(v_org, v_so, 'paper', 'Réponse test', '<p>x</p>', 'x',
    jsonb_build_object('socle_contact_id', gen_random_uuid(), 'name', 'Usager Test'),
    jsonb_build_object('reply_key', gen_random_uuid(), 'request_id', v_req, 'reference', '2026-00001',
                       'url', 'https://iris.example/demandes/x', 'submitted_by_name', 'Agent'));
  select count(*) into v_n from public.couriers
   where id = v_courier and direction = 'outbound' and workflow_state_id = v_init and iris_request_id = v_req and chrono is not null;
  if v_n <> 1 then v_fail := v_fail || 'A1: courrier mal cree'::text; end if;
  select count(*) into v_n from public.courier_participants where courier_id = v_courier and role = 'recipient';
  if v_n <> 1 then v_fail := v_fail || 'A2: destinataire absent'::text; end if;

  -- Organisation inconnue de la collectivité : refus P0010.
  begin
    perform public.create_outbound_courier_from_iris(v_org, gen_random_uuid(), 'paper', 'x', '', 'x',
      jsonb_build_object('socle_contact_id', gen_random_uuid()),
      jsonb_build_object('reply_key', gen_random_uuid(), 'request_id', v_req));
    v_fail := v_fail || 'A3: organisation inconnue acceptee'::text;
  exception when sqlstate 'P0010' then null;
  end;

  -- Déclaré posté → avis « sent ».
  update public.couriers set metadata = metadata || jsonb_build_object('posted_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'posted_mode', 'simple')
   where id = v_courier;
  select event into v_ev from public.iris_reply_notifications where courier_id = v_courier;
  if v_ev is distinct from 'sent' then v_fail := v_fail || format('B1: avis = %s', v_ev); end if;
  -- Second fait : ignoré (un seul destin).
  update public.couriers set deleted_at = now() where id = v_courier;
  select count(*) into v_n from public.iris_reply_notifications where courier_id = v_courier;
  if v_n <> 1 then v_fail := v_fail || 'B2: second avis'::text; end if;

  -- Abandon d'un autre courrier → « cancelled ».
  v_courier := public.create_outbound_courier_from_iris(v_org, v_so, 'email', 'Réponse 2', '', 'y',
    jsonb_build_object('socle_contact_id', gen_random_uuid()),
    jsonb_build_object('reply_key', gen_random_uuid(), 'request_id', v_req));
  update public.couriers set deleted_at = now() where id = v_courier;
  select event into v_ev from public.iris_reply_notifications where courier_id = v_courier;
  if v_ev is distinct from 'cancelled' then v_fail := v_fail || format('C1: avis = %s', v_ev); end if;

  -- Réclamation : bail posé, tentative comptée.
  select count(*) into v_n from public.claim_iris_reply_notifications(10) c where c.attempts = 1;
  if v_n < 2 then v_fail := v_fail || format('D1: %s avis reclames', v_n); end if;

  -- Un courrier sans lien Iris n'alimente rien.
  select count(*) into v_n from public.iris_reply_notifications n join public.couriers c on c.id = n.courier_id where c.iris_request_id is null;
  if v_n <> 0 then v_fail := v_fail || 'E1'::text; end if;

  if has_function_privilege('authenticated', 'public.create_outbound_courier_from_iris(uuid, uuid, courier_channel, text, text, text, jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_iris_reply_notifications(integer)', 'execute') then
    v_fail := v_fail || 'F1: porte de service executable par authenticated'::text; end if;

  if array_length(v_fail, 1) is null then
    raise exception 'TOUS LES TESTS SONT PASSES (courrier de reponse Iris) - transaction annulee';
  else
    raise exception 'ECHECS : %', array_to_string(v_fail, ' || ');
  end if;
end $t$;
