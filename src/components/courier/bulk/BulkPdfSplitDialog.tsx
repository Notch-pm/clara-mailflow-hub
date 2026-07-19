import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, FileText, FolderPlus, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { loadPdfjs } from "@/lib/pdf/pdfjsLoader";
import { buildSplitFiles, computeRestPages, formatPageList } from "@/lib/pdf/split";
import type { BulkFile } from "./types";

export interface PdfSplitResult {
  originalId: string;
  segments: File[];
  rest: File | null;
}

interface Props {
  file: BulkFile | null;
  maxFileSize: number;
  onClose: () => void;
  onConfirm: (result: PdfSplitResult) => void;
}

// Littéraux complets obligatoires (purge Tailwind) — jamais de `bg-split-${i}`.
const GROUP_BG = ["bg-split-1", "bg-split-2", "bg-split-3", "bg-split-4", "bg-split-5", "bg-split-6"];
const GROUP_BORDER = [
  "border-split-1",
  "border-split-2",
  "border-split-3",
  "border-split-4",
  "border-split-5",
  "border-split-6",
];

const THUMB_WIDTH = 180;

type Status = "loading" | "ready" | "single-page";

export default function BulkPdfSplitDialog({ file, maxFileSize, onClose, onConfirm }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [pageCount, setPageCount] = useState(0);
  const [thumbs, setThumbs] = useState<(string | null)[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groups, setGroups] = useState<number[][]>([]);
  const [building, setBuilding] = useState(false);
  const lastClickRef = useRef<number | null>(null);
  const buildingRef = useRef(false);
  buildingRef.current = building;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const fileId = file?.id ?? null;

  // Chargement du PDF + rendu séquentiel des vignettes (interruptible).
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    const urls: string[] = [];
    let task: { destroy: () => Promise<void> } | null = null;

    setStatus("loading");
    setPageCount(0);
    setThumbs([]);
    setSelected(new Set());
    setGroups([]);
    setBuilding(false);
    lastClickRef.current = null;

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const data = await file.file.arrayBuffer();
        if (cancelled) return;
        const loadingTask = pdfjs.getDocument({ data });
        task = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) return;
        const n = doc.numPages;
        setPageCount(n);
        if (n <= 1) {
          setStatus("single-page");
          return;
        }
        setThumbs(new Array(n).fill(null));
        setStatus("ready");

        // Canvas unique hors-DOM réutilisé pour toutes les pages.
        const canvas = document.createElement("canvas");
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= n; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (THUMB_WIDTH * dpr) / base.width });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.85),
          );
          page.cleanup();
          if (cancelled || !blob) continue;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setThumbs((prev) => {
            const next = [...prev];
            next[i - 1] = url;
            return next;
          });
        }
      } catch {
        if (!cancelled) {
          toast.error("Impossible de lire ce PDF (protégé ou corrompu) — découpage indisponible.");
          onCloseRef.current();
        }
      }
    })();

    return () => {
      cancelled = true;
      task?.destroy().catch(() => undefined);
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Escape = fermer (sauf pendant la génération).
  useEffect(() => {
    if (!file) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !buildingRef.current) onCloseRef.current();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [file]);

  const pageToGroup = useMemo(() => {
    const map = new Map<number, number>();
    groups.forEach((pages, gi) => pages.forEach((p) => map.set(p, gi)));
    return map;
  }, [groups]);

  const restPages = useMemo(
    () => (status === "ready" ? computeRestPages(pageCount, groups) : []),
    [status, pageCount, groups],
  );

  if (!file) return null;

  function handleTileClick(pageNo: number, shiftKey: boolean) {
    if (pageToGroup.has(pageNo)) return;
    // Capturé avant setSelected : l'updater s'exécute après la réassignation du ref.
    const anchor = lastClickRef.current;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchor !== null) {
        const [from, to] = [anchor, pageNo].sort((a, b) => a - b);
        for (let p = from; p <= to; p++) {
          if (!pageToGroup.has(p)) next.add(p);
        }
      } else if (next.has(pageNo)) {
        next.delete(pageNo);
      } else {
        next.add(pageNo);
      }
      return next;
    });
    lastClickRef.current = pageNo;
  }

  function groupSelected() {
    if (selected.size === 0) return;
    const pages = Array.from(selected).sort((a, b) => a - b);
    setGroups((prev) => [...prev, pages]);
    setSelected(new Set());
    lastClickRef.current = null;
  }

  function removePageFromGroup(pageNo: number) {
    setGroups((prev) =>
      prev
        .map((pages) => pages.filter((p) => p !== pageNo))
        .filter((pages) => pages.length > 0),
    );
  }

  function dissolveGroup(index: number) {
    setGroups((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleConfirm() {
    if (!file || groups.length === 0 || building) return;
    setBuilding(true);
    try {
      const result = await buildSplitFiles(file.file, groups, pageCount);
      const outputs = [...result.segments, ...(result.rest ? [result.rest] : [])];
      const tooBig = outputs.find((f) => f.size > maxFileSize);
      if (tooBig) {
        toast.error(
          `« ${tooBig.name} » dépasse la taille maximale autorisée (${Math.round(maxFileSize / (1024 * 1024))} Mo).`,
        );
        return;
      }
      onConfirm({ originalId: file.id, segments: result.segments, rest: result.rest });
    } catch {
      toast.error("Échec de la génération des PDF — le fichier est peut-être corrompu.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex"
      onClick={(e) => {
        if (e.target === e.currentTarget && !building) onClose();
      }}
    >
      <div className="flex w-full h-full overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {/* En-tête */}
          <div className="flex items-center gap-3 px-4 py-2 border-b bg-card shrink-0">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" title={file.file.name}>
                {file.file.name}
              </p>
              {status === "ready" && (
                <p className="text-[11px] text-muted-foreground">{pageCount} pages</p>
              )}
            </div>
            {selected.size > 0 && (
              <Button size="sm" className="gap-1.5 h-8" onClick={groupSelected}>
                <FolderPlus className="h-3.5 w-3.5" />
                Grouper en courrier ({selected.size})
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClose}
              disabled={building}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Zone centrale */}
          <div className="flex-1 overflow-y-auto p-4 bg-muted/30">
            {status === "loading" ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lecture du PDF…
              </div>
            ) : status === "single-page" ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-3">
                <FileText className="h-10 w-10 opacity-40" />
                <p className="text-sm">Ce PDF ne contient qu'une seule page — rien à découper.</p>
                <Button variant="outline" size="sm" onClick={onClose}>
                  Fermer
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {Array.from({ length: pageCount }, (_, idx) => {
                  const pageNo = idx + 1;
                  const gi = pageToGroup.get(pageNo);
                  const assigned = gi !== undefined;
                  const isSelected = selected.has(pageNo);
                  const thumb = thumbs[idx];
                  return (
                    <div
                      key={pageNo}
                      onClick={(e) => handleTileClick(pageNo, e.shiftKey)}
                      className={cn(
                        "relative rounded-lg border-2 p-1.5 transition-all select-none bg-card",
                        assigned
                          ? cn("cursor-default", GROUP_BORDER[gi % GROUP_BORDER.length])
                          : isSelected
                          ? "border-primary bg-primary/5 shadow-sm cursor-pointer"
                          : "border-border hover:border-primary/40 cursor-pointer",
                      )}
                    >
                      {assigned ? (
                        <>
                          <span
                            className={cn(
                              "absolute top-2.5 left-2.5 z-10 rounded px-1.5 py-0.5 text-[10px] font-semibold text-split-foreground pointer-events-none",
                              GROUP_BG[gi % GROUP_BG.length],
                            )}
                          >
                            Courrier {gi + 1}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removePageFromGroup(pageNo);
                            }}
                            className="absolute top-2.5 right-2.5 z-10 w-5 h-5 rounded-full bg-background/80 backdrop-blur flex items-center justify-center shadow-sm hover:bg-background hover:text-destructive transition-colors"
                            title="Retirer du courrier"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      ) : (
                        isSelected && (
                          <div className="absolute top-2.5 left-2.5 z-10 w-4 h-4 rounded-full bg-primary flex items-center justify-center pointer-events-none">
                            <Check className="h-2.5 w-2.5 text-primary-foreground" />
                          </div>
                        )
                      )}
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={`Page ${pageNo}`}
                          className="w-full h-auto rounded bg-muted/40"
                          draggable={false}
                        />
                      ) : (
                        <div className="w-full aspect-[3/4] rounded bg-muted animate-pulse" />
                      )}
                      <p className="mt-1 text-center text-[10px] text-muted-foreground font-medium">
                        Page {pageNo}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar récap */}
        <div className="w-64 shrink-0 bg-card border-l flex flex-col">
          <div className="px-3 py-3 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Courriers ({groups.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sélectionnez des pages puis cliquez sur « Grouper en courrier ».
              </p>
            ) : (
              groups.map((pages, gi) => (
                <div
                  key={gi}
                  className="flex items-center gap-2 rounded-lg border p-2 text-xs"
                >
                  <span
                    className={cn(
                      "w-2.5 h-2.5 rounded-full shrink-0",
                      GROUP_BG[gi % GROUP_BG.length],
                    )}
                  />
                  <span className="flex-1 min-w-0 truncate">
                    <span className="font-medium">Courrier {gi + 1}</span>
                    <span className="text-muted-foreground">
                      {" — "}
                      {pages.length === 1 ? "page" : "pages"} {formatPageList(pages)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => dissolveGroup(gi)}
                    className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title="Dissoudre ce courrier"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
            {status === "ready" && groups.length > 0 && (
              <p className="text-[11px] text-muted-foreground pt-2 border-t">
                {restPages.length > 0 ? (
                  <>
                    Pages non affectées ({restPages.length}) : {formatPageList(restPages)} — elles
                    resteront dans les documents non associés.
                  </>
                ) : (
                  <>Toutes les pages sont affectées.</>
                )}
              </p>
            )}
          </div>
          <div className="p-3 border-t space-y-2">
            <Button
              className="w-full gap-1.5"
              disabled={groups.length === 0 || building}
              onClick={handleConfirm}
            >
              {building && <Loader2 className="h-4 w-4 animate-spin" />}
              Créer {groups.length || ""} courrier{groups.length > 1 ? "s" : ""}
            </Button>
            <Button variant="ghost" className="w-full" onClick={onClose} disabled={building}>
              Annuler
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
