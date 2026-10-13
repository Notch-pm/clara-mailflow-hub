-- ============================================================================
-- Courriers sortants à l'initiative : déclaration « posté » et clôture d'un
-- courrier postal (migration 20261013150000_sortants_poste.sql).
--
-- Bloc DO qui finit TOUJOURS par une exception : la transaction est annulée.
-- Le message est le verdict. Joué en propriétaire de la base (RLS non éprouvée).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/outbound_posted.test.sql
-- ============================================================================

do $$
declare
  v_org uuid; v_wf uuid; v_init uuid; v_send uuid; v_done uuid; v_so uuid; v_p uuid; v_e uuid; v_sent timestamp;
  v_echecs text[] := '{}';
  v_r constant jsonb := '{"socle_contact_id":"11111111-1111-1111-1111-111111111111","name":"Jean Martin"}';
  v_today date := (now() at time zone 'Europe/Paris')::date;
begin
  insert into organizations (name, slug) values ('[TEST SQL] Poste ' || substr(gen_random_uuid()::text,1,8), 'test-sql-poste-' || gen_random_uuid()) returning id into v_org;
  insert into workflows (organization_id, name, type) values (v_org, 'Réponse', 'reply') returning id into v_wf;
  insert into workflow_states (organization_id, workflow_id, name, category, is_initial) values (v_org, v_wf, 'Rédaction', 'pending', true) returning id into v_init;
  insert into workflow_states (organization_id, workflow_id, name, category, is_send) values (v_org, v_wf, 'Envoi', 'processing', true) returning id into v_send;
  insert into workflow_states (organization_id, workflow_id, name, category, is_final) values (v_org, v_wf, 'Envoyé', 'processed', true) returning id into v_done;
  insert into workflow_transitions (organization_id, workflow_id, from_state_id, to_state_id, kind) values (v_org, v_wf, v_init, v_send, 'next'), (v_org, v_wf, v_send, v_done, 'next');
  insert into socle_organizations (organization_id, socle_id, name, reply_workflow_id) values (v_org, gen_random_uuid(), 'Cabinet', v_wf) returning id into v_so;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('clara.bypass_transition_guard', '', true);

  v_p := create_outbound_courier(v_org, v_so, 'paper', 'Lettre', v_r);
  update couriers set workflow_state_id = v_send where id = v_p;
  -- 1. Pas de clôture avant « posté ».
  begin update couriers set workflow_state_id = v_done where id = v_p; v_echecs := v_echecs || '1. clôture non postée acceptée'::text;
  exception when raise_exception then null; end;
  -- 2-4. Date future, antérieure à la création, illisible : refusées.
  begin update couriers set metadata = metadata || jsonb_build_object('posted_at', (v_today + 1)::text) where id = v_p; v_echecs := v_echecs || '2. date future acceptée'::text;
  exception when raise_exception then null; end;
  begin update couriers set metadata = metadata || jsonb_build_object('posted_at', (v_today - 1)::text) where id = v_p; v_echecs := v_echecs || '3. date antérieure acceptée'::text;
  exception when raise_exception then null; end;
  begin update couriers set metadata = metadata || '{"posted_at":"demain"}' where id = v_p; v_echecs := v_echecs || '4. date illisible acceptée'::text;
  exception when raise_exception then null; end;
  -- 5. Posé aujourd'hui : accepté, et `sent_at` vaut ce jour.
  update couriers set metadata = metadata || jsonb_build_object('posted_at', v_today::text) where id = v_p;
  select sent_at into v_sent from couriers where id = v_p;
  if v_sent is distinct from v_today::timestamp then v_echecs := v_echecs || format('5. sent_at = %s', v_sent); end if;
  -- 6. Immuable : ni modifié, ni retiré.
  begin update couriers set metadata = metadata || jsonb_build_object('posted_at', v_today::text || 'x') where id = v_p; v_echecs := v_echecs || '6a. modification acceptée'::text;
  exception when raise_exception then null; end;
  begin update couriers set metadata = metadata - 'posted_at' where id = v_p; v_echecs := v_echecs || '6b. retrait accepté'::text;
  exception when raise_exception then null; end;
  -- 7. Les autres écritures de `metadata` passent.
  begin update couriers set metadata = metadata || '{"body_html":"<p>x</p>"}' where id = v_p;
  exception when others then v_echecs := v_echecs || ('7. écriture du corps refusée : ' || sqlerrm); end;
  -- 8. Clôture après « posté » : acceptée.
  begin update couriers set workflow_state_id = v_done where id = v_p;
  exception when others then v_echecs := v_echecs || ('8. clôture postée refusée : ' || sqlerrm); end;
  -- 9. « Posté » sur un courriel : refusé.
  v_e := create_outbound_courier(v_org, v_so, 'email', 'Courriel', v_r);
  begin update couriers set metadata = metadata || jsonb_build_object('posted_at', v_today::text) where id = v_e; v_echecs := v_echecs || '9. posté sur un courriel accepté'::text;
  exception when raise_exception then null; end;

  if array_length(v_echecs, 1) is null then raise exception 'VERDICT : OK — 9 scénarios (transaction annulée)';
  else raise exception 'VERDICT : % ÉCHEC(S) — %', array_length(v_echecs, 1), array_to_string(v_echecs, ' | '); end if;
end $$;
