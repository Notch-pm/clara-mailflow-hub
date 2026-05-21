import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Eye, FileText, Upload, X } from "lucide-react";

interface BulkFile {
  id: string;
  file: File;
  previewUrl: string;
  groupId: number | null;
  rejected: boolean;
  rejectReason?: string;
}

interface Props {
  files: BulkFile[];
  onChange: (files: BulkFile[]) => void;
  onPreview: (fileId: string) => void;
  maxFileSize: number;
}

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
];

const ACCEPTED_EXTS = [".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif"];

function formatBytes(b: number): string {
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
}

function fileTypeBadge(file: File): string {
  if (file.type === "application/pdf") return "PDF";
  if (file.type === "image/jpeg") return "JPG";
  if (file.type === "image/png") return "PNG";
  if (file.type === "image/tiff") return "TIFF";
  const ext = file.name.split(".").pop()?.toUpperCase();
  return ext ?? "?";
}


export default function BulkStep2Upload({ files, onChange, onPreview, maxFileSize }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    (rawFiles: File[]) => {
      const newBulk: BulkFile[] = rawFiles.map((f) => {
        const isTypeOk = ACCEPTED_TYPES.includes(f.type) || ACCEPTED_EXTS.some((e) => f.name.toLowerCase().endsWith(e));
        const isSizeOk = f.size <= maxFileSize;
        const rejected = !isTypeOk || !isSizeOk;
        let rejectReason: string | undefined;
        if (!isSizeOk) rejectReason = `Taille maximale dépassée (${formatBytes(maxFileSize)})`;
        else if (!isTypeOk) rejectReason = "Format non supporté (PDF, JPG, PNG, TIFF uniquement)";
        return {
          id: crypto.randomUUID(),
          file: f,
          previewUrl: URL.createObjectURL(f),
          groupId: null,
          rejected,
          rejectReason,
        };
      });
      onChange([...files, ...newBulk]);
    },
    [files, onChange, maxFileSize]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) processFiles(Array.from(e.dataTransfer.files));
    },
    [processFiles]
  );

  function removeFile(id: string) {
    onChange(files.filter((f) => f.id !== id));
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "border-2 border-dashed rounded-xl text-center py-8 px-6 transition-colors",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        )}
      >
        <Upload className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground mb-3">
          Glissez-déposez vos fichiers ici ou
        </p>
        <Button type="button" size="sm" onClick={() => inputRef.current?.click()}>
          Parcourir les fichiers
        </Button>
        <p className="text-xs text-muted-foreground mt-2">
          PDF, JPG, PNG, TIFF — Max {formatBytes(maxFileSize)} par fichier
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) processFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {files.map((bf) => (
            <div
              key={bf.id}
              className={cn(
                "relative rounded-lg border p-2 flex flex-col gap-1.5",
                bf.rejected ? "border-destructive bg-destructive/5" : "border-border bg-card"
              )}
            >
              <button
                type="button"
                onClick={() => !bf.rejected && onPreview(bf.id)}
                className={cn(
                  "h-20 rounded overflow-hidden flex items-center justify-center bg-muted/40",
                  !bf.rejected && "cursor-pointer hover:bg-muted/60 transition-colors"
                )}
              >
                {bf.file.type.startsWith("image/") ? (
                  <img src={bf.previewUrl} alt={bf.file.name} className="h-full w-full object-cover" />
                ) : (
                  <FileText className={cn("h-8 w-8", bf.rejected ? "text-destructive/50" : "text-muted-foreground/50")} />
                )}
              </button>

              <div className="flex items-start justify-between gap-1 mt-0.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 mb-0.5">
                    <Badge
                      variant="secondary"
                      className={cn("text-[9px] px-1 py-0 h-4", bf.rejected && "bg-destructive/20 text-destructive")}
                    >
                      {fileTypeBadge(bf.file)}
                    </Badge>
                  </div>
                  <p className="text-xs truncate font-medium" title={bf.file.name}>{bf.file.name}</p>
                  <p className="text-[10px] text-muted-foreground">{formatBytes(bf.file.size)}</p>
                  {bf.rejected && bf.rejectReason && (
                    <p className="text-[10px] text-destructive mt-0.5">{bf.rejectReason}</p>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 shrink-0">
                  {!bf.rejected && (
                    <button
                      type="button"
                      onClick={() => onPreview(bf.id)}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      aria-label="Aperçu"
                    >
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(bf.id)}
                    className="p-1 rounded hover:bg-muted transition-colors"
                    aria-label="Retirer"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
