// Chargement paresseux de pdfjs-dist avec son worker configuré pour Vite.
// Ce module ne doit être importé que depuis les flux qui rendent des pages
// PDF (dialogue de séparation) : pdfjs et son worker restent ainsi hors du
// chunk principal. NB : l'import `?url` est indispensable — `new URL(...)`
// ne résout pas les spécificateurs de paquet sous Vite.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let cached: Promise<typeof import("pdfjs-dist")> | null = null;

export function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!cached) {
    cached = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerSrc;
      return m;
    });
  }
  return cached;
}
