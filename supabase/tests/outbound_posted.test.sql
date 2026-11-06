-- ============================================================================
-- Sortants postaux : déclaration « posté » (date + heure + type d'envoi) et
-- clôture d'un courrier postal (migrations 20261013150000_sortants_poste.sql,
-- 20261106092631_envoi_postal_horodate.sql).
--
-- Bloc DO qui finit TOUJOURS par une exception : la transaction est annulée.
-- Le message est le verdict. Joué en propriétaire de la base (RLS non éprouvée).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/outbound_posted.test.sql
-- ============================================================================

do $$
declare
  v_org uuid; v_wf uuid; v_init uuid; v_send uuid; v_done uuid; v_so uuid; v_p uuid; v_e uuid; v_in uuid; v_rep uuid;
  v_sent timestamptz; v_at timestamptz := date_trunc('minute', now());
  v_echecs text[] := '{}';
  v_r constant jsonb := '{"socle_contact_id":"11111111-1111-1111-1111-111111111111","name":"Jean Martin"}';
  v_ok jsonb;
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

  v_ok := jsonb_build_object('posted_at', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'posted_mode', 'recommande');

  -- Le sortant est créé « maintenant » : on le vieillit d'une heure pour que
  -- l'horodatage du test (minute en cours) ne tombe pas avant sa création.
  v_p := create_outbound_courier(v_org, v_so, 'paper', 'Lettre', v_r);
  update couriers set created_at = now() - interval '1 hour', workflow_state_id = v_send where id = v_p;
  -- 1. Pas de clôture avant « posté ».
  begin update couriers set workflow_state_id = v_done where id = v_p; v_echecs := v_echecs || '1. clôture non postée acceptée'::text;
  exception when raise_exception then null; end;
  -- 2-4. Futur, antérieur à la création, illisible : refusés.
  begin update couriers set metadata = metadata || (v_ok || jsonb_build_object('posted_at', (now() + interval '1 hour')::text)) where id = v_p; v_echecs := v_echecs || '2. heure future acceptée'::text;
  exception when raise_exception then null; end;
  begin update couriers set metadata = metadata || (v_ok || jsonb_build_object('posted_at', (now() - interval '2 hours')::text)) where id = v_p; v_echecs := v_echecs || '3. heure antérieure à la création acceptée'::text;
  exception when raise_exception then null; end;
  begin update couriers set metadata = metadata || (v_ok || '{"posted_at":"demainT10:00"}') where id = v_p; v_echecs := v_echecs || '4. date illisible acceptée'::text;
  exception when raise_exception then null; end;
  -- 5. Date seule (sans heure) : refusée.
  begin update couriers set metadata = metadata || (v_ok || jsonb_build_object('posted_at', (now() at time zone 'Europe/Paris')::date::text)) where id = v_p; v_echecs := v_echecs || '5. date sans heure acceptée'::text;
  exception when raise_exception then null; end;
  -- 6. Type d'envoi absent ou inconnu : refusé.
  begin update couriers set metadata = metadata || jsonb_build_object('posted_at', v_ok ->> 'posted_at') where id = v_p; v_echecs := v_echecs || '6a. sans type d''envoi accepté'::text;
  exception when raise_exception then null; end;
  begin update couriers set metadata = metadata || (v_ok || '{"posted_mode":"colis"}') where id = v_p; v_echecs := v_echecs || '6b. type d''envoi inconnu accepté'::text;
  exception when raise_exception then null; end;
  -- 7. Type d'envoi seul, sans date : refusé.
  begin update couriers set metadata = metadata || '{"posted_mode":"simple"}' where id = v_p; v_echecs := v_echecs || '7. type sans date accepté'::text;
  exception when raise_exception then null; end;
  -- 8. Déclaration complète : acceptée, et `sent_at` vaut l'horodatage déclaré.
  update couriers set metadata = metadata || v_ok where id = v_p;
  select sent_at into v_sent from couriers where id = v_p;
  if v_sent is distinct from v_at then v_echecs := v_echecs || format('8. sent_at = %s, attendu %s', v_sent, v_at); end if;
  -- 9. Immuable : ni la date, ni le type, ni le retrait.
  begin update couriers set metadata = metadata || jsonb_build_object('posted_at', (v_at - interval '1 minute')::text) where id = v_p; v_echecs := v_echecs || '9a. date modifiée acceptée'::text;
  exception when raise_exception then null; end;
  begin update couriers set metadata = metadata || '{"posted_mode":"simple"}' where id = v_p; v_echecs := v_echecs || '9b. type modifié accepté'::text;
  exception when raise_exception then null; end;
  begin update couriers set metadata = metadata - 'posted_at' where id = v_p; v_echecs := v_echecs || '9c. retrait accepté'::text;
  exception when raise_exception then null; end;
  -- 10. Les autres écritures de `metadata` passent.
  begin update couriers set metadata = metadata || '{"body_html":"<p>x</p>"}' where id = v_p;
  exception when others then v_echecs := v_echecs || ('10. écriture du corps refusée : ' || sqlerrm); end;
  -- 11. Clôture après « posté » : acceptée.
  begin update couriers set workflow_state_id = v_done where id = v_p;
  exception when others then v_echecs := v_echecs || ('11. clôture postée refusée : ' || sqlerrm); end;
  -- 12. « Posté » sur un courriel : refusé.
  v_e := create_outbound_courier(v_org, v_so, 'email', 'Courriel', v_r);
  update couriers set created_at = now() - interval '1 hour' where id = v_e;
  begin update couriers set metadata = metadata || v_ok where id = v_e; v_echecs := v_echecs || '12. posté sur un courriel accepté'::text;
  exception when raise_exception then null; end;

  -- 13-15. Une RÉPONSE postale suit les mêmes règles de déclaration.
  -- Création du jeu d'essai sous le bypass prévu (garde de création : parent à instruire), refermé aussitôt.
  perform set_config('clara.bypass_transition_guard', 'on', true);
  insert into couriers (organization_id, direction, channel, subject, received_at, socle_organization_id)
    values (v_org, 'inbound', 'paper', 'Demande', now() - interval '1 day', v_so) returning id into v_in;
  insert into couriers (organization_id, direction, channel, subject, parent_courier_id, sent_at, created_at, socle_organization_id, workflow_state_id)
    values (v_org, 'outbound', 'paper', 'Réponse', v_in, now(), now() - interval '1 hour', v_so, v_init) returning id into v_rep;
  perform set_config('clara.bypass_transition_guard', '', true);
  begin update couriers set metadata = coalesce(metadata, '{}') || jsonb_build_object('posted_at', v_ok ->> 'posted_at') where id = v_rep; v_echecs := v_echecs || '13. réponse sans type d''envoi acceptée'::text;
  exception when raise_exception then null; end;
  begin update couriers set metadata = coalesce(metadata, '{}') || (v_ok || jsonb_build_object('posted_at', (now() + interval '1 hour')::text)) where id = v_rep; v_echecs := v_echecs || '14. réponse à une heure future acceptée'::text;
  exception when raise_exception then null; end;
  begin
    update couriers set metadata = coalesce(metadata, '{}') || (v_ok || '{"posted_mode":"simple"}') where id = v_rep;
    select sent_at into v_sent from couriers where id = v_rep;
    if v_sent is distinct from v_at then v_echecs := v_echecs || format('15. réponse : sent_at = %s', v_sent); end if;
  exception when others then v_echecs := v_echecs || ('15. réponse postée refusée : ' || sqlerrm); end;

  if array_length(v_echecs, 1) is null then raise exception 'VERDICT : OK — 15 scénarios (transaction annulée)';
  else raise exception 'VERDICT : % ÉCHEC(S) — %', array_length(v_echecs, 1), array_to_string(v_echecs, ' | '); end if;
end $$;
