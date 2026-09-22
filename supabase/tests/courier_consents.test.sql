-- ============================================================================
-- Consentements RGPD au dépôt (`couriers.consents`) : vérification en base.
--
-- Un seul bloc DO, qui crée son décor, éprouve les invariants, puis se termine
-- TOUJOURS par une exception : la transaction implicite est annulée et la base
-- retrouve son état d'avant (aucune organisation ni courrier de test ne
-- survit). Le message de l'exception EST le verdict. Motif repris de
-- `notifications_push.test.sql`.
--
-- À rejouer après toute migration touchant `couriers`, ses triggers ou
-- `is_transition_guard_bypassed()` :
--   psql "$SUPABASE_DB_URL" -f supabase/tests/courier_consents.test.sql
-- ou en collant ce fichier dans l'éditeur SQL du projet.
--
-- ⚠️ Ce que ce fichier NE teste PAS : le catalogue (kind, phrases, obligation
-- de `traitement`) — ce n'est pas une garde SQL, elle vit dans
-- `_shared/consents/catalog.ts` et ses tests Vitest. La base enregistre un
-- fait, elle n'arbitre pas le catalogue.
--
-- Huit scénarios : défaut (1), garde anti-forge à l'insert (2), écriture en
-- contexte de service (3), immuabilité (4-6), forme (7), privilèges (8).
-- ============================================================================

do $$
declare
  v_org      uuid;
  v_courier  uuid;
  v_echecs   text[] := '{}';
  v_consents jsonb;
  v_trace    constant jsonb := '[
    {"kind":"traitement","granted":true,"statement":"J''accepte que les informations fournies ici soient utilisées dans le cadre du traitement de ma demande.","collected_at":"2026-09-22T08:00:00.000Z"},
    {"kind":"partage","granted":false,"statement":"J''accepte de partager ces informations aux services de [TEST SQL] afin d''améliorer le traitement de ma demande et de mes futures demandes.","collected_at":"2026-09-22T08:00:00.000Z"}
  ]'::jsonb;
  v_err      text;
  v_subject  text;
begin
  -- ── Décor : une organisation ──────────────────────────────────────────────
  insert into public.organizations (name, slug)
    values ('[TEST SQL] Consentements ' || substr(gen_random_uuid()::text, 1, 8),
            'test-sql-consents-' || gen_random_uuid())
    returning id into v_org;

  -- Hors contexte de service : aucun claim JWT posé par ce test avant le 3.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('clara.bypass_transition_guard', '', true);

  -- ── 1. Défaut : `[]`, jamais NULL ─────────────────────────────────────────
  insert into public.couriers (organization_id, direction, channel, subject, received_at)
    values (v_org, 'inbound', 'paper', '[TEST] sans trace', now())
    returning id, consents into v_courier, v_consents;
  if v_consents is distinct from '[]'::jsonb then
    v_echecs := v_echecs || format('1. défaut : attendu [], obtenu %L', v_consents);
  end if;

  -- ── 2. Un client ne peut pas FORGER une trace à l'insert ─────────────────
  begin
    insert into public.couriers (organization_id, direction, channel, subject, received_at, consents)
      values (v_org, 'inbound', 'portal', '[TEST] forge', now(), v_trace);
    v_echecs := v_echecs || '2. insert avec trace hors contexte de service : attendu refus, obtenu succès';
  exception when check_violation then
    null;
  end;

  -- ── 3. En contexte de service, la trace s'écrit et se relit à l'identique ─
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.couriers (organization_id, direction, channel, subject, received_at, consents)
    values (v_org, 'inbound', 'portal', '[TEST] portail', now(), v_trace)
    returning id, consents into v_courier, v_consents;
  if v_consents is distinct from v_trace then
    v_echecs := v_echecs || '3a. relecture : la trace relue diffère de celle écrite';
  end if;
  if (v_consents -> 1 ->> 'granted')::boolean is distinct from false then
    v_echecs := v_echecs || '3b. relecture : le refus du partage doit être conservé';
  end if;

  -- ── 4. Réécrire la trace est refusé, même en service ─────────────────────
  begin
    update public.couriers
      set consents = jsonb_set(v_trace, '{1,granted}', 'true'::jsonb)
      where id = v_courier;
    v_echecs := v_echecs || '4. réécriture en service : attendu refus, obtenu succès';
  exception when check_violation then
    null;
  end;

  -- ── 5. Vider la trace est refusé ─────────────────────────────────────────
  begin
    update public.couriers set consents = '[]'::jsonb where id = v_courier;
    v_echecs := v_echecs || '5. vidage : attendu refus, obtenu succès';
  exception when check_violation then
    null;
  end;

  -- ── 6. Le reste du courrier reste modifiable ─────────────────────────────
  begin
    update public.couriers set subject = '[TEST] portail (renommé)' where id = v_courier
      returning subject into v_subject;
    if v_subject is distinct from '[TEST] portail (renommé)' then
      v_echecs := v_echecs || '6. update de subject : la valeur n''a pas été écrite';
    end if;
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_echecs := v_echecs || format('6. update de subject : attendu succès, obtenu %L', v_err);
  end;

  -- ── 7. Le CHECK refuse ce qui n'est pas un tableau ───────────────────────
  begin
    insert into public.couriers (organization_id, direction, channel, subject, received_at, consents)
      values (v_org, 'inbound', 'portal', '[TEST] objet', now(), '{"traitement": true}'::jsonb);
    v_echecs := v_echecs || '7a. objet : attendu refus du CHECK, obtenu succès';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.couriers (organization_id, direction, channel, subject, received_at, consents)
      values (v_org, 'inbound', 'portal', '[TEST] null json', now(), 'null'::jsonb);
    v_echecs := v_echecs || '7b. jsonb ''null'' : attendu refus du CHECK, obtenu succès';
  exception when check_violation then
    null;
  end;

  -- ── 8. La fonction trigger n'est exécutable par aucun rôle client ────────
  if has_function_privilege('authenticated', 'public.couriers_guard_consents()', 'EXECUTE') then
    v_echecs := v_echecs || '8a. authenticated peut exécuter couriers_guard_consents()';
  end if;
  if has_function_privilege('anon', 'public.couriers_guard_consents()', 'EXECUTE') then
    v_echecs := v_echecs || '8b. anon peut exécuter couriers_guard_consents()';
  end if;

  -- ── Verdict, et annulation de tout le décor ──────────────────────────────
  if array_length(v_echecs, 1) > 0 then
    raise exception E'ÉCHEC — %', array_to_string(v_echecs, E'\n');
  end if;
  raise exception 'OK — les 8 scénarios de couriers.consents passent (transaction annulée, rien ne persiste).';
end;
$$;
