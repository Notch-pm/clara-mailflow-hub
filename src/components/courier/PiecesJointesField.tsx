import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, File as FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { storage } from "@/services/storageService";
import type { CourierDocument } from "@/types/courier";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Sélection de pièces jointes pour une demande : documents du courrier
 * (cochables) + upload de nouveaux fichiers. Utilisé par les formulaires
 * Arpège et Socle du CreateTicketDialog.
 */
export default function PiecesJointesField({
  label,
  required,
  helpText,
  courierDocs,
  selectedIds,
  onToggle,
  orgId,
  courierId,
  onNewDoc,
  maxFiles,
}: {
  label: string;
  required: boolean;
  helpText?: string;
  courierDocs: CourierDocument[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  orgId: string;
  courierId: string;
  onNewDoc: (doc: CourierDocument) => void;
  /** Nombre maximum de documents sélectionnables (illimité si absent). */
  maxFiles?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const atLimit = maxFiles !== undefined && selectedIds.length >= maxFiles;

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const doc = await storage.upload(orgId, courierId, file, "attachment");
        onNewDoc(doc);
      }
    } catch {
      toast.error("Erreur lors de l'upload du fichier");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <Label className="text-xs text-muted-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        {helpText && <p className="text-[10px] text-muted-foreground/70">{helpText}</p>}
      </div>

      <div className={cn(
        "rounded-md border",
        courierDocs.length === 0 && "border-dashed",
      )}>
        {courierDocs.length === 0 ? (
          <div className="p-3 text-center text-xs text-muted-foreground">
            Aucun document disponible — utilisez le bouton ci-dessous pour en ajouter.
          </div>
        ) : (
          <div className="divide-y max-h-44 overflow-y-auto">
            {courierDocs.map((doc) => {
              const checked = selectedIds.includes(doc.id);
              const disabled = !checked && atLimit;
              const name = doc.file_name ?? doc.storage_key.split("/").pop() ?? "fichier";
              return (
                <label
                  key={doc.id}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 transition-colors text-sm",
                    checked ? "bg-primary/5" : "hover:bg-muted/40",
                    disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-primary"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(doc.id)}
                  />
                  <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{name}</span>
                  {doc.file_size && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatSize(doc.file_size)}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading
          ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Upload en cours…</>
          : <><Upload className="h-3.5 w-3.5 mr-1.5" />Ajouter un fichier depuis l'ordinateur</>
        }
      </Button>
    </div>
  );
}
