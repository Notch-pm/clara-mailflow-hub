import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Minus,
  Plus,
  RotateCw,
  X,
} from "lucide-react";

interface BulkFile {
  id: string;
  file: File;
  previewUrl: string;
  groupId: number | null;
  rejected: boolean;
}

interface Props {
  fileId: string | null;
  files: BulkFile[];
  onClose: () => void;
}

export default function BulkFilePreview({ fileId, files, onClose }: Props) {
  const viewableFiles = files.filter((f) => !f.rejected);
  const currentIdx = viewableFiles.findIndex((f) => f.id === fileId);
  const [activeId, setActiveId] = useState<string | null>(fileId);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    setActiveId(fileId);
    setZoom(1);
    setRotation(0);
  }, [fileId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") {
        const idx = viewableFiles.findIndex((f) => f.id === activeId);
        if (idx < viewableFiles.length - 1) {
          setActiveId(viewableFiles[idx + 1].id);
          setZoom(1);
          setRotation(0);
        }
      }
      if (e.key === "ArrowLeft") {
        const idx = viewableFiles.findIndex((f) => f.id === activeId);
        if (idx > 0) {
          setActiveId(viewableFiles[idx - 1].id);
          setZoom(1);
          setRotation(0);
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeId, viewableFiles, onClose]);

  if (!fileId) return null;

  const activeFile = viewableFiles.find((f) => f.id === activeId);
  const activeIdx = viewableFiles.findIndex((f) => f.id === activeId);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full h-full overflow-hidden">
        <div className="w-56 shrink-0 bg-card border-r overflow-y-auto flex flex-col">
          <div className="px-3 py-3 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Fichiers ({viewableFiles.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y">
            {viewableFiles.map((f, i) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setActiveId(f.id);
                  setZoom(1);
                  setRotation(0);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                  f.id === activeId
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted"
                )}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{f.file.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {i + 1} / {viewableFiles.length}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-background">
          <div className="flex items-center gap-2 px-4 py-2 border-b bg-card shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={activeIdx <= 0}
              onClick={() => {
                if (activeIdx > 0) {
                  setActiveId(viewableFiles[activeIdx - 1].id);
                  setZoom(1);
                  setRotation(0);
                }
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={activeIdx >= viewableFiles.length - 1}
              onClick={() => {
                if (activeIdx < viewableFiles.length - 1) {
                  setActiveId(viewableFiles[activeIdx + 1].id);
                  setZoom(1);
                  setRotation(0);
                }
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            <span className="text-xs text-muted-foreground flex-1 truncate">
              {activeFile?.file.name ?? ""}
            </span>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                title="Zoom arrière"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="text-xs font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                title="Zoom avant"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                title="Rotation"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-muted/30">
            {!activeFile ? (
              <div className="text-muted-foreground text-sm">Aucun fichier sélectionné</div>
            ) : activeFile.file.type.startsWith("image/") ? (
              <img
                src={activeFile.previewUrl}
                alt={activeFile.file.name}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transformOrigin: "center center",
                  transition: "transform 0.2s ease",
                  maxWidth: "none",
                }}
                className="block"
              />
            ) : activeFile.file.type === "application/pdf" ? (
              <iframe
                src={activeFile.previewUrl}
                title={activeFile.file.name}
                className="w-full h-full border-0 rounded"
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transformOrigin: "top center",
                }}
              />
            ) : (
              <div className="text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">{activeFile.file.name}</p>
                <p className="text-xs mt-1">Aperçu non disponible</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
