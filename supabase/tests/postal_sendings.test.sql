-- ============================================================================
-- Envois papiers réels, lot 1 (migration 20261106102716_envois_papier_reels.sql) :
-- type d'envoi `suivi`, réservation unique par courrier, RLS de `postal_sendings`
-- et de `provider_tokens`, plafond borné.
--
-- Bloc DO qui finit TOUJOURS par une exception : la transaction est annulée.
-- Le message est le verdict. Joué en propriétaire de la base.
--   psql "$SUPABASE_DB_URL" -f supabase/tests/postal_sendings.test.sql
-- ============================================================================

do $$
declare
  v_org uuid; v_wf uuid; v_init uuid; v_so uuid; v_p uuid; v_s uuid;
  v_echecs text[] := '{}';
  v_r constant jsonb := '{"socle_contact_id":"11111111-1111-1111-1111-111111111111","name":"Jean Martin"}';
  v_at text := to_char(date_trunc('minute', now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_ok boolean;
begin
  insert into organizations (name, slug) values ('[TEST SQL] Envois ' || substr(gen_random_uuid()::text,1,8), 'test-sql-envois-' || gen_random_uuid()) returning id into v_org;
  insert into workflows (organization_id, name, type) values (v_org, 'Réponse', 'reply') returning id into v_wf;
  insert into workflow_states (organization_id, workflow_id, name, category, is_initial) values (v_org, v_wf, 'Rédaction', 'pending', true) returning id into v_init;
  insert into socle_organizations (organization_id, socle_id, name, reply_workflow_id) values (v_org, gen_random_uuid(), 'Cabinet', v_wf) returning id into v_so;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('clara.bypass_transition_guard', '', true);

  -- 1. Valeurs par défaut de l'organisation.
  if (select postal_sending_enabled or postal_daily_cap <> 50 from organizations where id = v_org) then
    v_echecs := v_echecs || '1. défauts inattendus'::text; end if;
  -- 2. Plafond borné.
  begin update organizations set postal_daily_cap = -1 where id = v_org; v_echecs := v_echecs || '2. plafond négatif accepté'::text;
  exception when check_violation then null; end;

  v_p := create_outbound_courier(v_org, v_so, 'paper', 'Lettre', v_r);
  update couriers set created_at = now() - interval '1 hour' where id = v_p;
  -- 3. `suivi` accepté comme type d'envoi.
  begin update couriers set metadata = metadata || jsonb_build_object('posted_at', v_at, 'posted_mode', 'suivi') where id = v_p;
  exception when others then v_echecs := v_echecs || ('3. suivi refusé : ' || sqlerrm); end;

  -- 4. Réservation : un seul envoi actif par courrier.
  insert into postal_sendings (organization_id, courier_id, mode) values (v_org, v_p, 'simple') returning id into v_s;
  begin insert into postal_sendings (organization_id, courier_id, mode) values (v_org, v_p, 'simple'); v_echecs := v_echecs || '4a. second envoi actif accepté'::text;
  exception when unique_violation then null; end;
  -- 5. Un envoi échoué libère la réservation.
  update postal_sendings set status = 'failed' where id = v_s;
  begin insert into postal_sendings (organization_id, courier_id, mode) values (v_org, v_p, 'recommande');
  exception when others then v_echecs := v_echecs || ('5. relance après échec refusée : ' || sqlerrm); end;
  -- 6. Type et statut inconnus refusés.
  begin insert into postal_sendings (organization_id, courier_id, mode, status) values (v_org, v_p, 'colis', 'failed'); v_echecs := v_echecs || '6a. type inconnu accepté'::text;
  exception when check_violation then null; end;
  begin insert into postal_sendings (organization_id, courier_id, mode, status) values (v_org, v_p, 'simple', 'perdu'); v_echecs := v_echecs || '6b. statut inconnu accepté'::text;
  exception when check_violation then null; end;

  -- 7. Droits : lecture seule pour authenticated, rien pour provider_tokens.
  if has_table_privilege('authenticated', 'public.postal_sendings', 'INSERT')
     or has_table_privilege('authenticated', 'public.postal_sendings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.postal_sendings', 'DELETE') then
    v_echecs := v_echecs || '7a. écriture ouverte à authenticated'::text; end if;
  if not has_table_privilege('authenticated', 'public.postal_sendings', 'SELECT') then
    v_echecs := v_echecs || '7b. lecture fermée à authenticated'::text; end if;
  if has_table_privilege('authenticated', 'public.provider_tokens', 'SELECT')
     or has_table_privilege('anon', 'public.provider_tokens', 'SELECT') then
    v_echecs := v_echecs || '7c. provider_tokens lisible côté client'::text; end if;
  if not has_column_privilege('authenticated', 'public.organizations', 'postal_sending_enabled', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.organizations', 'postal_daily_cap', 'UPDATE') then
    v_echecs := v_echecs || '7e. réglage non modifiable par un administrateur (grant colonne manquant)'::text; end if;
  select relrowsecurity into v_ok from pg_class where oid = 'public.postal_sendings'::regclass;
  if not v_ok then v_echecs := v_echecs || '7d. RLS inactive sur postal_sendings'::text; end if;

  if array_length(v_echecs, 1) is null then raise exception 'VERDICT : OK — 7 scénarios (transaction annulée)';
  else raise exception 'VERDICT : % ÉCHEC(S) — %', array_length(v_echecs, 1), array_to_string(v_echecs, ' | '); end if;
end $$;
