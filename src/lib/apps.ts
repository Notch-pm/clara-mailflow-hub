/**
 * Registre des applications de la suite Edilumen (marque de l'entreprise Notch).
 *
 * Les quatre produits partagent le même domaine, seul le sous-domaine change :
 * `socle.edilumen.fr`, `iris.edilumen.fr`, `clara.edilumen.fr`, `ariane.edilumen.fr`.
 * Sert au sélecteur d'application de l'en-tête et à l'identité produit du rail latéral.
 */

export type EdilumenAppKey = "socle" | "iris" | "clara" | "ariane";

export interface EdilumenApp {
  key: EdilumenAppKey;
  /** Nom affiché du produit. */
  name: string;
  /** Initiale de la pastille produit (en-tête + rail latéral). */
  initial: string;
  /** Une ligne de contexte, affichée dans le sélecteur d'application. */
  tagline: string;
  url: string;
}

/** Domaine de la suite ; surchargeable pour une recette ou un environnement local. */
const SUITE_DOMAIN = import.meta.env.VITE_EDILUMEN_DOMAIN ?? "edilumen.fr";

/** Application servie par ce dépôt. */
export const CURRENT_APP_KEY: EdilumenAppKey = "clara";

export const EDILUMEN_APPS: EdilumenApp[] = [
  {
    key: "socle",
    name: "Socle",
    initial: "S",
    tagline: "Organisations et paramétrage",
    url: `https://socle.${SUITE_DOMAIN}`,
  },
  {
    key: "iris",
    name: "Iris",
    initial: "I",
    tagline: "Portail des démarches",
    url: `https://iris.${SUITE_DOMAIN}`,
  },
  {
    key: "clara",
    name: "Clara",
    initial: "C",
    tagline: "Gestion du courrier",
    url: `https://clara.${SUITE_DOMAIN}`,
  },
  {
    key: "ariane",
    name: "Ariane",
    initial: "A",
    tagline: "Gestion de file d'attente",
    url: `https://ariane.${SUITE_DOMAIN}`,
  },
];

export const CURRENT_APP: EdilumenApp =
  EDILUMEN_APPS.find((app) => app.key === CURRENT_APP_KEY) ?? EDILUMEN_APPS[0];
