-- ============================================================================
-- Recherche par référence (migration 20261106120500_recherche_par_reference.sql).
--
-- Bloc DO qui finit TOUJOURS par une exception : la transaction est annulée.
-- Joué en propriétaire de la base, qui se fait passer pour un membre (JWT).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/recherche_par_reference.test.sql
-- ============================================================================

do $$
declare
  v_org uuid; v_user uuid; v_in uuid; v_out uuid; v_in_chrono text; v_out_chrono text; n int;
  v_echecs text[] := '{}';
begin
  select id into v_user from auth.users limit 1;
  insert into organizations (name, slug) values ('[TEST SQL] Recherche ' || substr(gen_random_uuid()::text,1,8), 'test-sql-recherche-' || gen_random_uuid()) returning id into v_org;
  insert into organization_users (organization_id, user_id, role, is_active) values (v_org, v_user, 'administrateur', true);
  perform set_config('clara.bypass_transition_guard', 'on', true);
  insert into couriers (organization_id, direction, channel, subject, received_at) values (v_org, 'inbound', 'paper', 'Demande de stationnement', now()) returning id, chrono into v_in, v_in_chrono;
  insert into couriers (organization_id, direction, channel, subject, sent_at) values (v_org, 'outbound', 'paper', 'Lettre au riverain', now()) returning id, chrono into v_out, v_out_chrono;
  perform set_config('clara.bypass_transition_guard', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- 1-2. Référence complète d'un entrant puis d'un sortant.
  select count(*) into n from search_couriers(v_org, null, null, null, v_in_chrono, null, null, null, 8, 0, null, false, null, 'received_at', true, null, 'desc') s where s.id = v_in;
  if n <> 1 then v_echecs := v_echecs || format('1. entrant %s introuvable', v_in_chrono); end if;
  select count(*) into n from search_couriers(v_org, null, null, null, v_out_chrono, null, null, null, 8, 0, null, false, null, 'received_at', true, null, 'desc') s where s.id = v_out;
  if n <> 1 then v_echecs := v_echecs || format('2. sortant %s introuvable', v_out_chrono); end if;
  -- 3. Référence partielle (fin du numéro).
  select count(*) into n from search_couriers(v_org, 'outbound', null, null, right(v_out_chrono, 7), null, null, null, 8, 0, null, false, null, 'received_at', true, null, 'desc') s where s.id = v_out;
  if n <> 1 then v_echecs := v_echecs || '3. référence partielle introuvable'::text; end if;
  -- 4. La recherche plein texte marche toujours.
  select count(*) into n from search_couriers(v_org, null, null, null, 'stationnement', null, null, null, 8, 0, null, false, null, 'received_at', true, null, 'desc') s where s.id = v_in;
  if n <> 1 then v_echecs := v_echecs || '4. recherche par objet cassée'::text; end if;

  if v_in_chrono is null or v_out_chrono is null then v_echecs := v_echecs || '0. référence non attribuée à l''insertion'::text; end if;
  if array_length(v_echecs, 1) is null then raise exception 'VERDICT : OK — 4 scénarios (transaction annulée)';
  else raise exception 'VERDICT : % ÉCHEC(S) — %', array_length(v_echecs, 1), array_to_string(v_echecs, ' | '); end if;
end $$;
