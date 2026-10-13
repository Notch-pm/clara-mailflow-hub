// Pièces jointes d'un courriel sortant : lesquelles partent, lesquelles non.
// LOGIQUE PURE (aucune dépendance Deno), utilisée par `send-courier-reply` et
// testée par vitest.
//
// Règles :
//   • seuls les documents du sortant lui-même, dans son tenant, et rangés sous
//     le préfixe de stockage de ce tenant (`org_<id>/` ou l'ancien `<id>/`) —
//     jamais une clé fournie par le client ;
//   • un plafond en nombre et en taille cumulée : au-delà, l'envoi est REFUSÉ
//     en entier, avant tout contact avec le serveur d'envoi. Un courriel parti
//     sans une partie de ses pièces serait pire qu'un refus.

export interface OutboundDocument {
  id: string;
  organization_id: string;
  courier_id: string;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  storage_key: string | null;
}

export interface AttachmentPlan {
  items: OutboundDocument[];
  /** Motif du refus de l'envoi, ou `null`. */
  refusal: string | null;
}

/** 10 Mo cumulés : en deçà de la limite usuelle des relais (souvent 20 à 25 Mo, base64 compris). */
export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_COUNT = 10;

export function storageKeyBelongsTo(storageKey: string | null | undefined, organizationId: string): boolean {
  if (!storageKey) return false;
  if (storageKey.includes("..")) return false;
  return storageKey.startsWith(`org_${organizationId}/`) || storageKey.startsWith(`${organizationId}/`);
}

function formatMo(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

export function planOutboundAttachments(
  docs: OutboundDocument[],
  ctx: { courierId: string; organizationId: string },
  limits: { maxBytes?: number; maxCount?: number } = {},
): AttachmentPlan {
  const maxBytes = limits.maxBytes ?? MAX_ATTACHMENTS_BYTES;
  const maxCount = limits.maxCount ?? MAX_ATTACHMENTS_COUNT;

  const items = docs.filter(
    (d) =>
      d.courier_id === ctx.courierId &&
      d.organization_id === ctx.organizationId &&
      storageKeyBelongsTo(d.storage_key, ctx.organizationId),
  );
  if (items.length > maxCount) {
    return {
      items: [],
      refusal: `Trop de pièces jointes (${items.length}) : un courriel en emporte ${maxCount} au plus. Retirez-en avant d'envoyer.`,
    };
  }
  const total = items.reduce((sum, d) => sum + (d.file_size ?? 0), 0);
  if (total > maxBytes) {
    return {
      items: [],
      refusal: `Pièces jointes trop lourdes (${formatMo(total)}) : un courriel en emporte ${formatMo(maxBytes)} au plus. Retirez-en ou envoyez par courrier.`,
    };
  }
  return { items, refusal: null };
}
