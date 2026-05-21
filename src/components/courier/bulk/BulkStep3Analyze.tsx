import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import { FileText, Plus, X } from "lucide-react";
import type { CourierTag } from "@/services/courierTagService";

interface BulkFile {
  id: string;
  file: File;
  previewUrl: string;
  groupId: number | null;
  rejected: boolean;
}

interface DraftCourier {
  id: string;
  title: string;
  senderName: string;
  senderEmail: string;
  recipientName: string;
  serviceId: string;
  serviceName: string;
  tags: string[];
  bodyText: string;
  fileIds: string[];
  confidence: number;
  flags: Array<"missing-service" | "duplicate">;
}

interface Props {
  files: BulkFile[];
  drafts: DraftCourier[];
  analyzing: boolean;
  totalGroups: number;
  orgTags: CourierTag[];
  onChange: (drafts: DraftCourier[]) => void;
  onPreview: (fileId: string) => void;
  onFileReject: (fileId: string) => void;
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 animate-pulse">
      <div className="h-4 bg-muted rounded w-3/4" />
      <div className="h-3 bg-muted rounded w-1/2" />
      <div className="flex gap-1.5">
        <div className="h-5 bg-muted rounded w-14" />
        <div className="h-5 bg-muted rounded w-20" />
      </div>
      <div className="h-3 bg-muted rounded w-2/3" />
    </div>
  );
}

function DraftCard({
  draft,
  files,
  allDrafts,
  orgTags,
  onChange,
  onPreview,
}: {
  draft: DraftCourier;
  files: BulkFile[];
  allDrafts: DraftCourier[];
  orgTags: CourierTag[];
  onChange: (drafts: DraftCourier[]) => void;
  onPreview: (fileId: string) => void;
}) {
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const draftFiles = files.filter((f) => draft.fileIds.includes(f.id));
  const confidencePct = Math.round(draft.confidence * 100);
  const isManual = draft.confidence === 0;

  const assignedFileIds = new Set(allDrafts.flatMap((d) => d.fileIds));
  const availableFiles = files.filter(
    (f) => !f.rejected && !draft.fileIds.includes(f.id)
  );
  const unassignedFiles = availableFiles.filter((f) => !assignedFileIds.has(f.id));
  const assignedElsewhereFiles = availableFiles.filter((f) => assignedFileIds.has(f.id));

  function removeFile(fileId: string) {
    onChange(
      allDrafts.map((d) =>
        d.id === draft.id ? { ...d, fileIds: d.fileIds.filter((id) => id !== fileId) } : d
      )
    );
  }

  function addFile(fileId: string) {
    onChange(
      allDrafts.map((d) => {
        if (d.id === draft.id) return { ...d, fileIds: [...d.fileIds, fileId] };
        if (d.fileIds.includes(fileId)) return { ...d, fileIds: d.fileIds.filter((id) => id !== fileId) };
        return d;
      })
    );
    setFilePickerOpen(false);
  }

  function removeDraft() {
    onChange(allDrafts.filter((d) => d.id !== draft.id));
  }

  return (
    <div className={cn("rounded-lg border bg-card p-4 space-y-2.5 relative", isManual && "border-dashed")}>
      <button
        type="button"
        onClick={removeDraft}
        className="absolute top-2 right-2 p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
        title="Supprimer ce courrier"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="font-medium text-sm leading-tight pr-5">
        {draft.title || <span className="text-muted-foreground italic">Nouveau courrier</span>}
      </div>

      {(draft.senderName || draft.senderEmail) && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">De : </span>
          {[draft.senderName, draft.senderEmail].filter(Boolean).join(" — ")}
        </div>
      )}

      {draft.serviceName && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Service : </span>
          {draft.serviceName}
        </div>
      )}

      {draft.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {draft.tags.map((tag) => {
            const tagDef = orgTags.find((o) => o.name.toLowerCase() === tag.toLowerCase());
            const bg = tagDef?.color ?? undefined;
            const fg = bg ? readableTextColor(bg) : undefined;
            return (
              <Badge
                key={tag}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-4"
                style={bg ? { backgroundColor: bg, color: fg, borderColor: bg } : undefined}
              >
                {tag}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Documents */}
      <div className="space-y-1">
        <div className="flex flex-wrap gap-1">
          {draftFiles.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-1 text-[10px] bg-muted rounded px-1.5 py-0.5 group"
            >
              <button
                type="button"
                onClick={() => onPreview(f.id)}
                className="flex items-center gap-1 hover:text-primary transition-colors"
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[90px]" title={f.file.name}>
                  {f.file.name}
                </span>
              </button>
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
                title="Retirer ce fichier"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}

          {availableFiles.length > 0 && (
            <Popover open={filePickerOpen} onOpenChange={setFilePickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground border border-dashed rounded px-1.5 py-0.5 hover:border-primary hover:text-primary transition-colors"
                >
                  <Plus className="h-3 w-3" /> Fichier
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                {unassignedFiles.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground font-medium px-1 mb-1">Non assignés</p>
                    {unassignedFiles.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => addFile(f.id)}
                        className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors text-left"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{f.file.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {assignedElsewhereFiles.length > 0 && (
                  <div className="space-y-0.5 mt-2">
                    <p className="text-[10px] text-muted-foreground font-medium px-1 mb-1">Assignés ailleurs (déplacer)</p>
                    {assignedElsewhereFiles.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => addFile(f.id)}
                        className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors text-left text-muted-foreground"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{f.file.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {!isManual && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] text-muted-foreground">Confiance IA :</span>
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                confidencePct >= 80 ? "bg-green-500" : confidencePct >= 50 ? "bg-yellow-500" : "bg-orange-500"
              )}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <span className="text-[10px] font-medium">{confidencePct}%</span>
        </div>
      )}

      {isManual && (
        <div className="text-[10px] text-muted-foreground italic">Ajouté manuellement</div>
      )}
    </div>
  );
}

export default function BulkStep3Analyze({
  files,
  drafts,
  analyzing,
  totalGroups,
  orgTags,
  onChange,
  onPreview,
  onFileReject,
}: Props) {
  const assignedFileIds = new Set(drafts.flatMap((d) => d.fileIds));
  const orphanedFiles = files.filter((f) => !f.rejected && !assignedFileIds.has(f.id));
  const progress = totalGroups > 0 ? Math.round((drafts.length / totalGroups) * 100) : 0;

  function addDraft() {
    const newDraft: DraftCourier = {
      id: crypto.randomUUID(),
      title: "",
      senderName: "",
      senderEmail: "",
      recipientName: "",
      serviceId: "",
      serviceName: "",
      tags: [],
      bodyText: "",
      fileIds: [],
      confidence: 0,
      flags: ["missing-service"],
    };
    onChange([...drafts, newDraft]);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className={cn("font-medium", analyzing ? "text-muted-foreground" : "text-foreground")}>
            {analyzing
              ? `Analyse en cours… ${drafts.length}/${totalGroups} courrier${totalGroups > 1 ? "s" : ""}`
              : `${drafts.length} courrier${drafts.length > 1 ? "s" : ""} détecté${drafts.length > 1 ? "s" : ""}`}
          </span>
          {!analyzing && drafts.length > 0 && (
            <span className="text-xs text-primary font-medium">Analyse terminée ✓</span>
          )}
        </div>
        <div className="h-2.5 rounded-full overflow-hidden bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              analyzing ? "bg-primary/70" : "bg-primary"
            )}
            style={{ width: `${Math.max(progress, analyzing ? 15 : 0)}%` }}
          />
        </div>
      </div>

      {orphanedFiles.length > 0 && (
        <div className="rounded-lg border border-yellow-400/50 bg-yellow-50 dark:bg-yellow-900/10 px-4 py-3 space-y-2">
          <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
            {orphanedFiles.length} fichier{orphanedFiles.length > 1 ? "s" : ""} sans courrier — assignez-les ou supprimez-les
          </p>
          <div className="flex flex-wrap gap-1.5">
            {orphanedFiles.map((f) => (
              <div key={f.id} className="flex items-center gap-1 bg-white dark:bg-muted rounded border px-2 py-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => onPreview(f.id)}
                  className="flex items-center gap-1 hover:text-primary transition-colors"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="max-w-[100px] truncate" title={f.file.name}>{f.file.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onFileReject(f.id)}
                  className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                  title="Supprimer ce fichier"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            files={files}
            allDrafts={drafts}
            orgTags={orgTags}
            onChange={onChange}
            onPreview={onPreview}
          />
        ))}
        {analyzing &&
          Array.from({ length: Math.max(0, totalGroups - drafts.length) }).map((_, i) => (
            <SkeletonCard key={`sk-${i}`} />
          ))}

        <button
          type="button"
          onClick={addDraft}
          className="rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30 transition-colors min-h-[100px] flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:text-primary"
        >
          <Plus className="h-5 w-5" />
          <span className="text-xs font-medium">Ajouter un courrier</span>
        </button>
      </div>
    </div>
  );
}
