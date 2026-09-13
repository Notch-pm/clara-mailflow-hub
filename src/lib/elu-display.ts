/**
 * Initiales d'une organisation, pour la tuile qui remplace un logo manquant.
 *
 * Deux familles de mots s'écartent, et pas de la même façon :
 *
 * - les **mots-outils** (de, du, la, l'…) ne portent jamais d'initiale ;
 * - les **termes génériques** de collectivité (communauté, commune, ville…)
 *   s'effacent devant le nom propre — « Communauté de communes du Vexin »
 *   donne « V », sans quoi toutes les intercommunalités d'un département
 *   porteraient les mêmes lettres.
 *
 * Mais un nom qui n'est FAIT que de termes génériques doit bien rendre quelque
 * chose : « Communauté de communes » retombe alors sur « CC ». D'où deux
 * ensembles distincts, et non un seul.
 */
const STOP_WORDS = new Set(["de", "du", "des", "la", "le", "les", "d", "l", "et", "en", "au", "aux"]);

const GENERIC_WORDS = new Set([
  "communaute", "communautes", "commune", "communes", "ville", "villes",
  "agglomeration", "agglomerations", "agglo", "syndicat", "mairie", "conseil",
  "pays", "territoire", "metropole",
]);

function fold(word: string): string {
  return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function orgInitials(name: string | null | undefined, max = 3): string {
  if (!name) return "?";
  const words = name
    .split(/[\s'’\-–—/,.]+/)
    .filter(Boolean)
    // Un « mot » sans lettre (numéro, ponctuation seule) n'a pas d'initiale.
    .filter((w) => /\p{L}/u.test(w));

  const withoutStopWords = words.filter((w) => !STOP_WORDS.has(fold(w)));
  const meaningful = withoutStopWords.filter((w) => !GENERIC_WORDS.has(fold(w)));
  const source = meaningful.length > 0 ? meaningful : withoutStopWords;
  if (source.length === 0) return "?";

  return source
    .slice(0, max)
    // La PREMIÈRE LETTRE, pas le premier caractère : un nom entre crochets ou
    // ouvert par un guillemet donnerait sinon une initiale en ponctuation.
    .map((w) => w.match(/\p{L}/u)![0].toUpperCase())
    .join("");
}

/** Initiales d'une personne, sur le motif déjà employé par `AppHeader`. */
export function personInitials(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName?.[0], lastName?.[0]].filter(Boolean).join("").toUpperCase() || "U";
}
