/**
 * Le schéma de sortie, dit au modèle DANS LE PROMPT.
 *
 * ⚠️ POURQUOI CE MODULE EXISTE. Clara forçait autrefois ses extractions
 * structurées par le *tool-calling* de Mistral : un schéma JSON passé dans
 * `tools`, un `tool_choice` qui obligeait le modèle à l'appeler, et des
 * arguments toujours parsables en retour. Le guichet IA du Socle refuse
 * `tools` et `tool_choice` par principe — un outil est un second chemin
 * d'accès aux données, non audité — et n'offre que
 * `response_format: "json"`, qui garantit du JSON **valide** et rien de plus.
 *
 * LE SCHÉMA N'A DONC PAS DISPARU : IL A CHANGÉ DE PLACE. Il passe du champ
 * `tools` au corps du prompt système, tel quel. Le choix de l'envoyer BRUT
 * plutôt que reformulé en prose est délibéré :
 *
 *  • rien ne se perd — les `enum`, les `description`, l'imbrication et les
 *    `required` arrivent intacts, là où une reformulation à la main finirait
 *    par oublier une contrainte le jour où le schéma change ;
 *  • le coût en jetons est le MÊME qu'avant : le schéma était déjà transmis,
 *    dans `tools` plutôt que dans le prompt ;
 *  • les schémas de Clara sont partiellement dynamiques (les `form_schema` des
 *    démarches du Socle) — les décrire en prose demanderait un générateur de
 *    prose, c'est-à-dire ce module en plus compliqué et moins fidèle.
 *
 * ⚠️ CE QUE CELA NE GARANTIT PAS, ET QUI COMPTE : le modèle peut rendre du
 * JSON valide et hors schéma. Il le pouvait DÉJÀ avec le tool-calling — un
 * schéma d'outil n'a jamais empêché d'inventer un `procedure_id` bien formé
 * mais inexistant. La revalidation côté Clara (tags de l'organisation,
 * identifiants de démarches, champs connus du formulaire) était donc déjà la
 * vraie défense, et elle le reste. Ne la retirez pas en croyant que le schéma
 * dans le prompt en tient lieu.
 *
 * Module PUR, testé.
 */

/**
 * Le bloc à coller en fin de prompt système.
 *
 * ⚠️ LE MOT « JSON » DOIT S'Y TROUVER, et ce n'est pas une tournure de style :
 * le mode JSON du fournisseur l'exige dans le prompt, et le guichet refuse
 * l'appel en `400` s'il ne l'y trouve pas — avant toute dépense. Ce bloc est
 * l'endroit qui garantit sa présence pour tous les appelants à la fois.
 */
export function jsonSchemaInstruction(schema: Record<string, unknown>): string {
  return `Réponds UNIQUEMENT par un objet JSON conforme au schéma JSON ci-dessous.
Aucun texte avant ou après, aucune clôture markdown, aucun commentaire.
Toutes les clés listées dans "required" doivent être présentes ; utilise une chaîne vide (ou un tableau vide) pour ce que le document ne dit pas.

Schéma JSON de la réponse attendue :
${JSON.stringify(schema, null, 2)}`;
}

/**
 * Schéma d'objet, à la forme que prenaient les `parameters` d'un outil.
 *
 * Conservée à l'identique pour que les schémas existants de Clara traversent
 * la bascule sans être réécrits : `additionalProperties: false` et `required`
 * gardent leur sens de documentation pour le modèle, même si plus personne ne
 * les fait respecter côté fournisseur. C'est la revalidation de Clara qui les
 * fait respecter — comme avant.
 */
export function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}
