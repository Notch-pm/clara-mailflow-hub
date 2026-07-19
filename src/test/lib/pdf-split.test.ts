import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  computeRestPages,
  formatPageList,
  restFileName,
  segmentFileName,
  splitPdfBytes,
  stripPdfExt,
} from "@/lib/pdf/split";
import { getGroupIds, nextGroupId, type BulkFile } from "@/components/courier/bulk/types";

describe("formatPageList", () => {
  it("fusionne les pages contiguës en plages", () => {
    expect(formatPageList([1, 2, 3])).toBe("1-3");
    expect(formatPageList([1, 2, 4, 5])).toBe("1-2, 4-5");
    expect(formatPageList([6, 8])).toBe("6, 8");
    expect(formatPageList([4])).toBe("4");
  });

  it("trie les pages avant de formater", () => {
    expect(formatPageList([3, 1, 2])).toBe("1-3");
    expect(formatPageList([8, 6])).toBe("6, 8");
  });
});

describe("stripPdfExt", () => {
  it("retire uniquement l'extension .pdf finale", () => {
    expect(stripPdfExt("facture.pdf")).toBe("facture");
    expect(stripPdfExt("facture.PDF")).toBe("facture");
    expect(stripPdfExt("scan.2024.pdf")).toBe("scan.2024");
    expect(stripPdfExt("sans-extension")).toBe("sans-extension");
  });
});

describe("segmentFileName / restFileName", () => {
  it("nomme un segment multi-pages", () => {
    expect(segmentFileName("facture.pdf", [1, 2, 3])).toBe("facture — pages 1-3.pdf");
    expect(segmentFileName("facture.pdf", [1, 2, 5])).toBe("facture — pages 1-2, 5.pdf");
  });

  it("nomme un segment d'une seule page", () => {
    expect(segmentFileName("facture.pdf", [4])).toBe("facture — page 4.pdf");
  });

  it("nomme le reste", () => {
    expect(restFileName("facture.pdf", [6, 8])).toBe("facture — reste (p. 6, 8).pdf");
  });

  it("gère un nom sans extension", () => {
    expect(segmentFileName("scan-brut", [1])).toBe("scan-brut — page 1.pdf");
  });
});

describe("computeRestPages", () => {
  it("liste les pages non affectées", () => {
    expect(computeRestPages(8, [[1, 2, 3], [4, 5]])).toEqual([6, 7, 8]);
    expect(computeRestPages(5, [[2], [4]])).toEqual([1, 3, 5]);
  });

  it("retourne vide quand tout est affecté", () => {
    expect(computeRestPages(3, [[1, 3], [2]])).toEqual([]);
  });

  it("retourne toutes les pages sans aucun groupe", () => {
    expect(computeRestPages(3, [])).toEqual([1, 2, 3]);
  });
});

describe("splitPdfBytes", () => {
  async function buildSourcePdf(): Promise<Uint8Array> {
    // 5 pages de largeurs distinctes (100, 200, … 500) pour tracer le mapping.
    const doc = await PDFDocument.create();
    for (let i = 1; i <= 5; i++) {
      doc.addPage([i * 100, 800]);
    }
    return doc.save();
  }

  it("extrait les groupes de pages dans l'ordre croissant (round-trip)", async () => {
    const src = await buildSourcePdf();
    const outputs = await splitPdfBytes(src, [[1, 2], [4]]);
    expect(outputs).toHaveLength(2);

    const first = await PDFDocument.load(outputs[0]);
    expect(first.getPageCount()).toBe(2);
    expect(first.getPage(0).getWidth()).toBe(100);
    expect(first.getPage(1).getWidth()).toBe(200);

    const second = await PDFDocument.load(outputs[1]);
    expect(second.getPageCount()).toBe(1);
    expect(second.getPage(0).getWidth()).toBe(400);
  });

  it("trie les pages d'un groupe fourni dans le désordre", async () => {
    const src = await buildSourcePdf();
    const [out] = await splitPdfBytes(src, [[5, 3]]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(300);
    expect(doc.getPage(1).getWidth()).toBe(500);
  });
});

describe("getGroupIds / nextGroupId", () => {
  const bf = (groupId: number | null, rejected = false): BulkFile => ({
    id: crypto.randomUUID(),
    file: new File([], "x.pdf", { type: "application/pdf" }),
    previewUrl: "",
    groupId,
    rejected,
  });

  it("liste les groupIds triés en ignorant rejetés et non associés", () => {
    expect(getGroupIds([bf(3), bf(1), bf(null), bf(2, true)])).toEqual([1, 3]);
  });

  it("attribue le prochain groupId", () => {
    expect(nextGroupId([])).toBe(1);
    expect(nextGroupId([bf(2), bf(5)])).toBe(6);
  });
});
