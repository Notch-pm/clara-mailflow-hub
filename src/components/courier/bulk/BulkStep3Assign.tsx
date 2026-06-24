import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check, Eye, FileText, FolderPlus, GripVertical, Trash2, X } from "lucide-react";

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
}

function fileTypeBadge(file: File): string {
  if (file.type === "application/pdf") return "PDF";
  if (file.type === "image/jpeg") return "JPG";
  if (file.type === "image/png") return "PNG";
  if (file.type === "image/tiff") return "TIFF";
  return file.name.split(".").pop()?.toUpperCase() ?? "?";
}

function getGroupIds(files: BulkFile[]): number[] {
  const ids = new Set<number>();
  files.forEach((f) => { if (f.groupId !== null && !f.rejected) ids.add(f.groupId); });
  return Array.from(ids).sort((a, b) => a - b);
}

function nextGroupId(files: BulkFile[]): number {
  const ids = getGroupIds(files);
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

function FileThumbnail({ bf, size = "sm" }: { bf: BulkFile; size?: "sm" | "md" }) {
  const h = size === "md" ? "h-24" : "h-16";
  return (
    <div className={cn("rounded overflow-hidden flex items-center justify-center bg-muted/40 w-full", h)}>
      {bf.file.type.startsWith("image/") ? (
        <img src={bf.previewUrl} alt={bf.file.name} className="h-full w-full object-cover" />
      ) : (
        <FileText className="h-6 w-6 text-muted-foreground/50" />
      )}
    </div>
  );
}

export default function BulkStep3Assign({ files, onChange, onPreview }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragFileId, setDragFileId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<number | "unassigned" | null>(null);

  const unassigned = files.filter((f) => !f.rejected && f.groupId === null);
  const groupIds = getGroupIds(files);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function groupSelected() {
    if (selectedIds.size === 0) return;
    const gid = nextGroupId(files);
    onChange(files.map((f) => (selectedIds.has(f.id) ? { ...f, groupId: gid } : f)));
    setSelectedIds(new Set());
  }

  function oneFilePerCourier() {
    let nextId = nextGroupId(files);
    const updated = files.map((f) => {
      if (f.rejected || f.groupId !== null) return f;
      const gid = nextId++;
      return { ...f, groupId: gid };
    });
    onChange(updated);
    setSelectedIds(new Set());
  }

  function moveToGroup(fileId: string, targetGroupId: number | null) {
    onChange(files.map((f) => (f.id === fileId ? { ...f, groupId: targetGroupId } : f)));
  }

  function deleteGroup(groupId: number) {
    onChange(files.map((f) => (f.groupId === groupId ? { ...f, groupId: null } : f)));
  }

  function handleDragStart(e: React.DragEvent, fileId: string) {
    setDragFileId(fileId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(e: React.DragEvent, targetGroupId: number | null) {
    e.preventDefault();
    if (dragFileId) moveToGroup(dragFileId, targetGroupId);
    setDragFileId(null);
    setDragOver(null);
  }

  function handleDragOver(e: React.DragEvent, zone: number | "unassigned") {
    e.preventDefault();
    setDragOver(zone);
  }

  function handleDragEnd() {
    setDragFileId(null);
    setDragOver(null);
  }

  const hasSelection = selectedIds.size > 0;

  return (
    <div className="space-y-6">
      {/* Unassigned documents */}
      <div
        onDragOver={(e) => handleDragOver(e, "unassigned")}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => handleDrop(e, null)}
        className={cn(
          "rounded-xl border-2 border-dashed p-4 transition-colors",
          dragOver === "unassigned"
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/20"
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Documents non associés
            {unassigned.length > 0 && (
              <span className="ml-2 text-xs font-normal">({unassigned.length})</span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {unassigned.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 h-7"
                onClick={oneFilePerCourier}
              >
                <FileText className="h-3.5 w-3.5" />
                1 fichier = 1 courrier
              </Button>
            )}
            {hasSelection && (
              <Button size="sm" className="gap-1.5 h-7" onClick={groupSelected}>
                <FolderPlus className="h-3.5 w-3.5" />
                Rassembler en courrier ({selectedIds.size})
              </Button>
            )}
          </div>
        </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {unassigned.map((bf) => {
              const selected = selectedIds.has(bf.id);
              return (
                <div
                  key={bf.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, bf.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => toggleSelect(bf.id)}
                  className={cn(
                    "relative rounded-lg border-2 p-1.5 cursor-pointer transition-all select-none",
                    selected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card hover:border-primary/40"
                  )}
                >
                  {selected && (
                    <div className="absolute top-1 left-1 z-10 w-4 h-4 rounded-full bg-primary flex items-center justify-center pointer-events-none">
                      <Check className="h-2.5 w-2.5 text-primary-foreground" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onPreview(bf.id); }}
                    className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-background/80 backdrop-blur flex items-center justify-center shadow-sm hover:bg-background transition-colors"
                    title="Aperçu"
                  >
                    <Eye className="h-3 w-3 text-muted-foreground" />
                  </button>
                  <FileThumbnail bf={bf} size="md" />
                  <div className="mt-1 px-0.5">
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 mb-0.5">
                      {fileTypeBadge(bf.file)}
                    </Badge>
                    <p className="text-[10px] truncate font-medium leading-tight" title={bf.file.name}>
                      {bf.file.name}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Courier groups */}
      {groupIds.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Courriers ({groupIds.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groupIds.map((gid) => {
              const groupFiles = files.filter((f) => f.groupId === gid);
              const isOver = dragOver === gid;
              return (
                <div
                  key={gid}
                  onDragOver={(e) => handleDragOver(e, gid)}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => handleDrop(e, gid)}
                  className={cn(
                    "rounded-lg border p-3 space-y-2 transition-colors",
                    isOver ? "border-primary bg-primary/5" : "border-border bg-card"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Courrier {gid}
                      <span className="ml-1.5 font-normal normal-case">
                        · {groupFiles.length} fichier{groupFiles.length > 1 ? "s" : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteGroup(gid)}
                      className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Supprimer ce courrier"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                    {groupFiles.map((bf) => (
                      <div
                        key={bf.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, bf.id)}
                        onDragEnd={handleDragEnd}
                        className="flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-[10px] cursor-grab active:cursor-grabbing group"
                      >
                        <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                        <button
                          type="button"
                          onClick={() => onPreview(bf.id)}
                          className="flex items-center gap-1 hover:text-primary transition-colors max-w-[90px]"
                        >
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate" title={bf.file.name}>{bf.file.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveToGroup(bf.id, null)}
                          className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
                          title="Retirer du courrier"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                    {isOver && dragFileId && (
                      <div className="flex items-center gap-1 bg-primary/10 border border-primary/30 border-dashed rounded px-1.5 py-0.5 text-[10px] text-primary">
                        Déposer ici
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
