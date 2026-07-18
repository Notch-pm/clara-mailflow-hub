-- search_couriers : servir aussi les listes de courriers, pas seulement la Recherche.
--
-- POURQUOI. Les pages de liste (Boîte aux lettres, En instruction, Traités,
-- Archives, Entrants, Sortants) appliquaient leurs filtres service/état/tag en
-- JavaScript APRÈS un LIMIT serveur : filtrer ne cherchait que dans les 50 à 200
-- lignes déjà chargées. À 5 000 courriers les listes filtrées sont fausses. Le
-- filtre RBAC par organisation (useUserServiceFilter) souffrait du même défaut,
-- avec en prime une conséquence de confidentialité : la RLS de `couriers` est
-- `is_member_of(organization_id)`, donc au niveau du tenant seulement, et le
-- navigateur d'un agent non-admin recevait les courriers de tous les services.
--
-- CE QUE FAIT CETTE MIGRATION. Étend search_couriers pour accepter des ENSEMBLES
-- d'états et d'organisations, choisir sa colonne de tri, et renvoyer les colonnes
-- que les tableaux affichent (expéditeur, destinataire, tags, canal). Les pages
-- peuvent alors tout filtrer côté serveur et paginer sur un total exact.
--
-- COMPATIBILITÉ. Le changement de type de retour impose DROP + CREATE. On étend
-- en place plutôt que de créer un _v2 : PostgREST résout les RPC par NOM
-- d'argument, donc l'appel à 10 paramètres de RechercheCourrierPage continue de
-- fonctionner tant que les nouveaux paramètres ont une valeur par défaut. Deux
-- fonctions parallèles garantiraient au contraire que la logique RBAC diverge.
-- Ordre de déploiement : SQL d'abord, frontend ensuite.

-- ─── Helper : tsquery à préfixes ────────────────────────────────────────────────
-- Les listes cherchaient via toPrefixTsQuery() côté client (« raccord » trouve
-- « raccordement »). search_couriers utilise websearch_to_tsquery, qui n'accepte
-- que des mots entiers — migrer tel quel ferait régresser la recherche au fil de
-- la frappe. On porte donc la logique de préfixe en SQL, activable au besoin.
--
-- Doit rester le miroir de toPrefixTsQuery() dans src/services/courierService.ts,
-- dont le test unitaire sert de spécification de référence.
--
-- ATTENTION au passage par to_tsquery('french', …) plutôt qu'un cast ::tsquery.
-- Le cast ne racinise pas : il produirait le lexème 'demande':*, alors que
-- fts_subject indexe la racine 'demand'. Un préfixe PLUS LONG que la racine ne
-- matche jamais — mesuré sur ACCM : 0 résultat au lieu de 166. Le client faisait
-- déjà l'équivalent, PostgREST appliquant to_tsquery avec config=french à la
-- chaîne produite par toPrefixTsQuery.
CREATE OR REPLACE FUNCTION public.clara_search_tsquery(p_keywords text, p_prefix boolean)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_keywords IS NULL OR btrim(p_keywords) = '' THEN NULL
    WHEN NOT COALESCE(p_prefix, false) THEN websearch_to_tsquery('french', p_keywords)
    ELSE (
      -- NULLIF sur la forme texte : une saisie entièrement composée de mots vides
      -- (« de la ») donne une tsquery vide, qui ne matcherait rien. On renvoie
      -- NULL pour que l'appelant omette simplement le filtre.
      SELECT NULLIF(to_tsquery('french', string_agg(tok || ':*', ' & '))::text, '')::tsquery
      FROM regexp_split_to_table(
             regexp_replace(p_keywords, '[&|!():*''"\\<>]', ' ', 'g'), '\s+'
           ) AS tok
      WHERE tok <> ''
    )
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.clara_search_tsquery(text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.clara_search_tsquery(text, boolean) TO authenticated;

-- ─── search_couriers ────────────────────────────────────────────────────────────
-- Deux DROP : l'ancienne signature à 10 paramètres (le type de retour change,
-- CREATE OR REPLACE est donc impossible) et la nouvelle, pour que la migration
-- reste rejouable telle quelle.
DROP FUNCTION IF EXISTS public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer);
DROP FUNCTION IF EXISTS public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean);

CREATE FUNCTION public.search_couriers(
  -- Paramètres existants : ordre, noms et types inchangés (compat PostgREST).
  p_organization_id                uuid,
  p_direction                      text    DEFAULT NULL::text,
  p_workflow_state_id              uuid    DEFAULT NULL::uuid,
  -- Choix de l'utilisateur dans le menu « Service » : correspondance exacte.
  p_socle_organization_id          uuid    DEFAULT NULL::uuid,
  p_keywords                       text    DEFAULT NULL::text,
  p_tag_names                      text[]  DEFAULT NULL::text[],
  p_date_from                      date    DEFAULT NULL::date,
  p_date_to                        date    DEFAULT NULL::date,
  p_limit                          integer DEFAULT 20,
  p_offset                         integer DEFAULT 0,
  -- Nouveaux paramètres, tous optionnels.
  p_workflow_state_ids             uuid[]  DEFAULT NULL::uuid[],
  p_include_null_state             boolean DEFAULT false,
  -- Périmètre RBAC de l'utilisateur. Volontairement nommé différemment de
  -- p_socle_organization_id : les confondre rouvrirait la fuite que cette
  -- migration referme.
  p_visible_socle_organization_ids uuid[]  DEFAULT NULL::uuid[],
  p_sort_by                        text    DEFAULT 'received_at',
  p_prefix_match                   boolean DEFAULT false,
  p_transferred_only               boolean DEFAULT NULL::boolean
)
RETURNS TABLE(
  id uuid,
  subject text,
  direction text,
  channel text,
  chrono text,
  received_at timestamp with time zone,
  sent_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  workflow_state_id uuid,
  assigned_service text,
  socle_organization_id uuid,
  organization_id uuid,
  sender_name text,
  sender_first_name text,
  sender_last_name text,
  recipient_name text,
  tags text[],
  is_transferred boolean,
  -- Courrier reçu au-delà du seuil « volumineux » (posé à l'ingestion IMAP).
  -- Exposé ici plutôt que via metadata : les listes ne rapatrient pas le jsonb.
  is_large_email boolean,
  match_in text[],
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- NB : en LANGUAGE sql, les colonnes de RETURNS TABLE sont des paramètres OUT
  -- et masquent celles de `couriers`. Toute référence doit rester qualifiée.
  WITH tsq AS (
    SELECT public.clara_search_tsquery(p_keywords, p_prefix_match) AS q
  ),
  -- Ne porte que l'identifiant et les clés de tri : tout ce qui coûte cher
  -- (participants, tags, événements) est calculé plus bas, sur la seule page
  -- retenue. L'ancienne version calculait match_in pour CHAQUE ligne filtrée
  -- avant d'en jeter tout sauf p_limit.
  filtered AS (
    SELECT c.id, c.received_at, c.created_at, c.updated_at
    FROM couriers c
    WHERE c.organization_id = p_organization_id
      AND public.is_member_of(p_organization_id)
      AND (p_direction IS NULL OR c.direction = p_direction::courier_direction)
      AND (p_workflow_state_id IS NULL OR c.workflow_state_id = p_workflow_state_id)
      -- Ensemble d'états, et/ou courriers sans état (boîte aux lettres).
      AND (
            (p_workflow_state_ids IS NULL AND NOT COALESCE(p_include_null_state, false))
         OR (p_workflow_state_ids IS NOT NULL AND c.workflow_state_id = ANY(p_workflow_state_ids))
         OR (COALESCE(p_include_null_state, false) AND c.workflow_state_id IS NULL)
      )
      AND (p_socle_organization_id IS NULL OR c.socle_organization_id = p_socle_organization_id)
      -- RBAC, reproduit à l'identique depuis applyServiceFilter() :
      -- NULL = aucune restriction (admin/superadmin) ; sinon les organisations
      -- autorisées PLUS les courriers non assignés, visibles de tous. Un tableau
      -- vide ne laisse donc passer que les non assignés — `x = ANY('{}')` est
      -- faux tandis que la disjonction IS NULL reste vraie.
      AND (
            p_visible_socle_organization_ids IS NULL
         OR c.socle_organization_id IS NULL
         OR c.socle_organization_id = ANY(p_visible_socle_organization_ids)
      )
      AND (p_date_from IS NULL OR c.received_at::date >= p_date_from)
      AND (p_date_to   IS NULL OR c.received_at::date <= p_date_to)
      AND (p_tag_names IS NULL OR (c.metadata->'tags') ?| p_tag_names)
      AND (
        p_transferred_only IS NULL
        OR p_transferred_only = EXISTS (
             SELECT 1 FROM courier_events ce
             WHERE ce.courier_id = c.id AND ce.event_type = 'service_transferred'
           )
      )
      AND (
            (SELECT q FROM tsq) IS NULL
         OR c.fts_subject @@ (SELECT q FROM tsq)
         OR c.fts_body    @@ (SELECT q FROM tsq)
         OR EXISTS (
              SELECT 1 FROM courier_participants cp
              WHERE cp.courier_id = c.id AND cp.fts_participant @@ (SELECT q FROM tsq)
            )
         OR EXISTS (
              SELECT 1 FROM courier_document_extracts de
              WHERE de.courier_id = c.id AND de.fts_extract @@ (SELECT q FROM tsq)
            )
      )
  ),
  paged AS (
    SELECT f.id, COUNT(*) OVER() AS total_count
    FROM filtered f
    ORDER BY
      (CASE p_sort_by
         WHEN 'updated_at' THEN f.updated_at
         WHEN 'created_at' THEN f.created_at
         ELSE COALESCE(f.received_at, f.created_at)
       END) DESC,
      -- Départage obligatoire : sans lui, deux courriers partageant un horodatage
      -- (import en masse) peuvent être dupliqués ou sautés entre deux pages.
      f.id DESC
    LIMIT p_limit
    OFFSET p_offset
  ),
  result_set AS (
    SELECT
      c.id,
      c.subject,
      c.direction::text,
      c.channel::text,
      c.chrono,
      c.received_at,
      c.sent_at,
      c.created_at,
      c.updated_at,
      c.workflow_state_id,
      c.assigned_service,
      c.socle_organization_id,
      c.organization_id,
      COALESCE(NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), s.name, s.email) AS sender_name,
      s.first_name AS sender_first_name,
      s.last_name  AS sender_last_name,
      COALESCE(NULLIF(btrim(concat_ws(' ', r.first_name, r.last_name)), ''), r.name, r.email) AS recipient_name,
      -- metadata->'tags' n'est pas garanti être un tableau : jsonb_array_elements_text
      -- lèverait une erreur sur un scalaire.
      CASE WHEN jsonb_typeof(c.metadata->'tags') = 'array'
        THEN COALESCE(
               (SELECT array_agg(t) FROM jsonb_array_elements_text(c.metadata->'tags') AS t),
               '{}'::text[])
        ELSE '{}'::text[]
      END AS tags,
      EXISTS (
        SELECT 1 FROM courier_events ce
        WHERE ce.courier_id = c.id AND ce.event_type = 'service_transferred'
      ) AS is_transferred,
      -- jsonb_typeof plutôt qu'un cast direct : metadata est libre, et un
      -- ::boolean sur une valeur non booléenne ferait échouer TOUTE la requête.
      CASE WHEN jsonb_typeof(c.metadata->'is_large_email') = 'boolean'
        THEN (c.metadata->>'is_large_email')::boolean
        ELSE false
      END AS is_large_email,
      array_remove(ARRAY[
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND c.fts_subject @@ (SELECT q FROM tsq)
             THEN 'subject' END,
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND c.fts_body @@ (SELECT q FROM tsq)
             THEN 'body' END,
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND EXISTS (
               SELECT 1 FROM courier_participants cp
               WHERE cp.courier_id = c.id AND cp.fts_participant @@ (SELECT q FROM tsq))
             THEN 'participants' END,
        CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND EXISTS (
               SELECT 1 FROM courier_document_extracts de
               WHERE de.courier_id = c.id AND de.fts_extract @@ (SELECT q FROM tsq))
             THEN 'documents' END
      ], NULL) AS match_in,
      p.total_count
    FROM paged p
    JOIN couriers c ON c.id = p.id
    -- ORDER BY cp.id : rend le choix déterministe quand un courrier porte
    -- plusieurs participants du même rôle (le .find() JS dépendait de l'ordre
    -- de sérialisation PostgREST).
    LEFT JOIN LATERAL (
      SELECT cp.first_name, cp.last_name, cp.name, cp.email
      FROM courier_participants cp
      WHERE cp.courier_id = c.id AND cp.role = 'sender'
      ORDER BY cp.id
      LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT cp.first_name, cp.last_name, cp.name, cp.email
      FROM courier_participants cp
      WHERE cp.courier_id = c.id AND cp.role = 'recipient'
      ORDER BY cp.id
      LIMIT 1
    ) r ON true
    -- La jointure sur `couriers` détruit l'ordre de `paged` : il faut le refaire,
    -- avec la même expression et le même départage.
    ORDER BY
      (CASE p_sort_by
         WHEN 'updated_at' THEN c.updated_at
         WHEN 'created_at' THEN c.created_at
         ELSE COALESCE(c.received_at, c.created_at)
       END) DESC,
      c.id DESC
  )
  SELECT * FROM result_set;
$function$;

-- CREATE FUNCTION réattribue EXECUTE à PUBLIC. Sur une fonction SECURITY DEFINER
-- cela la rend appelable par `anon` : c'est exactement l'incident réparé par
-- 20260707150442 puis 20260711210000. Ne pas retirer ces deux lignes.
REVOKE EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean) TO authenticated;

-- ─── Index ──────────────────────────────────────────────────────────────────────
-- (organization_id, received_at DESC) et (organization_id, created_at DESC)
-- existent déjà (20260518100000 et 20260718140000).
CREATE INDEX IF NOT EXISTS idx_couriers_org_updated_at
  ON public.couriers (organization_id, updated_at DESC);

-- jsonb_ops et non jsonb_path_ops : ce dernier ne supporte pas l'opérateur ?|
-- utilisé par le filtre de tags.
CREATE INDEX IF NOT EXISTS idx_couriers_metadata_tags
  ON public.couriers USING gin ((metadata -> 'tags'));

CREATE INDEX IF NOT EXISTS idx_courier_participants_courier_role
  ON public.courier_participants (courier_id, role);

CREATE INDEX IF NOT EXISTS idx_courier_events_transferred
  ON public.courier_events (courier_id)
  WHERE event_type = 'service_transferred';
