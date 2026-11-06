-- Recherche : un courrier se trouve par sa référence (chrono), entrant ou sortant (2026-11-06).
--
-- `search_couriers` ne comparait la référence (`2026-E-00032`, `2026-S-00007`)
-- qu'aux courriers confidentiels ILLISIBLES par l'appelant — pour lesquels elle
-- est le seul champ exposé. Pour tous les autres, la recherche ne passait que
-- par l'index plein texte de l'objet, du corps, des participants et des pièces,
-- où la référence ne figure pas : taper une référence dans la barre du haut ou
-- dans une liste ne trouvait rien. Signalé sur un courrier sortant.
--
-- La référence est désormais comparée pour tout courrier (ILIKE, comme avant
-- pour les confidentiels) : elle n'est pas un contenu protégé, elle s'affiche
-- déjà dans les listes, confidentiel compris.
--
-- Même procédé que 20261024162107_perimetre_auteur.sql : réécriture textuelle
-- de la définition en base, idempotente, en échec si le motif est introuvable.
DO $$
DECLARE
  def text;
  old_clause constant text := '(NOT b.readable AND b.chrono ILIKE ''%'' || btrim(p_keywords) || ''%'')';
  new_clause constant text := '(/* reference_pour_tous */ b.chrono ILIKE ''%'' || btrim(p_keywords) || ''%'')';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'search_couriers';
  IF position('reference_pour_tous' in def) > 0 THEN
    RETURN;
  END IF;
  IF position(old_clause in def) = 0 THEN
    RAISE EXCEPTION 'recherche_par_reference : clause de référence introuvable dans search_couriers';
  END IF;
  EXECUTE replace(def, old_clause, new_clause);
END $$;
