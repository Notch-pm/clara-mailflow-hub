-- ============================================================================
-- Courriers confidentiels (migration 20261013160000_courriers_confidentiels.sql).
--
-- Bloc DO qui finit TOUJOURS par une exception : la transaction est annulée.
-- Le message est le verdict. Contrairement aux autres tests, les règles de
-- lecture SONT éprouvées : on endosse l'identité de vrais comptes (ceux de
-- `[TEST] Alpha`, rattachés pour l'occasion à une organisation jetable) et le
-- rôle `authenticated`.
--   psql "$SUPABASE_DB_URL" -f supabase/tests/courier_confidential.test.sql
-- ============================================================================

do $$
declare
  v_admin uuid; v_hab uuid; v_vis uuid; v_sig uuid; v_cour uuid; v_gest uuid;
  v_org uuid; v_wf uuid; v_rwf uuid; v_init uuid; v_rinit uuid; v_rvisa uuid; v_so uuid; v_signatory uuid;
  v_in uuid; v_reply uuid; v_other uuid;
  v_n bigint; v_txt text; v_b boolean;
  v_echecs text[] := '{}';
begin
  select id into v_admin from users where email = 'admin.alpha@test.clara.local';
  select id into v_hab   from users where email = 'membre.alpha@test.clara.local';
  select id into v_vis   from users where email = 'viseur.alpha@test.clara.local';
  select id into v_sig   from users where email = 'signataire.alpha@test.clara.local';
  select id into v_cour  from users where email = 'consultant.alpha@test.clara.local';
  select id into v_gest  from users where email = 'admin.beta@test.clara.local';
  if v_admin is null or v_hab is null or v_vis is null or v_sig is null or v_cour is null or v_gest is null then
    raise exception 'VERDICT : NON JOUÉ — comptes [TEST] absents (lancer bun run seed:test)';
  end if;

  -- Organisation jetable : workflow entrant, workflow de réponse avec visa.
  insert into organizations (name, slug) values ('[TEST SQL] Confidentiel ' || substr(gen_random_uuid()::text,1,8), 'test-sql-conf-' || gen_random_uuid()) returning id into v_org;
  insert into workflows (organization_id, name, type) values (v_org, 'Entrant', 'inbound') returning id into v_wf;
  insert into workflow_states (organization_id, workflow_id, name, category, is_initial) values (v_org, v_wf, 'À traiter', 'pending', true) returning id into v_init;
  insert into workflows (organization_id, name, type) values (v_org, 'Réponse', 'reply') returning id into v_rwf;
  insert into workflow_states (organization_id, workflow_id, name, category, is_initial) values (v_org, v_rwf, 'Rédaction', 'pending', true) returning id into v_rinit;
  insert into workflow_states (organization_id, workflow_id, name, category, requires_visa) values (v_org, v_rwf, 'Visa', 'processing', true) returning id into v_rvisa;
  insert into socle_organizations (organization_id, socle_id, name, workflow_id, reply_workflow_id) values (v_org, gen_random_uuid(), 'Cabinet', v_wf, v_rwf) returning id into v_so;

  -- Membres : administrateur sans l'attribut, habilité, viseur, signataire,
  -- service courrier, gestionnaire ordinaire.
  insert into organization_users (organization_id, user_id, role, is_active) values (v_org, v_admin, 'administrateur', true);
  insert into organization_users (organization_id, user_id, role, is_active, can_read_confidential) values (v_org, v_hab, 'gestionnaire', true, true);
  insert into organization_users (organization_id, user_id, role, is_active, is_viseur) values (v_org, v_vis, 'gestionnaire', true, true);
  insert into organization_users (organization_id, user_id, role, is_active, is_signataire) values (v_org, v_sig, 'gestionnaire', true, true);
  insert into organization_users (organization_id, user_id, role, is_active, is_service_courrier) values (v_org, v_cour, 'gestionnaire', true, true);
  insert into organization_users (organization_id, user_id, role, is_active) values (v_org, v_gest, 'gestionnaire', true);
  insert into signatories (organization_id, user_id, first_name, last_name) values (v_org, v_sig, 'Sig', 'Nataire') returning id into v_signatory;

  -- 0. L'habilitation est tracée.
  select count(*) into v_n from confidential_access_log where organization_id = v_org and user_id = v_hab and granted;
  if v_n <> 1 then v_echecs := v_echecs || format('0. trace d''habilitation : %s ligne(s)', v_n); end if;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('clara.bypass_transition_guard', 'on', true);

  -- Un entrant confidentiel, sa réponse, et un entrant ordinaire.
  insert into couriers (organization_id, direction, channel, subject, received_at, workflow_state_id, socle_organization_id, is_confidential)
  values (v_org, 'inbound', 'email', 'Signalement Zorglub', now(), v_init, v_so, true) returning id into v_in;
  insert into courier_participants (organization_id, courier_id, role, name) values (v_org, v_in, 'sender', 'Zorglub Martin');
  insert into couriers (organization_id, direction, channel, subject, parent_courier_id, workflow_state_id, socle_organization_id, metadata)
  values (v_org, 'outbound', 'email', 'Re: Signalement Zorglub', v_in, v_rvisa, v_so,
          jsonb_build_object('visa_viseurs', jsonb_build_object(v_rvisa::text, v_vis::text), 'signatory_id', v_signatory))
  returning id into v_reply;
  insert into couriers (organization_id, direction, channel, subject, received_at, workflow_state_id, socle_organization_id)
  values (v_org, 'inbound', 'email', 'Demande ordinaire', now(), v_init, v_so) returning id into v_other;
  insert into notifications (organization_id, user_id, type, title, resource_id) values (v_org, v_admin, 'test', 'Relance : Demande ordinaire', v_other);

  -- 1. Une réponse à un entrant confidentiel l'est d'office.
  select is_confidential into v_b from couriers where id = v_reply;
  if not v_b then v_echecs := v_echecs || '1. réponse non confidentielle'::text; end if;

  -- 2. Notification sur un confidentiel : objet masqué, préfixe gardé.
  insert into notifications (organization_id, user_id, type, title, resource_id) values (v_org, v_admin, 'test', 'Transféré : Signalement Zorglub', v_in);
  select title into v_txt from notifications where resource_id = v_in and type = 'test';
  if v_txt <> 'Transféré : Courrier confidentiel' then v_echecs := v_echecs || format('2. notification : « %s »', v_txt); end if;
  select count(*) into v_n from notifications where resource_id = v_in and title ilike '%zorglub%';
  if v_n > 0 then v_echecs := v_echecs || format('2b. %s notification(s) portent l''objet', v_n); end if;

  -- ── Administrateur SANS l'attribut ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from couriers where id in (v_in, v_reply);
  if v_n <> 0 then v_echecs := v_echecs || format('3. admin lit %s courrier(s) confidentiel(s)', v_n); end if;
  select count(*) into v_n from courier_participants where courier_id = v_in;
  if v_n <> 0 then v_echecs := v_echecs || '3b. admin lit les participants'::text; end if;
  if courier_access(v_in) <> 'confidential' then v_echecs := v_echecs || format('3c. courier_access = %s', courier_access(v_in)); end if;
  select subject, (sender_name is null) into v_txt, v_b from search_couriers(v_org, p_limit => 50) where id = v_in;
  if v_txt is distinct from '[courrier confidentiel]' or not v_b then v_echecs := v_echecs || format('4. liste non masquée : %s', v_txt); end if;
  select count(*) into v_n from search_couriers(v_org, p_keywords => 'Zorglub', p_limit => 50);
  if v_n <> 0 then v_echecs := v_echecs || format('4b. recherche « Zorglub » : %s résultat(s)', v_n); end if;
  select subject into v_txt from mailroom_couriers(v_org) where id = v_in;
  if v_txt is distinct from '[courrier confidentiel]' then v_echecs := v_echecs || format('4c. courrier entrant : %s', v_txt); end if;
  select subject into v_txt from outbound_couriers(v_org) where id = v_reply;
  if v_txt is distinct from '[courrier confidentiel]' then v_echecs := v_echecs || format('4d. sortants : %s', v_txt); end if;
  select count(*) into v_n from couriers where id = v_other;
  if v_n <> 1 then v_echecs := v_echecs || '4e. admin ne lit plus un courrier ordinaire'::text; end if;
  execute 'reset role';

  -- ── Habilité ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_hab, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from couriers where id in (v_in, v_reply);
  if v_n <> 2 then v_echecs := v_echecs || format('5. habilité lit %s/2', v_n); end if;
  select count(*) into v_n from search_couriers(v_org, p_keywords => 'Zorglub', p_limit => 50);
  if v_n < 1 then v_echecs := v_echecs || '5b. habilité ne trouve pas « Zorglub »'::text; end if;
  execute 'reset role';

  -- ── Viseur désigné sur la réponse : lit la réponse ET l'entrant ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_vis, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from couriers where id in (v_in, v_reply);
  if v_n <> 2 then v_echecs := v_echecs || format('6. viseur désigné lit %s/2', v_n); end if;
  execute 'reset role';

  -- ── Signataire désigné ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_sig, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from couriers where id in (v_in, v_reply);
  if v_n <> 2 then v_echecs := v_echecs || format('7. signataire désigné lit %s/2', v_n); end if;
  execute 'reset role';

  -- ── Gestionnaire ordinaire : ne peut ni poser ni router à l'aveugle ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_gest, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform set_courier_confidential(v_other, true);
    v_echecs := v_echecs || '8. gestionnaire a posé le drapeau'::text;
  exception when insufficient_privilege then null; end;
  begin
    perform route_courier_blind(v_in, v_so);
    v_echecs := v_echecs || '8b. gestionnaire a routé à l''aveugle'::text;
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  -- ── Service courrier : pose le drapeau, ne le retire pas, route sans lire ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_cour, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform set_courier_confidential(v_other, true);
  exception when others then v_echecs := v_echecs || ('9. service courrier ne pose pas le drapeau : ' || sqlerrm); end;
  -- Une écriture directe échoue : la ligne devenue confidentielle lui est cachée.
  begin
    update couriers set subject = 'x' where id = v_other;
  exception when others then null; end;
  begin
    perform set_courier_confidential(v_other, false);
    v_echecs := v_echecs || '9a. service courrier a levé le drapeau'::text;
  exception when insufficient_privilege then null; end;
  begin
    perform route_courier_blind(v_in, v_so);
  exception when others then v_echecs := v_echecs || ('10. routage aveugle refusé : ' || sqlerrm); end;
  execute 'reset role';
  select is_confidential into v_b from couriers where id = v_other;
  if not v_b then v_echecs := v_echecs || '9b. service courrier a levé le drapeau'::text; end if;
  select count(*) into v_n from courier_events where courier_id = v_other and event_type = 'confidentiality_set';
  if v_n <> 1 then v_echecs := v_echecs || format('9c. trace de pose : %s', v_n); end if;
  select title into v_txt from notifications where resource_id = v_other and type = 'test';
  if v_txt <> 'Relance : Courrier confidentiel' then v_echecs := v_echecs || format('9d. notification antérieure : « %s »', v_txt); end if;
  select count(*) into v_n from courier_events where courier_id = v_in and event_type = 'service_changed';
  if v_n <> 1 then v_echecs := v_echecs || format('10b. événement de routage : %s', v_n); end if;

  -- ── Habilité : lève le drapeau, la réponse suit ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_hab, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform set_courier_confidential(v_in, false);
  exception when others then v_echecs := v_echecs || ('11. habilité ne lève pas : ' || sqlerrm); end;
  execute 'reset role';
  select is_confidential into v_b from couriers where id = v_reply;
  if v_b then v_echecs := v_echecs || '11b. la réponse reste confidentielle'::text; end if;

  if array_length(v_echecs, 1) is null then raise exception 'VERDICT : OK — 12 scénarios (transaction annulée)';
  else raise exception 'VERDICT : % ÉCHEC(S) — %', array_length(v_echecs, 1), array_to_string(v_echecs, ' | '); end if;
end $$;
