import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Tags, Pencil, Check, X, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { readableTextColor } from "@/lib/tag-color";
import { tagsOfGroup } from "@/lib/courier-tags";
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  defaultColorFor,
  paletteFor,
  TAG_GROUPS,
  type CourierTag,
  type TagGroup,
} from "@/services/courierTagService";

interface Props {
  organizationId?: string;
  isAdminOverride?: boolean;
}

export default function ClassificationSettings({ organizationId, isAdminOverride }: Props) {
  const { membership } = useAuth();
  const orgId = organizationId ?? membership?.organization_id ?? "";
  const isAdmin = isAdminOverride ?? membership?.role === "administrateur";

  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CourierTag | null>(null);

  const { data: tags, isLoading } = useQuery({
    queryKey: ["courier-tags", orgId],
    queryFn: () => listTags(orgId),
    enabled: !!orgId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["courier-tags", orgId] });
    // Les courriers peignent leurs tags avec ces couleurs, les stats les
    // répartissent par groupe : les deux doivent suivre une modification.
    queryClient.invalidateQueries({ queryKey: ["stats-tags"] });
  };

  const createMutation = useMutation({
    mutationFn: (tag: { name: string; color: string; group: TagGroup }) =>
      createTag(orgId, tag.name, tag.color, tag.group),
    onSuccess: () => {
      invalidate();
      toast.success("Tag créé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...updates }: { id: string; name?: string; color?: string; group?: TagGroup }) =>
      updateTag(id, updates),
    onSuccess: (_data, variables) => {
      invalidate();
      setEditing(null);
      toast.success(
        variables.name !== undefined
          ? "Tag modifié — les courriers déjà tagués gardent l'ancien nom"
          : "Tag modifié",
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTag(orgId, id),
    onSuccess: () => {
      invalidate();
      toast.success("Tag supprimé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const nameTaken = (name: string, exceptId?: string) =>
    (tags ?? []).some(
      (t) => t.id !== exceptId && t.name.toLowerCase() === name.trim().toLowerCase(),
    );

  return (
    <div className="space-y-6">
      {!isAdmin && (
        <Alert>
          <AlertDescription>
            Seuls les administrateurs peuvent ajouter, modifier ou supprimer des tags.
          </AlertDescription>
        </Alert>
      )}

      {TAG_GROUPS.map((group) => (
        <TagGroupCard
          key={group.value}
          group={group}
          tags={tags ? tagsOfGroup(tags, group.value) : []}
          isLoading={isLoading}
          isAdmin={!!isAdmin}
          editingId={editing?.id ?? null}
          onStartEdit={setEditing}
          onCancelEdit={() => setEditing(null)}
          onCreate={(name, color) => {
            if (nameTaken(name)) {
              toast.error("Ce tag existe déjà");
              return false;
            }
            createMutation.mutate({ name, color, group: group.value });
            return true;
          }}
          onUpdate={(id, updates) => {
            if (updates.name !== undefined && nameTaken(updates.name, id)) {
              toast.error("Ce tag existe déjà");
              return;
            }
            updateMutation.mutate({ id, ...updates });
          }}
          onDelete={(id) => deleteMutation.mutate(id)}
          busy={createMutation.isPending || updateMutation.isPending}
        />
      ))}
    </div>
  );
}

// ── Une carte par groupe ────────────────────────────────────────────────────

function TagGroupCard({
  group,
  tags,
  isLoading,
  isAdmin,
  editingId,
  onStartEdit,
  onCancelEdit,
  onCreate,
  onUpdate,
  onDelete,
  busy,
}: {
  group: { value: TagGroup; label: string; description: string };
  tags: CourierTag[];
  isLoading: boolean;
  isAdmin: boolean;
  editingId: string | null;
  onStartEdit: (tag: CourierTag) => void;
  onCancelEdit: () => void;
  onCreate: (name: string, color: string) => boolean;
  onUpdate: (id: string, updates: { name?: string; color?: string; group?: TagGroup }) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(defaultColorFor(group.value));
  const palette = useMemo(() => paletteFor(group.value), [group.value]);
  const Icon = group.value === "sentiment" ? Smile : Tags;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (onCreate(trimmed, color)) setName("");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{group.label}</CardTitle>
            <CardDescription>{group.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isAdmin && (
          <form onSubmit={handleAdd} className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  group.value === "sentiment"
                    ? "Nom du sentiment (ex. Inquiet, Mécontent…)"
                    : "Nom du thème (ex. Voirie, Urbanisme, État civil…)"
                }
                className="flex-1"
              />
              <Button type="submit" disabled={!name.trim() || busy}>
                <Plus className="h-4 w-4 mr-1" />
                Ajouter
              </Button>
            </div>
            <ColorPicker palette={palette} value={color} onChange={setColor} />
          </form>
        )}

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) =>
              editingId === tag.id ? (
                <TagEditor
                  key={tag.id}
                  tag={tag}
                  onCancel={onCancelEdit}
                  onSave={(updates) => onUpdate(tag.id, updates)}
                  busy={busy}
                />
              ) : (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  canEdit={isAdmin}
                  onEdit={() => onStartEdit(tag)}
                  onDelete={() => onDelete(tag.id)}
                />
              ),
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Aucun tag dans ce groupe.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Palette ─────────────────────────────────────────────────────────────────

function ColorPicker({
  palette,
  value,
  onChange,
}: {
  palette: { name: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground mr-1">Couleur :</span>
      {palette.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          aria-label={c.name}
          title={c.name}
          className={`h-6 w-6 rounded-full border-2 transition-all ${
            value === c.value
              ? "border-foreground scale-110"
              : "border-transparent hover:border-muted-foreground/40"
          }`}
          style={{ backgroundColor: c.value }}
        />
      ))}
    </div>
  );
}

// ── Édition en place ────────────────────────────────────────────────────────

function TagEditor({
  tag,
  onCancel,
  onSave,
  busy,
}: {
  tag: CourierTag;
  onCancel: () => void;
  onSave: (updates: { name?: string; color?: string; group?: TagGroup }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(tag.name);
  const [group, setGroup] = useState<TagGroup>(tag.tag_group);
  // Changer de groupe change de palette : la couleur d'origine n'y a plus sa
  // place, on repart du défaut du nouveau groupe.
  const [color, setColor] = useState<string>(tag.color ?? defaultColorFor(tag.tag_group));
  const palette = useMemo(() => paletteFor(group), [group]);

  const changeGroup = (next: TagGroup) => {
    setGroup(next);
    if (!paletteFor(next).some((c) => c.value === color)) setColor(defaultColorFor(next));
  };

  return (
    <div className="w-full space-y-3 rounded-lg border bg-background p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1" autoFocus />
        <Select value={group} onValueChange={(v) => changeGroup(v as TagGroup)}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAG_GROUPS.map((g) => (
              <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="default"
            className="h-9 w-9"
            disabled={!name.trim() || busy}
            onClick={() => onSave({ name, color, group })}
            aria-label="Enregistrer"
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onCancel} aria-label="Annuler">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ColorPicker palette={palette} value={color} onChange={setColor} />
      {name.trim() !== tag.name && (
        <p className="text-[11px] text-muted-foreground">
          Les courriers déjà tagués « {tag.name} » gardent cette étiquette : elle s'affichera
          en orphelin tant qu'elle n'aura pas été remplacée sur chacun d'eux.
        </p>
      )}
    </div>
  );
}

function TagPill({
  tag,
  canEdit,
  onEdit,
  onDelete,
}: {
  tag: CourierTag;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const fg = tag.color ? readableTextColor(tag.color) : undefined;
  return (
    <Badge
      variant="secondary"
      className="gap-1.5 pl-3 pr-1 py-1 text-sm font-medium border-transparent"
      style={tag.color ? { backgroundColor: tag.color, color: fg } : undefined}
    >
      {tag.name}
      {canEdit && (
        <>
          <button
            onClick={onEdit}
            className="rounded-full p-0.5 hover:bg-background/30 transition-colors"
            aria-label={`Modifier ${tag.name}`}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
            aria-label={`Supprimer ${tag.name}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      )}
    </Badge>
  );
}
