import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import { Check, FileText, MoveRight, Plus, Trash2, X } from "lucide-react";
import type { OrgService } from "@/services/orgServiceService";
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
  drafts: DraftCourier[];
  files: BulkFile[];
  services: OrgService[];
  orgTags: CourierTag[];
  onChange: (drafts: DraftCourier[]) => void;
  onPreview: (fileId: string) => void;
  onFileReject: (fileId: string) => void;
}

function TagCombobox({
  selected,
  orgTags,
  onChange,
}: {
  selected: string[];
  orgTags: CourierTag[];
  onChange: (tags: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle(name: string) {
    if (selected.some((t) => t.toLowerCase() === name.toLowerCase())) {
      onChange(selected.filter((t) => t.toLowerCase() !== name.toLowerCase()));
    } else {
      onChange([...selected, name]);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex flex-wrap gap-1 min-w-[120px] min-h-[28px] rounded border border-input px-2 py-1 text-xs hover:bg-muted/50 transition-colors text-left"
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">Aucun tag</span>
          ) : (
            selected.map((t) => {
              const tagDef = orgTags.find((o) => o.name.toLowerCase() === t.toLowerCase());
              const bg = tagDef?.color ?? undefined;
              const fg = bg ? readableTextColor(bg) : undefined;
              return (
                <Badge
                  key={t}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-4"
                  style={bg ? { backgroundColor: bg, color: fg, borderColor: bg } : undefined}
                >
                  {t}
                </Badge>
              );
            })
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandInput placeholder="Rechercher…" />
          <CommandList>
            <CommandEmpty>Aucun tag</CommandEmpty>
            <CommandGroup>
              {orgTags.map((tag) => {
                const checked = selected.some(
                  (t) => t.toLowerCase() === tag.name.toLowerCase()
                );
                return (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => toggle(tag.name)}
                    className="gap-2 text-xs"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color ?? "hsl(var(--muted-foreground))" }}
                    />
                    <span className="flex-1">{tag.name}</span>
                    <Check className={cn("h-3.5 w-3.5", checked ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FileChip({
  fileId,
  files,
  drafts,
  draftId,
  onMove,
  onPreview,
}: {
  fileId: string;
  files: BulkFile[];
  drafts: DraftCourier[];
  draftId: string;
  onMove: (fileId: string, targetDraftId: string) => void;
  onPreview: (fileId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const bf = files.find((f) => f.id === fileId);
  if (!bf) return null;
  const otherDrafts = drafts.filter((d) => d.id !== draftId);

  return (
    <div className="flex items-center gap-0.5 bg-muted rounded px-1.5 py-0.5 text-[10px]">
      <button
        type="button"
        onClick={() => onPreview(fileId)}
        className="flex items-center gap-1 hover:text-primary transition-colors"
      >
        <FileText className="h-3 w-3 shrink-0" />
        <span className="max-w-[80px] truncate" title={bf.file.name}>
          {bf.file.name}
        </span>
      </button>
      {otherDrafts.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ml-0.5 p-0.5 rounded hover:bg-muted-foreground/20 transition-colors"
              title="Déplacer vers un autre courrier"
            >
              <MoveRight className="h-3 w-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            <p className="text-[10px] text-muted-foreground px-2 py-1 font-medium">Déplacer vers :</p>
            {otherDrafts.map((d, idx) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onMove(fileId, d.id);
                  setOpen(false);
                }}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors truncate"
              >
                Courrier {idx + 1} — {d.title || "Sans titre"}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function OrphanFileChip({
  file,
  drafts,
  onAssign,
  onReject,
  onPreview,
}: {
  file: BulkFile;
  drafts: DraftCourier[];
  onAssign: (fileId: string, draftId: string) => void;
  onReject: (fileId: string) => void;
  onPreview: (fileId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1 bg-white dark:bg-muted rounded border px-2 py-0.5 text-[10px]">
      <button
        type="button"
        onClick={() => onPreview(file.id)}
        className="flex items-center gap-1 hover:text-primary transition-colors"
      >
        <FileText className="h-3 w-3 shrink-0" />
        <span className="max-w-[100px] truncate" title={file.file.name}>{file.file.name}</span>
      </button>
      {drafts.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ml-0.5 p-0.5 rounded hover:bg-muted-foreground/20 transition-colors"
              title="Assigner à un courrier"
            >
              <MoveRight className="h-3 w-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            <p className="text-[10px] text-muted-foreground px-2 py-1 font-medium">Assigner à :</p>
            {drafts.map((d, idx) => (
              <button
                key={d.id}
                type="button"
                onClick={() => { onAssign(file.id, d.id); setOpen(false); }}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors truncate"
              >
                Courrier {idx + 1} — {d.title || "Sans titre"}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      <button
        type="button"
        onClick={() => onReject(file.id)}
        className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
        title="Supprimer ce fichier"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function BulkStep4Verify({
  drafts,
  files,
  services,
  orgTags,
  onChange,
  onPreview,
  onFileReject,
}: Props) {
  const assignedFileIds = new Set(drafts.flatMap((d) => d.fileIds));
  const orphanedFiles = files.filter((f) => !f.rejected && !assignedFileIds.has(f.id));
  function updateDraft(id: string, patch: Partial<DraftCourier>) {
    onChange(
      drafts.map((d) => {
        if (d.id !== id) return d;
        const updated = { ...d, ...patch };
        const flags: Array<"missing-service" | "duplicate"> = [];
        if (!updated.serviceName) flags.push("missing-service");
        const sameTitle = drafts.filter(
          (x) => x.id !== id && x.title.trim() && x.title.trim() === updated.title.trim()
        );
        if (sameTitle.length > 0) flags.push("duplicate");
        return { ...updated, flags };
      })
    );
  }

  function moveFile(fileId: string, targetDraftId: string) {
    onChange(
      drafts.map((d) => {
        if (d.fileIds.includes(fileId)) {
          return { ...d, fileIds: d.fileIds.filter((id) => id !== fileId) };
        }
        if (d.id === targetDraftId) {
          return { ...d, fileIds: [...d.fileIds, fileId] };
        }
        return d;
      })
    );
  }

  function deleteDraft(id: string) {
    onChange(drafts.filter((d) => d.id !== id));
  }

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
    <div className="space-y-3">
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead className="min-w-[180px]">Titre</TableHead>
              <TableHead className="min-w-[140px]">Expéditeur</TableHead>
              <TableHead className="min-w-[120px]">Destinataire</TableHead>
              <TableHead className="min-w-[160px]">
                Service gestionnaire <span className="text-destructive">*</span>
              </TableHead>
              <TableHead className="min-w-[140px]">Tags</TableHead>
              <TableHead className="min-w-[160px]">Documents</TableHead>
              <TableHead className="w-20 text-center">IA</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.map((draft, idx) => {
              const hasMissingService = draft.flags.includes("missing-service");
              const hasDuplicate = draft.flags.includes("duplicate");
              return (
                <TableRow
                  key={draft.id}
                  className={cn(
                    "align-top",
                    hasMissingService && "bg-destructive/5 hover:bg-destructive/10",
                    !hasMissingService && hasDuplicate && "bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/10 dark:hover:bg-yellow-900/20"
                  )}
                >
                  <TableCell className="text-sm font-medium text-muted-foreground pt-3">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="pt-2">
                    <Input
                      value={draft.title}
                      onChange={(e) => updateDraft(draft.id, { title: e.target.value })}
                      placeholder="Titre du courrier"
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className="pt-2">
                    <div className="space-y-1">
                      <Input
                        value={draft.senderName}
                        onChange={(e) => updateDraft(draft.id, { senderName: e.target.value })}
                        placeholder="Nom"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={draft.senderEmail}
                        onChange={(e) => updateDraft(draft.id, { senderEmail: e.target.value })}
                        placeholder="Email"
                        className="h-8 text-xs"
                        type="email"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="pt-2">
                    <Input
                      value={draft.recipientName}
                      onChange={(e) => updateDraft(draft.id, { recipientName: e.target.value })}
                      placeholder="Destinataire"
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className="pt-2">
                    <Select
                      value={draft.serviceId || "__none__"}
                      onValueChange={(v) => {
                        const svc = services.find((s) => s.id === v);
                        updateDraft(draft.id, {
                          serviceId: svc?.id ?? "",
                          serviceName: svc?.name ?? "",
                        });
                      }}
                    >
                      <SelectTrigger
                        className={cn(
                          "h-8 text-xs",
                          hasMissingService && "border-destructive focus:ring-destructive"
                        )}
                      >
                        <SelectValue placeholder="Sélectionner…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" disabled>
                          Sélectionner un service
                        </SelectItem>
                        {services.map((s) => (
                          <SelectItem key={s.id} value={s.id} className="text-xs">
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {hasMissingService && (
                      <p className="text-[10px] text-destructive mt-0.5">Requis</p>
                    )}
                  </TableCell>
                  <TableCell className="pt-2">
                    <TagCombobox
                      selected={draft.tags}
                      orgTags={orgTags}
                      onChange={(tags) => updateDraft(draft.id, { tags })}
                    />
                  </TableCell>
                  <TableCell className="pt-2">
                    <div className="flex flex-wrap gap-1">
                      {draft.fileIds.map((fid) => (
                        <FileChip
                          key={fid}
                          fileId={fid}
                          files={files}
                          drafts={drafts}
                          draftId={draft.id}
                          onMove={moveFile}
                          onPreview={onPreview}
                        />
                      ))}
                      {draft.fileIds.length === 0 && (
                        <span className="text-[10px] text-muted-foreground">Aucun</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center pt-3">
                    {draft.confidence > 0 ? (
                      <span
                        className={cn(
                          "text-xs font-medium",
                          draft.confidence >= 0.8
                            ? "text-green-600"
                            : draft.confidence >= 0.5
                            ? "text-yellow-600"
                            : "text-orange-600"
                        )}
                      >
                        {Math.round(draft.confidence * 100)}%
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteDraft(draft.id)}
                      disabled={drafts.length <= 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addDraft} className="gap-1.5">
        <Plus className="h-4 w-4" />
        Ajouter un courrier
      </Button>

      {orphanedFiles.length > 0 && (
        <div className="rounded-lg border border-yellow-400/50 bg-yellow-50 dark:bg-yellow-900/10 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
              {orphanedFiles.length} fichier{orphanedFiles.length > 1 ? "s" : ""} sans courrier — assignez-les ou supprimez-les
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 h-7"
              onClick={() => {
                const newDrafts: DraftCourier[] = orphanedFiles.map((f) => ({
                  id: crypto.randomUUID(),
                  title: "",
                  senderName: "",
                  senderEmail: "",
                  recipientName: "",
                  serviceId: "",
                  serviceName: "",
                  tags: [],
                  bodyText: "",
                  fileIds: [f.id],
                  confidence: 0,
                  flags: ["missing-service"],
                }));
                onChange([...drafts, ...newDrafts]);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              1 fichier = 1 courrier
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {orphanedFiles.map((f) => (
              <OrphanFileChip
                key={f.id}
                file={f}
                drafts={drafts}
                onAssign={(fileId, draftId) =>
                  onChange(drafts.map((d) =>
                    d.id === draftId ? { ...d, fileIds: [...d.fileIds, fileId] } : d
                  ))
                }
                onReject={onFileReject}
                onPreview={onPreview}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
