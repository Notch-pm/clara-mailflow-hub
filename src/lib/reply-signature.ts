import { stripSignatureBlock } from "@/services/courierReplyService";

/**
 * Le bloc de signature apposé au bas d'une réponse.
 *
 * Extrait de `ReplyComposer` pour que l'espace élu signe EXACTEMENT comme
 * l'application complète. Deux rédactions du même HTML auraient divergé au
 * premier correctif — et la divergence n'aurait sauté aux yeux de personne,
 * puisque les deux produisent un courrier d'apparence correcte.
 *
 * Le marqueur `alt="signature-clara"` est ce que `stripSignatureBlock` repère
 * pour retirer une signature précédente : ne pas le changer sans lire
 * `courierReplyService.stripSignatureBlock`.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSignatureBlock({
  fullName,
  title,
  signatureDataUrl,
}: {
  fullName: string;
  title: string | null;
  signatureDataUrl: string;
}): string {
  const titleParagraph = title ? `<p><em>${escapeHtml(title)}</em></p>` : "";
  return [
    `<p>&nbsp;</p>`,
    `<hr>`,
    `<p><strong>${escapeHtml(fullName)}</strong></p>`,
    titleParagraph,
    `<p><img src="${signatureDataUrl}" alt="signature-clara" style="max-width:200px;max-height:80px;" /></p>`,
  ].join("");
}

/** Remplace la signature existante s'il y en a une, plutôt que d'en empiler deux. */
export function appendSignature(body: string, block: string): string {
  return `${stripSignatureBlock(body)}${block}`;
}

/** Lit l'image derrière une URL signée et la convertit en `data:` — un courriel ne suit pas de lien temporaire. */
export async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Téléchargement de la signature échoué.");
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Lecture de la signature échouée."));
    reader.readAsDataURL(blob);
  });
}
