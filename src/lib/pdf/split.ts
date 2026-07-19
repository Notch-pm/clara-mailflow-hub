// Découpage d'un PDF en plusieurs fichiers par groupes de pages (1-based).
// Logique pure + génération pdf-lib, utilisée par le dialogue de séparation
// de l'import en masse. pdf-lib est chargé en dynamic import : il ne pèse
// sur le bundle que si l'utilisateur découpe réellement un PDF.

/** Formate une liste de pages en plages lisibles : [1,2,3] → "1-3" ; [1,2,4,5] → "1-2, 4-5" ; [6,8] → "6, 8". */
export function formatPageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const p of sorted.slice(1)) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = p;
    prev = p;
  }
  if (start !== undefined) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(", ");
}

/** Retire l'extension ".pdf" finale (insensible à la casse) sans toucher aux autres points du nom. */
export function stripPdfExt(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

/** Nom du fichier d'un segment : "facture — pages 1-3.pdf" ; une seule page → "facture — page 4.pdf". */
export function segmentFileName(originalName: string, pages: number[]): string {
  const label = pages.length === 1 ? `page ${pages[0]}` : `pages ${formatPageList(pages)}`;
  return `${stripPdfExt(originalName)} — ${label}.pdf`;
}

/** Nom du fichier « reste » : "facture — reste (p. 6, 8).pdf". */
export function restFileName(originalName: string, pages: number[]): string {
  return `${stripPdfExt(originalName)} — reste (p. ${formatPageList(pages)}).pdf`;
}

/** Pages (1-based) non affectées à aucun groupe, dans l'ordre croissant. */
export function computeRestPages(pageCount: number, groups: number[][]): number[] {
  const assigned = new Set(groups.flat());
  const rest: number[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (!assigned.has(p)) rest.push(p);
  }
  return rest;
}

/**
 * Génère un PDF par groupe de pages (1-based, tri croissant appliqué).
 * Opère sur des bytes purs pour rester testable sous Vitest/jsdom.
 */
export async function splitPdfBytes(
  srcBytes: ArrayBuffer | Uint8Array,
  groups: number[][],
): Promise<Uint8Array[]> {
  const { PDFDocument } = await import("pdf-lib");
  // ignoreEncryption : les PDF « owner-protected » que le navigateur sait
  // afficher doivent rester découpables ; une vraie corruption échouera ici.
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const outputs: Uint8Array[] = [];
  for (const group of groups) {
    const indices = [...group].sort((a, b) => a - b).map((p) => p - 1);
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, indices);
    copied.forEach((page) => doc.addPage(page));
    outputs.push(await doc.save());
  }
  return outputs;
}

export interface SplitFilesResult {
  segments: File[];
  rest: File | null;
}

/**
 * Découpe `source` selon `groups` et produit un `File` par groupe, plus un
 * fichier « reste » regroupant les pages non affectées (null si tout est affecté).
 */
export async function buildSplitFiles(
  source: File,
  groups: number[][],
  pageCount: number,
): Promise<SplitFilesResult> {
  const restPages = computeRestPages(pageCount, groups);
  const allGroups = restPages.length > 0 ? [...groups, restPages] : groups;
  const srcBytes = await source.arrayBuffer();
  const outputs = await splitPdfBytes(srcBytes, allGroups);

  const toFile = (bytes: Uint8Array, name: string) =>
    new File([bytes as BlobPart], name, { type: "application/pdf" });

  const segments = groups.map((pages, i) =>
    toFile(outputs[i], segmentFileName(source.name, pages)),
  );
  const rest =
    restPages.length > 0
      ? toFile(outputs[outputs.length - 1], restFileName(source.name, restPages))
      : null;
  return { segments, rest };
}
