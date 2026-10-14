import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

function formatBytes(b: number): string {
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
}

interface Props {
  files: File[];
  index: number;
  onIndexChange: (index: number) => void;
  onRemove: (index: number) => void;
  /** Version réduite de l'étape de relecture : aperçu plus bas, sans tailles. */
  compact?: boolean;
}

/** Aperçu des pièces choisies avant création : visionneuse et liste. */
export function PendingFilesPreview({ files, index, onIndexChange, onRemove, compact = false }: Props) {
  // URL locales des pièces, libérées dès que la liste change ou que l'aperçu disparaît.
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const created = files.map((f) => URL.createObjectURL(f));
    setUrls(created);
    return () => created.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  if (files.length === 0) return null;

  const file = files[index];
  const url = urls[index];
  const arrow = cn(
    "absolute top-1/2 -translate-y-1/2 rounded-full bg-background/90 shadow hover:bg-background disabled:opacity-30 transition-opacity",
    compact ? "p-1" : "p-1.5",
  );
  const arrowIcon = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className={cn("relative bg-muted/30 flex items-center justify-center", compact ? "h-[160px]" : "h-[260px]")}>
        {file && url && (
          file.type.startsWith("image/") ? (
            <img src={url} alt={file.name} className="max-h-full max-w-full object-contain p-2" />
          ) : file.type === "application/pdf" ? (
            <iframe src={url} className="w-full h-full border-0" title={file.name} />
          ) : (
            <div className="text-center text-muted-foreground px-4">
              <FileText className={cn("mx-auto opacity-40", compact ? "h-8 w-8 mb-1" : "h-10 w-10 mb-2")} />
              <p className={cn("font-medium truncate", compact ? "text-xs" : "text-sm")}>{file.name}</p>
              {!compact && <p className="text-xs mt-1">Aperçu non disponible</p>}
            </div>
          )
        )}

        {files.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => onIndexChange(Math.max(0, index - 1))}
              disabled={index === 0}
              className={cn(arrow, "left-2")}
              aria-label="Pièce précédente"
            >
              <ChevronLeft className={arrowIcon} />
            </button>
            <button
              type="button"
              onClick={() => onIndexChange(Math.min(files.length - 1, index + 1))}
              disabled={index === files.length - 1}
              className={cn(arrow, "right-2")}
              aria-label="Pièce suivante"
            >
              <ChevronRight className={arrowIcon} />
            </button>
            <span
              className={cn(
                "absolute text-[10px] text-muted-foreground bg-background/80 rounded px-1.5 py-0.5",
                compact ? "bottom-1.5 right-2" : "bottom-2 right-3",
              )}
            >
              {index + 1} / {files.length}
            </span>
          </>
        )}
      </div>

      <div className={cn("border-t divide-y overflow-y-auto", compact ? "max-h-[90px]" : "max-h-[160px]")}>
        {files.map((f, i) => (
          <div
            key={`${f.name}-${i}`}
            onClick={() => onIndexChange(i)}
            className={cn(
              "flex items-center gap-2 px-3 cursor-pointer transition-colors",
              compact ? "py-1 text-xs" : "py-1.5 text-sm",
              i === index ? "bg-muted font-medium" : "hover:bg-muted/50",
            )}
          >
            <span className="flex-1 truncate" title={f.name}>{f.name}</span>
            {!compact && <span className="text-xs text-muted-foreground shrink-0">{formatBytes(f.size)}</span>}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(i); }}
              className="p-0.5 rounded hover:text-destructive transition-colors ml-1"
              aria-label={`Retirer ${f.name}`}
            >
              <X className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
