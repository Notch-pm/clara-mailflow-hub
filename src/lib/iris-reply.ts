/**
 * Courrier de réponse déposé par Iris (2026-11-12) : le lien vers la demande
 * Iris dont ce courrier sortant est la réponse (`couriers.iris_*`, posés par la
 * porte `iris-reply-courier`). Quand le courrier part — ou est abandonné —, Iris
 * en est prévenue (`notify-iris-reply`) et clôt la demande.
 *
 * Lecture tolérante : les colonnes ne sont dans les types générés qu'après
 * régénération de `integrations/supabase/types.ts`.
 */
export interface IrisReplyLink {
  requestId: string;
  reference: string | null;
  url: string | null;
}

export function irisReplyLinkOf(courier: unknown): IrisReplyLink | null {
  const c = (courier ?? {}) as { iris_request_id?: unknown; iris_reference?: unknown; iris_url?: unknown };
  if (typeof c.iris_request_id !== "string" || c.iris_request_id === "") return null;
  return {
    requestId: c.iris_request_id,
    reference: typeof c.iris_reference === "string" && c.iris_reference !== "" ? c.iris_reference : null,
    url: typeof c.iris_url === "string" && /^https:\/\//.test(c.iris_url) ? c.iris_url : null,
  };
}
