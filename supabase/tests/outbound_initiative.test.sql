-- ============================================================================
-- Courriers sortants à l'initiative de la collectivité : garde et création.
--
-- Un seul bloc DO, qui crée son décor, éprouve les invariants, puis se termine
-- TOUJOURS par une exception : la transaction est annulée, rien ne survit. Le
-- message de l'exception EST le verdict (motif de `courier_consents.test.sql`).
--
-- À rejouer après toute migration touchant `couriers`, ses triggers,
-- `outbound_initiative_block_reason` ou `create_outbound_courier` :
--   psql "$SUPABASE_DB_URL" -f supabase/tests/outbound_initiative.test.sql
--
-- ⚠️ Joué en propriétaire de la base : la RLS n'est pas éprouvée ici (un
-- consultant refusé, un autre tenant) — c'est le rôle de
-- `src/test-integration/sortants-initiative.itest.ts`.
-- ============================================================================

do $$
declare
  v_org      uuid;
  v_other    uuid;
  v_wf_in    uuid;
  v_wf_r     uuid;
  v_wf_r2    uuid;
  v_init     uuid;
  v_sign     uuid;
  v_init2    uuid;
  v_so       uuid;
  v_so2      uuid;
  v_so_nowf  uuid;
  v_so_old   uuid;
  v_so_alien uuid;
  v_s1       uuid;
  v_s2       uuid;
  v_shell    uuid;
  v_parent   uuid;
  v_chrono1  text;
  v_chrono2  text;
  v_n        int;
  v_echecs   text[] := '{}';
  v_err      text;
  v_recipient constant jsonb := '{"socle_contact_id":"11111111-1111-1111-1111-111111111111","name":"Jean Martin","email":"jean.martin@example.org","address_line1":"3 rue X","postal_code":"27000","city":"Évreux"}';
begin
  -- ── Décor ────────────────────────────────────────────────────────────────
  insert into public.organizations (name, slug)
    values ('[TEST SQL] Sortants ' || substr(gen_random_uuid()::text, 1, 8), 'test-sql-sortants-' || gen_random_uuid())
    returning id into v_org;
  insert into public.organizations (name, slug)
    values ('[TEST SQL] Autre ' || substr(gen_random_uuid()::text, 1, 8), 'test-sql-autre-' || gen_random_uuid())
    returning id into v_other;

  insert into public.workflows (organization_id, name, type) values (v_org, 'Entrant', 'inbound') returning id into v_wf_in;
  insert into public.workflows (organization_id, name, type) values (v_org, 'Réponse', 'reply') returning id into v_wf_r;
  insert into public.workflows (organization_id, name, type) values (v_org, 'Réponse 2', 'reply') returning id into v_wf_r2;
  insert into public.workflow_states (organization_id, workflow_id, name, category, is_initial)
    values (v_org, v_wf_r, 'Rédaction', 'pending', true) returning id into v_init;
  insert into public.workflow_states (organization_id, workflow_id, name, category, requires_signature)
    values (v_org, v_wf_r, 'Signature', 'processing', true) returning id into v_sign;
  insert into public.workflow_transitions (organization_id, workflow_id, from_state_id, to_state_id, kind)
    values (v_org, v_wf_r, v_init, v_sign, 'next');
  insert into public.workflow_states (organization_id, workflow_id, name, category, is_initial)
    values (v_org, v_wf_r2, 'Rédaction 2', 'pending', true) returning id into v_init2;

  insert into public.socle_organizations (organization_id, socle_id, name, reply_workflow_id, workflow_id)
    values (v_org, gen_random_uuid(), 'Cabinet', v_wf_r, v_wf_in) returning id into v_so;
  insert into public.socle_organizations (organization_id, socle_id, name, reply_workflow_id)
    values (v_org, gen_random_uuid(), 'Culture', v_wf_r2) returning id into v_so2;
  insert into public.socle_organizations (organization_id, socle_id, name)
    values (v_org, gen_random_uuid(), 'Sans workflow') returning id into v_so_nowf;
  insert into public.socle_organizations (organization_id, socle_id, name, reply_workflow_id, status)
    values (v_org, gen_random_uuid(), 'Ancienne', v_wf_r, 'obsolete') returning id into v_so_old;
  insert into public.socle_organizations (organization_id, socle_id, name)
    values (v_other, gen_random_uuid(), 'Étrangère') returning id into v_so_alien;

  -- Hors contexte de service.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('clara.bypass_transition_guard', '', true);

  -- ── 1. Création nominale par la RPC ──────────────────────────────────────
  v_s1 := public.create_outbound_courier(v_org, v_so, 'email', '  Convocation  ', v_recipient);
  select count(*) into v_n from public.couriers c
   where c.id = v_s1 and c.direction = 'outbound' and c.parent_courier_id is null
     and c.socle_organization_id = v_so and c.workflow_state_id = v_init
     and c.subject = 'Convocation' and c.sent_at is null and c.assigned_service = 'Cabinet'
     and c.consents = '[]'::jsonb and c.chrono like '%-S-%';
  if v_n <> 1 then v_echecs := v_echecs || '1. création : courrier mal formé'::text; end if;
  select count(*) into v_n from public.courier_participants p
   where p.courier_id = v_s1 and p.role = 'recipient'
     and p.socle_contact_id = '11111111-1111-1111-1111-111111111111'
     and p.metadata ->> 'postal_code' = '27000';
  if v_n <> 1 then v_echecs := v_echecs || '1. création : destinataire absent ou incomplet'::text; end if;
  select count(*) into v_n from public.courier_events e
   where e.courier_id = v_s1 and e.event_type = 'outbound_created' and e.payload ->> 'reply_id' = v_s1::text;
  if v_n <> 1 then v_echecs := v_echecs || '1. création : événement outbound_created absent'::text; end if;

  -- ── 2. Le registre S est partagé, et suit ────────────────────────────────
  v_s2 := public.create_outbound_courier(v_org, v_so, 'paper', 'Information', v_recipient);
  select chrono into v_chrono1 from public.couriers where id = v_s1;
  select chrono into v_chrono2 from public.couriers where id = v_s2;
  if right(v_chrono2, 5)::int <> right(v_chrono1, 5)::int + 1 then
    v_echecs := v_echecs || format('2. registre : %s puis %s', v_chrono1, v_chrono2);
  end if;

  -- ── 3. Refus de la RPC et de l'INSERT direct ─────────────────────────────
  begin
    perform public.create_outbound_courier(v_org, v_so_nowf, 'email', 'X', v_recipient);
    v_echecs := v_echecs || '3a. organisation sans workflow de réponse : attendu refus'::text;
  exception when raise_exception then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%Aucun workflow de réponse%Sans workflow%' then
      v_echecs := v_echecs || format('3a. motif inattendu : %s', v_err);
    end if;
  end;
  begin
    perform public.create_outbound_courier(v_org, v_so_old, 'email', 'X', v_recipient);
    v_echecs := v_echecs || '3b. organisation obsolète : attendu refus'::text;
  exception when raise_exception then null;
  end;
  begin
    perform public.create_outbound_courier(v_org, v_so_alien, 'email', 'X', v_recipient);
    v_echecs := v_echecs || '3c. organisation d''un autre tenant : attendu refus'::text;
  exception when raise_exception then null;
  end;
  begin
    perform public.create_outbound_courier(v_org, v_so, 'portal', 'X', v_recipient);
    v_echecs := v_echecs || '3d. canal portail : attendu refus'::text;
  exception when raise_exception then null;
  end;
  begin
    perform public.create_outbound_courier(v_org, v_so, 'email', 'X', '{"name":"Sans fiche"}');
    v_echecs := v_echecs || '3e. destinataire hors référentiel : attendu refus'::text;
  exception when raise_exception then null;
  end;
  begin
    perform public.create_outbound_courier(v_org, v_so, 'email', '   ', v_recipient);
    v_echecs := v_echecs || '3f. objet vide : attendu refus'::text;
  exception when raise_exception then null;
  end;
  begin
    insert into public.couriers (organization_id, direction, channel, subject)
      values (v_org, 'outbound', 'paper', 'Coquille directe');
    v_echecs := v_echecs || '3g. INSERT direct sans organisation : attendu refus'::text;
  exception when raise_exception then null;
  end;
  begin
    insert into public.couriers (organization_id, direction, channel, subject, socle_organization_id, workflow_state_id)
      values (v_org, 'outbound', 'paper', 'Pas initial', v_so, v_sign);
    v_echecs := v_echecs || '3h. INSERT direct à un état non initial : attendu refus'::text;
  exception when raise_exception then null;
  end;

  -- ── 4. Changement d'organisation et de canal ─────────────────────────────
  update public.couriers set socle_organization_id = v_so2, workflow_state_id = v_init2 where id = v_s2;
  update public.couriers set channel = 'email' where id = v_s2;

  update public.couriers set workflow_state_id = v_sign where id = v_s1;  -- transition définie
  begin
    update public.couriers set socle_organization_id = v_so2, workflow_state_id = v_init2 where id = v_s1;
    v_echecs := v_echecs || '4a. changer d''organisation hors état initial : attendu refus'::text;
  exception when raise_exception then null;
  end;
  -- Pose de la signature hors garde de signature (aucun utilisateur ici).
  perform set_config('clara.bypass_transition_guard', 'on', true);
  update public.couriers set metadata = metadata || '{"signed_at":"2026-10-13T10:00:00Z"}' where id = v_s1;
  perform set_config('clara.bypass_transition_guard', '', true);
  begin
    update public.couriers set channel = 'paper' where id = v_s1;
    v_echecs := v_echecs || '4b. changer de canal après signature : attendu refus'::text;
  exception when raise_exception then null;
  end;

  -- ── 5. Coquille d'avant le lot : affectation d'une organisation ──────────
  perform set_config('clara.bypass_transition_guard', 'on', true);
  insert into public.couriers (organization_id, direction, channel, subject, sent_at)
    values (v_org, 'outbound', 'paper', 'Coquille historique', now()) returning id into v_shell;
  perform set_config('clara.bypass_transition_guard', '', true);
  update public.couriers set socle_organization_id = v_so where id = v_shell;
  begin
    update public.couriers set socle_organization_id = v_so_alien where id = v_shell;
    v_echecs := v_echecs || '5. coquille vers une organisation étrangère : attendu refus'::text;
  exception when raise_exception then null;
  end;

  -- ── 6. Les réponses (avec parent) ne sont pas concernées ─────────────────
  -- Un courrier reçu déjà traité (état final : la garde des transitions
  -- l'admet d'emblée, la garde de création des réponses aussi).
  insert into public.workflow_states (organization_id, workflow_id, name, category, is_final)
    values (v_org, v_wf_in, 'Traité', 'processed', true) returning id into v_init2;
  insert into public.couriers (organization_id, direction, channel, subject, received_at, socle_organization_id, workflow_state_id)
    values (v_org, 'inbound', 'paper', 'Reçu', now(), v_so, v_init2) returning id into v_parent;
  begin
    -- Ni organisation, ni état, canal portail : ce n'est pas un sortant à
    -- l'initiative, la nouvelle garde ne le regarde pas.
    insert into public.couriers (organization_id, direction, channel, subject, parent_courier_id)
      values (v_org, 'outbound', 'portal', 'Réponse', v_parent);
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_echecs := v_echecs || format('6. réponse avec parent refusée : %s', v_err);
  end;

  -- ── Verdict ──────────────────────────────────────────────────────────────
  if array_length(v_echecs, 1) is null then
    raise exception 'VERDICT : OK — 6 scénarios (transaction annulée)';
  else
    raise exception 'VERDICT : % ÉCHEC(S) — %', array_length(v_echecs, 1), array_to_string(v_echecs, ' | ');
  end if;
end;
$$;
