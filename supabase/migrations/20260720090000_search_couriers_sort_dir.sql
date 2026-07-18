-- search_couriers : tri par en-tête de colonne (clé ET sens).
--
-- POURQUOI. Les listes de courriers paginent côté serveur : `data` ne contient
-- qu'une page. Un tri d'en-tête fait par @tanstack/react-table ne réordonnerait
-- donc que les 25 lignes affichées, en laissant croire à un tri global — c'est
-- la raison pour laquelle toutes les colonnes portaient `enableSorting: false`.
-- Pour rendre le tri honnête, il doit descendre jusqu'au RPC.
--
-- CE QUE FAIT CETTE MIGRATION. Élargit `p_sort_by` aux colonnes natives de
-- `couriers` (chrono, objet, organisation, sent_at) et ajoute `p_sort_dir`, le
-- sens étant jusqu'ici câblé en DESC.
--
-- CE QUI RESTE NON TRIABLE, ET POURQUOI. Expéditeur et destinataire viennent de
-- LEFT JOIN LATERAL sur `courier_participants` appliqués APRÈS le LIMIT, donc
-- sur la seule page retenue ; l'état demanderait en plus une jointure sur
-- `workflow_states`. Les remonter dans `filtered` pour pouvoir trier dessus les
-- ferait calculer sur tout le jeu filtré — exactement le coût que la pagination
-- fait économiser. Les pages laissent ces colonnes non triables plutôt que de
-- promettre un tri qu'elles paieraient au prix fort.
--
-- COÛT, mesuré sur le tenant ACCM (5 061 courriers, page 5 de 25) :
--   tri par défaut (received_at)  83 ms
--   tri par objet                108 ms
-- Soit +30 % sur la clé la plus chère. Le même ordre de grandeur qu'avant, parce
-- que `COUNT(*) OVER()` oblige déjà à parcourir tout le jeu filtré avant le
-- découpage, et que l'expression CASE de l'ORDER BY empêchait déjà l'usage d'un
-- index de tri. Aucun index n'est ajouté : un ORDER BY construit sur un CASE
-- dépendant d'un paramètre n'en utiliserait aucun. Si ce surcoût devenait
-- gênant, c'est le `COUNT(*) OVER()` qu'il faudrait attaquer en premier, pas le
-- tri.
--
-- COMPATIBILITÉ. Un paramètre de plus donne une signature différente :
-- CREATE OR REPLACE créerait une SURCHARGE, et PostgREST — qui résout les RPC
-- par nom d'argument — ne saurait plus laquelle appeler. D'où le DROP explicite
-- de la signature à 16 paramètres. Les appelants existants sont préservés :
-- `p_sort_dir` a une valeur par défaut, l'appel à 10 paramètres de
-- RechercheCourrierPage continue de fonctionner.
-- Ordre de déploiement : SQL d'abord, frontend ensuite.

-- Les trois signatures, pour que la migration reste rejouable telle quelle.
DROP FUNCTION IF EXISTS public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer);
DROP FUNCTION IF EXISTS public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean);
DROP FUNCTION IF EXISTS public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean, text);

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
  p_workflow_state_ids             uuid[]  DEFAULT NULL::uuid[],
  p_include_null_state             boolean DEFAULT false,
  -- Périmètre RBAC de l'utilisateur. Volontairement nommé différemment de
  -- p_socle_organization_id : les confondre rouvrirait la fuite refermée par
  -- 20260718150000.
  p_visible_socle_organization_ids uuid[]  DEFAULT NULL::uuid[],
  -- received_at | sent_at | created_at | updated_at | chrono | subject |
  -- assigned_service. Toute autre valeur retombe sur received_at (cf. le CASE
  -- plus bas) : la fonction ne fait jamais confiance à la chaîne reçue.
  p_sort_by                        text    DEFAULT 'received_at',
  p_prefix_match                   boolean DEFAULT false,
  p_transferred_only               boolean DEFAULT NULL::boolean,
  -- Nouveau. 'asc' ou 'desc' ; toute autre valeur vaut 'desc'.
  p_sort_dir                       text    DEFAULT 'desc'
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
  -- retenue.
  filtered AS (
    SELECT
      c.id,
      -- DEUX clés de tri, une par type : une même expression CASE ne peut pas
      -- renvoyer tantôt un timestamp tantôt du texte. Celle qui ne correspond
      -- pas à p_sort_by vaut NULL sur TOUTES les lignes, et ne départage donc
      -- rien dans l'ORDER BY ci-dessous.
      CASE
        WHEN p_sort_by = 'updated_at' THEN c.updated_at
        WHEN p_sort_by = 'created_at' THEN c.created_at
        WHEN p_sort_by = 'sent_at'    THEN c.sent_at
        -- Clés textuelles : surtout PAS de repli sur une date ici, elle
        -- primerait sur la clé texte et le tri demandé serait ignoré.
        WHEN p_sort_by IN ('chrono', 'subject', 'assigned_service') THEN NULL
        -- Défaut ET garde-fou : une clé inconnue retombe sur le tri historique.
        ELSE COALESCE(c.received_at, c.created_at)
      END AS sort_ts,
      -- lower() : tri insensible à la casse. Sans lui, sous une collation « C »,
      -- toutes les majuscules précèdent toutes les minuscules — « Zone » avant
      -- « abri », ce qu'aucun utilisateur ne lit comme un ordre alphabétique.
      lower(CASE p_sort_by
        WHEN 'chrono'           THEN c.chrono
        WHEN 'subject'          THEN c.subject
        WHEN 'assigned_service' THEN c.assigned_service
      END) AS sort_txt
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
      -- RBAC : NULL = aucune restriction (admin/superadmin) ; sinon les
      -- organisations autorisées PLUS les courriers non assignés, visibles de
      -- tous. Un tableau vide ne laisse donc passer que les non assignés.
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
    SELECT f.id, f.sort_ts, f.sort_txt, COUNT(*) OVER() AS total_count
    FROM filtered f
    -- SQL n'admet pas de sens de tri paramétré : on écrit donc un couple
    -- d'expressions par clé, celle du sens non retenu valant NULL sur toutes
    -- les lignes. NULLS LAST des deux côtés pour que les valeurs manquantes
    -- (objet vide, courrier jamais envoyé) finissent en bas quel que soit le
    -- sens, plutôt que de remonter en tête en DESC.
    ORDER BY
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN f.sort_ts  END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN f.sort_ts  END) DESC NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN f.sort_txt END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN f.sort_txt END) DESC NULLS LAST,
      -- Départage obligatoire : sans lui, deux courriers partageant une clé
      -- (import en masse, objets identiques) peuvent être dupliqués ou sautés
      -- entre deux pages. D'autant plus nécessaire que les nouvelles clés
      -- textuelles produisent beaucoup plus d'ex æquo que les horodatages.
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
    -- plusieurs participants du même rôle.
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
    -- La jointure sur `couriers` détruit l'ordre de `paged` : il faut le refaire.
    -- On réutilise les clés calculées par `filtered` et transportées par `paged`
    -- plutôt que de recopier les CASE sur `c` : deux expressions à maintenir en
    -- miroir finissent toujours par diverger, et une divergence ici mélange
    -- silencieusement l'ordre des lignes d'une page.
    ORDER BY
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN p.sort_ts  END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN p.sort_ts  END) DESC NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) =  'asc' THEN p.sort_txt END) ASC  NULLS LAST,
      (CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) <> 'asc' THEN p.sort_txt END) DESC NULLS LAST,
      c.id DESC
  )
  SELECT * FROM result_set;
$function$;

-- CREATE FUNCTION réattribue EXECUTE à PUBLIC. Sur une fonction SECURITY DEFINER
-- cela la rend appelable par `anon` : c'est exactement l'incident réparé par
-- 20260707150442 puis 20260711210000. Ne pas retirer ces deux lignes.
REVOKE EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_couriers(uuid, text, uuid, uuid, text, text[], date, date, integer, integer, uuid[], boolean, uuid[], text, boolean, boolean, text) TO authenticated;
