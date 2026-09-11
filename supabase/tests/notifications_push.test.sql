-- ============================================================================
-- Notifications push (Web Push / VAPID) : vérification en base.
--
-- Un seul bloc DO, qui crée son décor, éprouve les invariants, puis se termine
-- TOUJOURS par une exception : la transaction implicite est annulée et la base
-- retrouve son état d'avant (aucune organisation, aucun compte, aucun
-- abonnement ni notification de test ne survit). Le message de l'exception EST
-- le verdict. Motif repris de `smtp_socle.test.sql`.
--
-- À rejouer après toute migration touchant `notifications`, `push_subscriptions`
-- ou leurs fonctions :
--   psql "$SUPABASE_DB_URL" -f supabase/tests/notifications_push.test.sql
-- ou en collant ce fichier dans l'éditeur SQL du projet.
--
-- Quatorze scénarios : décision à l'insertion (1-4), réclamation (5-8),
-- règlement (9-11), désactivation d'un appareil (12) et étanchéité (13-14).
--
-- ⚠️ Le scénario 1 est le cœur : il éprouve que le trigger SECURITY DEFINER
-- voit les appareils d'AUTRUI. C'est le cas d'usage réel — un agent qui
-- transfère un courrier insère une notification pour un COLLÈGUE, et la RLS de
-- `push_subscriptions` ne rend à un client que ses propres lignes. Si le
-- trigger perdait son `SECURITY DEFINER` (ou si la table passait en FORCE ROW
-- LEVEL SECURITY), tout resterait « skipped » sans la moindre erreur.
-- ============================================================================

do $$
declare
  v_org      uuid;
  v_org_nom  constant text := '[TEST SQL] Push ' || substr(gen_random_uuid()::text, 1, 8);
  v_moi      uuid;   -- destinataire AVEC appareil
  v_autre    uuid;   -- destinataire SANS appareil
  v_sub      uuid;   -- abonnement de v_moi
  v_notif    uuid;
  v_echecs   text[] := '{}';
  v_statut   text;
  v_attempts int;
  v_next     timestamptz;
  v_err      text;
  v_count    int;
  v_org_nom_rendu text;
  v_subs     jsonb;
  v_titre    text;
begin
  -- ── Décor : une organisation, deux comptes, un appareil ───────────────────
  insert into public.organizations (name, slug)
    values (v_org_nom, 'test-sql-push-' || gen_random_uuid())
    returning id into v_org;

  insert into public.users (email) values ('test-push-moi-'   || gen_random_uuid() || '@exemple.test')
    returning id into v_moi;
  insert into public.users (email) values ('test-push-autre-' || gen_random_uuid() || '@exemple.test')
    returning id into v_autre;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    values (v_moi, 'https://sonde.invalid/' || gen_random_uuid(), 'cle', 'sel', 'Sonde · Test')
    returning id into v_sub;

  -- ── 1. Destinataire AVEC appareil ⇒ pending ──────────────────────────────
  insert into public.notifications (organization_id, user_id, type, title, resource_id)
    values (v_org, v_moi, 'new_courier', '[TEST] avec appareil', gen_random_uuid())
    returning id, push_status into v_notif, v_statut;
  if v_statut is distinct from 'pending' then
    v_echecs := v_echecs || format('1. destinataire avec appareil : attendu pending, obtenu %L', v_statut);
  end if;

  -- ── 2. Destinataire SANS appareil ⇒ skipped ──────────────────────────────
  insert into public.notifications (organization_id, user_id, type, title, resource_id)
    values (v_org, v_autre, 'courier_transferred', '[TEST] sans appareil', gen_random_uuid())
    returning push_status into v_statut;
  if v_statut is distinct from 'skipped' then
    v_echecs := v_echecs || format('2. destinataire sans appareil : attendu skipped, obtenu %L', v_statut);
  end if;

  -- ── 3. Un appareil DÉSACTIVÉ ne compte pas ───────────────────────────────
  update public.push_subscriptions set disabled_at = now(), disabled_reason = 'test' where id = v_sub;
  insert into public.notifications (organization_id, user_id, type, title, resource_id)
    values (v_org, v_moi, 'new_courier', '[TEST] appareil desactive', gen_random_uuid())
    returning push_status into v_statut;
  if v_statut is distinct from 'skipped' then
    v_echecs := v_echecs || format('3. appareil désactivé : attendu skipped, obtenu %L', v_statut);
  end if;
  update public.push_subscriptions set disabled_at = null, disabled_reason = null where id = v_sub;

  -- ── 4. Un producteur qui pose push_status est ÉCRASÉ ─────────────────────
  -- La règle vit dans le trigger et nulle part ailleurs : c'est ce qui permet
  -- de la changer à UN endroit sans toucher les trois sites d'insertion.
  insert into public.notifications (organization_id, user_id, type, title, resource_id, push_status)
    values (v_org, v_autre, 'new_courier', '[TEST] producteur autoritaire', gen_random_uuid(), 'sent')
    returning push_status into v_statut;
  if v_statut is distinct from 'skipped' then
    v_echecs := v_echecs || format('4. push_status posé par le producteur : attendu écrasé en skipped, obtenu %L', v_statut);
  end if;

  -- ── 5. La réclamation rend la ligne, son organisation et ses appareils ───
  -- ⚠️ UN SEUL appel : la réclamation a des effets de bord (elle marque
  -- 'sending' et consomme une tentative). D'où `get diagnostics` plutôt qu'un
  -- `count(*)` séparé — et pas d'agrégat, `max(jsonb)` n'existe pas.
  select c.organization_name, c.subscriptions, c.title
    into v_org_nom_rendu, v_subs, v_titre
    from public.claim_notification_pushes(50) c
   where c.notification_id = v_notif;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    v_echecs := v_echecs || format('5a. réclamation : attendu 1 ligne, obtenu %s', v_count);
  end if;
  if v_org_nom_rendu is distinct from v_org_nom then
    v_echecs := v_echecs || format('5b. nom d''organisation : attendu %L, obtenu %L', v_org_nom, v_org_nom_rendu);
  end if;
  if coalesce(jsonb_array_length(v_subs), -1) <> 1 then
    v_echecs := v_echecs || format('5c. appareils joints : attendu 1, obtenu %s', coalesce(jsonb_array_length(v_subs), -1));
  end if;
  if v_subs -> 0 ->> 'endpoint' is null or v_subs -> 0 ->> 'p256dh' is null or v_subs -> 0 ->> 'auth' is null then
    v_echecs := v_echecs || '5d. l''abonnement joint doit porter endpoint, p256dh et auth';
  end if;

  -- ── 6. La réclamation marque 'sending' et compte la tentative ────────────
  select push_status, push_attempts into v_statut, v_attempts
    from public.notifications where id = v_notif;
  if v_statut is distinct from 'sending' or v_attempts <> 1 then
    v_echecs := v_echecs || format('6. après réclamation : attendu sending/1, obtenu %L/%s', v_statut, v_attempts);
  end if;

  -- ── 7. Double réclamation impossible ────────────────────────────────────
  -- Deux exécutions du cron qui se chevauchent ne doivent pas expédier deux fois.
  select count(*) into v_count from public.claim_notification_pushes(50) c
   where c.notification_id = v_notif;
  if v_count <> 0 then
    v_echecs := v_echecs || format('7. seconde réclamation : attendu 0 ligne, obtenu %s', v_count);
  end if;

  -- ── 8. Une ligne DÉJÀ LUE est renoncée avant tout appel réseau ──────────
  -- Clara en marque en masse (fn_mark_courier_notifications_read) : le cas est
  -- fréquent, et pousser une notification déjà lue serait du bruit pur.
  insert into public.notifications (organization_id, user_id, type, title, resource_id)
    values (v_org, v_moi, 'new_courier', '[TEST] lue avant envoi', gen_random_uuid())
    returning id into v_notif;
  update public.notifications set read = true where id = v_notif;
  perform public.claim_notification_pushes(50);
  select push_status, push_error into v_statut, v_err
    from public.notifications where id = v_notif;
  if v_statut is distinct from 'skipped' or v_err is distinct from 'lue avant envoi' then
    v_echecs := v_echecs || format('8. ligne lue : attendu skipped/« lue avant envoi », obtenu %L/%L', v_statut, v_err);
  end if;

  -- ── 9. Règlement en succès ⇒ sent ───────────────────────────────────────
  insert into public.notifications (organization_id, user_id, type, title, resource_id)
    values (v_org, v_moi, 'new_courier', '[TEST] reglement', gen_random_uuid())
    returning id into v_notif;
  perform public.claim_notification_pushes(50);
  perform public.settle_notification_push(v_notif, true, null);
  select push_status, push_error into v_statut, v_err from public.notifications where id = v_notif;
  if v_statut is distinct from 'sent' or v_err is not null then
    v_echecs := v_echecs || format('9. règlement succès : attendu sent/NULL, obtenu %L/%L', v_statut, v_err);
  end if;

  -- ── 10. Règlement en échec ⇒ retour en file, temporisé ──────────────────
  insert into public.notifications (organization_id, user_id, type, title, resource_id)
    values (v_org, v_moi, 'new_courier', '[TEST] echec temporise', gen_random_uuid())
    returning id into v_notif;
  perform public.claim_notification_pushes(50);
  perform public.settle_notification_push(v_notif, false, 'HTTP 503');
  select push_status, push_next_attempt_at, push_error
    into v_statut, v_next, v_err from public.notifications where id = v_notif;
  if v_statut is distinct from 'pending' or v_next is null or v_err is distinct from 'HTTP 503' then
    v_echecs := v_echecs || format('10a. règlement échec : attendu pending/temporisé/« HTTP 503 », obtenu %L/%L/%L',
                                   v_statut, v_next, v_err);
  end if;
  -- 1 tentative consommée ⇒ 2^1 = 2 minutes d'attente.
  if v_next is not null and v_next <= now() then
    v_echecs := v_echecs || '10b. la temporisation doit repousser la prochaine tentative dans le futur';
  end if;

  -- ── 11. Abandon franc au-delà de 5 tentatives ───────────────────────────
  update public.notifications set push_attempts = 5 where id = v_notif;
  perform public.settle_notification_push(v_notif, false, 'HTTP 500');
  select push_status, push_next_attempt_at into v_statut, v_next
    from public.notifications where id = v_notif;
  if v_statut is distinct from 'failed' or v_next is not null then
    v_echecs := v_echecs || format('11. 6e échec : attendu failed sans temporisation, obtenu %L/%L', v_statut, v_next);
  end if;

  -- ── 12. Un appareil disparu (404/410) est désactivé ─────────────────────
  perform public.disable_push_subscription(v_sub, 'HTTP 410');
  select count(*) into v_count from public.push_subscriptions
   where id = v_sub and disabled_at is not null and disabled_reason = 'HTTP 410';
  if v_count <> 1 then
    v_echecs := v_echecs || '12a. disable_push_subscription doit poser disabled_at et sa raison';
  end if;
  -- …et il ne compte plus comme appareil actif.
  insert into public.notifications (organization_id, user_id, type, title, resource_id)
    values (v_org, v_moi, 'new_courier', '[TEST] apres desactivation', gen_random_uuid())
    returning push_status into v_statut;
  if v_statut is distinct from 'skipped' then
    v_echecs := v_echecs || format('12b. après désactivation : attendu skipped, obtenu %L', v_statut);
  end if;

  -- ── 13. La boîte d'envoi est hors de portée du client ───────────────────
  if has_function_privilege('authenticated', 'public.claim_notification_pushes(int)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.settle_notification_push(uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.disable_push_subscription(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_notification_pushes(int)', 'EXECUTE') then
    v_echecs := v_echecs || '13. les fonctions de la boîte d''envoi ne doivent PAS être exécutables par authenticated/anon';
  end if;

  -- ── 14. L'enregistrement est la SEULE porte d'écriture cliente ──────────
  if not has_function_privilege('authenticated', 'public.register_push_subscription(text,text,text,text)', 'EXECUTE') then
    v_echecs := v_echecs || '14a. register_push_subscription doit être exécutable par authenticated';
  end if;
  if has_function_privilege('anon', 'public.register_push_subscription(text,text,text,text)', 'EXECUTE') then
    v_echecs := v_echecs || '14b. register_push_subscription ne doit PAS être exécutable par anon';
  end if;
  select count(*) into v_count from pg_policies
   where schemaname = 'public' and tablename = 'push_subscriptions' and cmd = 'INSERT';
  if v_count <> 0 then
    v_echecs := v_echecs || format('14c. push_subscriptions ne doit avoir AUCUNE policy INSERT, %s trouvée(s)', v_count);
  end if;

  -- ── Verdict ─────────────────────────────────────────────────────────────
  if array_length(v_echecs, 1) is null then
    raise exception 'PUSH : 14 scénarios OK — transaction annulée, rien n''a persisté.';
  else
    raise exception 'PUSH : % ÉCHEC(S) >> %', array_length(v_echecs, 1), array_to_string(v_echecs, ' || ');
  end if;
end
$$;
