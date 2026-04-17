import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, FileQuestion, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { storage } from "@/services/storageService";
import type { CourierDocument } from "@/types/courier";

interface Props {
  documents: CourierDocument[];
  currentId: string | null;
  onChange: (id: string) => void;
  organizationId: string;
}

export default function DocumentViewer({ documents, currentId, onChange, organizationId }: Props) {
  // Auto-select first document when none is selected
  useEffect(() => {
    if (!currentId && documents.length > 0) {
      onChange(documents[0].id);
    }
  }, [currentId, documents, onChange]);

  const currentIndex = documents.findIndex((d) => d.id === currentId);
  const current = currentIndex >= 0 ? documents[currentIndex] : null;

  const { data: signedUrl, isLoading } = useQuery({
    queryKey: ["doc-signed-url", current?.id],
    queryFn: () => storage.getSignedUrl(organizationId, current!.storage_key),
    enabled: !!current,
    staleTime: 4 * 60 * 1000, // 4 min — URL TTL is usually 5 min
  });

  function goPrev() {
    if (currentIndex > 0) onChange(documents[currentIndex - 1].id);
  }
  function goNext() {
    if (currentIndex >= 0 && currentIndex < documents.length - 1) {
      onChange(documents[currentIndex + 1].id);
    }
  }

  if (!documents.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] border rounded-lg bg-muted/30 text-muted-foreground">
        <FileQuestion className="h-10 w-10 mb-2 opacity-50" />
        <p className="text-sm">Aucun document à prévisualiser</p>
      </div>
    );
  }

  const mime = current?.mime_type ?? "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";

  return (
    <div className="flex flex-col h-full min-h-[300px]">
      {/* Viewer body */}
      <div className="flex-1 border rounded-lg bg-muted/20 overflow-hidden flex items-center justify-center min-h-[300px]">
        {isLoading || !signedUrl ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : isImage ? (
          <img
            src={signedUrl}
            alt={current?.file_name ?? "Document"}
            className="max-w-full max-h-full object-contain"
          />
        ) : isPdf ? (
          <iframe
            src={signedUrl}
            title={current?.file_name ?? "Document"}
            className="w-full h-full min-h-[400px] border-0"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <FileQuestion className="h-10 w-10 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              Aperçu non disponible pour ce type de fichier.
            </p>
            <Button asChild size="sm" variant="outline">
              <a href={signedUrl} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-1.5" />
                Télécharger
              </a>
            </Button>
          </div>
        )}
      </div>

      {/* Navigation bar */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <Button
          size="sm"
          variant="outline"
          onClick={goPrev}
          disabled={currentIndex <= 0}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Préc.
        </Button>
        <div className="flex-1 text-center text-xs text-muted-foreground truncate px-2">
          {current?.file_name ?? "—"}{" "}
          <span className="ml-2">
            {currentIndex + 1} / {documents.length}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={goNext}
          disabled={currentIndex < 0 || currentIndex >= documents.length - 1}
          className="gap-1"
        >
          Suiv.
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
