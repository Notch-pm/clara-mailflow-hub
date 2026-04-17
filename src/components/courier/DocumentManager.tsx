import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, FileText, Trash2, Paperclip, FileOutput, Download, Upload, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { getDocuments } from "@/services/courierDocumentService";
import { storage } from "@/services/storageService";
import { logEvent } from "@/services/courierEventService";
import type { CourierDocument } from "@/types/courier";

// ── Constants ───────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: "original", label: "Original" },
  { value: "response", label: "Réponse" },
  { value: "attachment", label: "Pièce jointe" },
] as const;

const docTypeIcon: Record<string, React.ReactNode> = {
  original: <FileText className="h-4 w-4" />,
  response: <FileOutput className="h-4 w-4" />,
  attachment: <Paperclip className="h-4 w-4" />,
};

const docTypeBadge: Record<string, "default" | "secondary" | "outline"> = {
  original: "default",
  response: "secondary",
  attachment: "outline",
};

const docTypeLabel: Record<string, string> = {
  original: "Original",
  response: "Réponse",
  attachment: "Pièce jointe",
};

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// ── Component ───────────────────────────────────────────────────────────

interface DocumentManagerProps {
  courierId: string;
  organizationId: string;
  selectedDocId?: string | null;
  onSelectDoc?: (id: string) => void;
}

export default function DocumentManager({
  courierId,
  organizationId,
  selectedDocId,
  onSelectDoc,
}: DocumentManagerProps) {
  const queryClient = useQueryClient();
  const queryKey = ["courier-documents", courierId];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedType, setSelectedType] = useState<string>("attachment");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  // Fetch max file size
  const { data: maxFileSize = 10 * 1024 * 1024 } = useQuery({
    queryKey: ["max-file-size", organizationId],
    queryFn: () => storage.getMaxFileSize(organizationId),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: documents = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getDocuments(courierId),
    enabled: !!courierId,
  });

  // ── Upload ──────────────────────────────────────────────────────────

  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (!fileArray.length) return;

      // Client-side size check
      const oversized = fileArray.filter((f) => f.size > maxFileSize);
      if (oversized.length) {
        const maxMB = (maxFileSize / (1024 * 1024)).toFixed(1);
        toast.error(
          `${oversized.length} fichier(s) dépasse(nt) la limite de ${maxMB} Mo : ${oversized.map((f) => f.name).join(", ")}`
        );
        return;
      }

      setUploading(true);
      setUploadProgress(0);
      let uploaded = 0;

      for (const file of fileArray) {
        try {
          await storage.upload(organizationId, courierId, file, selectedType);
          uploaded++;
          setUploadProgress(Math.round((uploaded / fileArray.length) * 100));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Erreur upload";
          toast.error(`${file.name} : ${msg}`);
        }
      }

      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      if (uploaded > 0) {
        toast.success(`${uploaded} document${uploaded > 1 ? "s" : ""} ajouté${uploaded > 1 ? "s" : ""}`);
      }
      setUploading(false);
      setUploadProgress(0);
    },
    [organizationId, courierId, selectedType, maxFileSize, queryClient]
  );

  // Drag & drop handlers
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback(() => setDragOver(false), []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
    },
    [handleUpload]
  );

  // ── Delete ──────────────────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => storage.delete(organizationId, docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      toast.success("Document supprimé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Download ────────────────────────────────────────────────────────

  const handleDownload = useCallback(
    async (doc: CourierDocument) => {
      try {
        const url = await storage.getSignedUrl(organizationId, doc.storage_key);
        window.open(url, "_blank");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erreur téléchargement");
      }
    },
    [organizationId]
  );

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        }`}
      >
        {uploading ? (
          <div className="space-y-2">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">Upload en cours…</p>
            <Progress value={uploadProgress} className="max-w-xs mx-auto" />
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              Glissez-déposez vos fichiers ici ou
            </p>
            <div className="flex items-center justify-center gap-3">
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="h-4 w-4" /> Parcourir
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Max {(maxFileSize / (1024 * 1024)).toFixed(0)} Mo par fichier
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Document list */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {documents.length} document{documents.length !== 1 ? "s" : ""}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Chargement…</p>
      ) : !documents.length ? (
        <p className="text-sm text-muted-foreground text-center py-4">Aucun document.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Taille</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((d) => (
              <TableRow
                key={d.id}
                onClick={() => onSelectDoc?.(d.id)}
                className={
                  onSelectDoc
                    ? `cursor-pointer ${selectedDocId === d.id ? "bg-muted/60" : "hover:bg-muted/30"}`
                    : undefined
                }
              >
                <TableCell>
                  <Badge variant={docTypeBadge[d.document_type] ?? "outline"} className="gap-1">
                    {docTypeIcon[d.document_type]}
                    {docTypeLabel[d.document_type] ?? d.document_type}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{d.file_name ?? "—"}</TableCell>
                <TableCell className="text-sm">{formatFileSize(d.file_size)}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Télécharger"
                      onClick={() => handleDownload(d)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Le fichier « {d.file_name ?? d.storage_key} » sera supprimé du stockage
                            et de la base de données. Cette action est irréversible.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(d.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Supprimer
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
