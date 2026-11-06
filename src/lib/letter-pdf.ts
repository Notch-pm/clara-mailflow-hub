// La lettre telle qu'elle part chez le prestataire : son HTML (`renderLetterHtml`)
// rendu en PDF A4 dans le navigateur. Le prestataire n'accepte que du PDF, et
// Deno n'a pas de moteur de rendu HTML : le rendu se fait ici, puis le PDF
// devient l'exemplaire conservé — ce qui est archivé est exactement ce qui part.
//
// Le document est chargé dans un cadre invisible et capturé LÀ (html2canvas sur
// le document du cadre) : ses propres styles, `<head>` du modèle de
// l'organisation compris, s'appliquent. Recopier le corps dans la page, comme
// le fait html2pdf.js, perdait la police, les alignements et les marges.

/** Au-delà, l'envoi en base64 devient trop lourd (limite aussi tenue côté serveur). */
export const MAX_LETTER_PDF_BYTES = 5 * 1024 * 1024;

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 20;
const CONTENT_W_MM = PAGE_W_MM - 2 * MARGIN_MM;
const CONTENT_H_MM = PAGE_H_MM - 2 * MARGIN_MM;
// Largeur utile en pixels CSS (96 dpi) : la lettre s'y met en page comme à l'impression.
const CONTENT_W_PX = Math.round((CONTENT_W_MM / 25.4) * 96);
const SCALE = 2;

/** Attend le chargement des images du document (signature, logo). */
async function imagesLoaded(doc: Document): Promise<void> {
  await Promise.all(
    Array.from(doc.images).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = img.onerror = () => r(); }),
    ),
  );
}

/**
 * Où couper une page : la ligne entièrement blanche la plus basse au-dessus de
 * `target`, cherchée sur `searchSpan` lignes au plus — pour ne pas trancher une
 * ligne de texte. À défaut, `target`.
 */
export function findPageBreak(isBlank: (y: number) => boolean, target: number, searchSpan: number, minY: number): number {
  for (let y = target; y > Math.max(minY, target - searchSpan); y--) {
    if (isBlank(y)) return y;
  }
  return target;
}

function blankRowTester(canvas: HTMLCanvasElement): (y: number) => boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return () => false;
  const { width } = canvas;
  return (y) => {
    const data = ctx.getImageData(0, y, width, 1).data;
    for (let i = 0; i < data.length; i += 16) {
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) return false;
    }
    return true;
  };
}

/** Rend un document HTML complet en PDF A4 (marges de 2 cm). */
export async function renderLetterPdf(html: string, fileName: string): Promise<File> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${CONTENT_W_PX}px;height:1200px;border:0;`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error("Rendu de la lettre impossible."));
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument;
    if (!doc?.body) throw new Error("Rendu de la lettre impossible.");
    await imagesLoaded(doc);
    await doc.fonts?.ready;
    // Les marges @page ne s'appliquent pas à une capture : celles du PDF les remplacent.
    doc.body.style.margin = "0";
    doc.documentElement.style.background = "#ffffff";

    const canvas = await html2canvas(doc.body, {
      scale: SCALE,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      width: CONTENT_W_PX,
      windowWidth: CONTENT_W_PX,
    });

    const pxPerMm = canvas.width / CONTENT_W_MM;
    const pageH = Math.floor(CONTENT_H_MM * pxPerMm);
    const isBlank = blankRowTester(canvas);
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    let top = 0;
    let first = true;
    while (top < canvas.height) {
      const remaining = canvas.height - top;
      const height = remaining <= pageH
        ? remaining
        : findPageBreak(isBlank, top + pageH, Math.floor(pageH / 4), top + 1) - top;
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = height;
      const ctx = slice.getContext("2d");
      if (!ctx) throw new Error("Rendu de la lettre impossible.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.9), "JPEG", MARGIN_MM, MARGIN_MM, CONTENT_W_MM, height / pxPerMm);
      first = false;
      top += height;
    }

    const blob = pdf.output("blob");
    if (blob.size > MAX_LETTER_PDF_BYTES) {
      throw new Error("La lettre dépasse 5 Mo une fois mise en PDF : allégez-la (images) avant de l'envoyer.");
    }
    return new File([blob], fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`, { type: "application/pdf" });
  } finally {
    frame.remove();
  }
}
