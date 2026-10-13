-- ============================================================================
-- Courriers sortants à l'initiative : clôture d'un courriel et réservation
-- de l'envoi (migration 20261013130000_sortants_envoi_courriel.sql).
--
-- Bloc DO qui finit TOUJOURS par une exception : la transaction est annulée.
-- Le message est le verdict. Joué en propriétaire de la base (RLS non éprouvée).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/outbound_email_send.test.sql
-- ============================================================================

do $$
declare
  v_org uuid; v_wf_r uuid; v_init uuid; v_send uuid; v_done uuid; v_drop uuid; v_so uuid; v_s uuid; v_a uuid; v_p uuid;
  v_ok boolean; v_echecs text[] := '{}';
  v_recipient constant jsonb := '{"socle_contact_id":"11111111-1111-1111-1111-111111111111","name":"Jean Martin"}';
begin
  insert into organizations (name, slug) values ('[TEST SQL] Envoi ' || substr(gen_random_uuid()::text,1,8), 'test-sql-envoi-' || gen_random_uuid()) returning id into v_org;
  insert into workflows (organization_id, name, type) values (v_org, 'Réponse', 'reply') returning id into v_wf_r;
  insert into workflow_states (organization_id, workflow_id, name, category, is_initial) values (v_org, v_wf_r, 'Rédaction', 'pending', true) returning id into v_init;
  insert into workflow_states (organization_id, workflow_id, name, category, is_send) values (v_org, v_wf_r, 'Envoi', 'processing', true) returning id into v_send;
  insert into workflow_states (organization_id, workflow_id, name, category, is_final) values (v_org, v_wf_r, 'Envoyé', 'processed', true) returning id into v_done;
  insert into workflow_states (organization_id, workflow_id, name, category, is_final) values (v_org, v_wf_r, 'Abandonné', 'archived', true) returning id into v_drop;
  insert into workflow_transitions (organization_id, workflow_id, from_state_id, to_state_id, kind) values (v_org, v_wf_r, v_init, v_send, 'next'), (v_org, v_wf_r, v_send, v_done, 'next');
  insert into socle_organizations (organization_id, socle_id, name, reply_workflow_id) values (v_org, gen_random_uuid(), 'Cabinet', v_wf_r) returning id into v_so;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('clara.bypass_transition_guard', '', true);

  -- 1. Un courriel ne se clôt pas avant d'être parti.
  v_s := create_outbound_courier(v_org, v_so, 'email', 'Courriel', v_recipient);
  update couriers set workflow_state_id = v_send where id = v_s;
  begin update couriers set workflow_state_id = v_done where id = v_s; v_echecs := v_echecs || '1. clôture sans envoi acceptée'::text;
  exception when raise_exception then null; end;

  -- 2. Il s'abandonne librement (catégorie `archived`).
  v_a := create_outbound_courier(v_org, v_so, 'email', 'À abandonner', v_recipient);
  begin update couriers set workflow_state_id = v_drop where id = v_a;
  exception when others then v_echecs := v_echecs || ('2. abandon refusé : ' || sqlerrm); end;

  -- 3-5. Réservation : une seule à la fois, libérable, jamais hors tenant.
  v_ok := claim_outbound_email_send(v_s, v_org);
  if not v_ok then v_echecs := v_echecs || '3a. première réservation refusée'::text; end if;
  v_ok := claim_outbound_email_send(v_s, v_org);
  if v_ok then v_echecs := v_echecs || '3b. seconde réservation acceptée'::text; end if;
  perform release_outbound_email_send(v_s);
  if not claim_outbound_email_send(v_s, v_org) then v_echecs := v_echecs || '4. réservation après libération refusée'::text; end if;
  if claim_outbound_email_send(v_s, gen_random_uuid()) then v_echecs := v_echecs || '5. réservation hors tenant acceptée'::text; end if;

  -- 6. Fin d'envoi : marqueur et vraie date posés, réservation retirée ; plus
  --    de réservation possible ; la clôture devient permise.
  perform finish_outbound_email_send(v_s, '<m@x>');
  select (metadata ? 'sent_email_at') and not (metadata ? 'email_send_claimed_at') and sent_at is not null into v_ok from couriers where id = v_s;
  if not v_ok then v_echecs := v_echecs || '6a. fin d''envoi incomplète'::text; end if;
  if claim_outbound_email_send(v_s, v_org) then v_echecs := v_echecs || '6b. réservation après envoi acceptée'::text; end if;
  begin update couriers set workflow_state_id = v_done where id = v_s;
  exception when others then v_echecs := v_echecs || ('6c. clôture après envoi refusée : ' || sqlerrm); end;

  -- 7. Courrier postal : pas concerné (sa règle viendra avec « posté », lot 4).
  v_p := create_outbound_courier(v_org, v_so, 'paper', 'Lettre', v_recipient);
  update couriers set workflow_state_id = v_send where id = v_p;
  begin update couriers set workflow_state_id = v_done where id = v_p;
  exception when others then v_echecs := v_echecs || ('7. clôture postale refusée : ' || sqlerrm); end;

  if array_length(v_echecs, 1) is null then raise exception 'VERDICT : OK — 7 scénarios (transaction annulée)';
  else raise exception 'VERDICT : % ÉCHEC(S) — %', array_length(v_echecs, 1), array_to_string(v_echecs, ' | '); end if;
end $$;
