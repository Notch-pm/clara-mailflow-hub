import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  listTags,
  createTag,
  deleteTag,
  TAG_COLOR_PALETTE,
  type CourierTag,
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
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLOR_PALETTE[0].value);

  const { data: tags, isLoading } = useQuery({
    queryKey: ["courier-tags", orgId],
    queryFn: () => listTags(orgId),
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: (tag: { name: string; color: string }) => createTag(orgId, tag.name, tag.color),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courier-tags", orgId] });
      setName("");
      toast.success("Tag créé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTag(orgId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courier-tags", orgId] });
      toast.success("Tag supprimé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (tags?.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("Ce tag existe déjà");
      return;
    }
    createMutation.mutate({ name: trimmed, color });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Tags className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Tags de classification</CardTitle>
              <CardDescription>
                Étiquettes utilisables pour classer les courriers de l'organisation.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {!isAdmin && (
            <Alert>
              <AlertDescription>
                Seuls les administrateurs peuvent ajouter ou supprimer des tags.
              </AlertDescription>
            </Alert>
          )}

          {isAdmin && (
            <form onSubmit={handleAdd} className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nom du tag (ex. Urgent, RH, Juridique…)"
                  className="flex-1"
                />
                <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
                  <Plus className="h-4 w-4 mr-1" />
                  Ajouter
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">Couleur :</span>
                {TAG_COLOR_PALETTE.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    aria-label={c.name}
                    title={c.name}
                    className={`h-6 w-6 rounded-full border-2 transition-all ${
                      color === c.value
                        ? "border-foreground scale-110"
                        : "border-transparent hover:border-muted-foreground/40"
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </form>
          )}

          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : tags && tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  canDelete={isAdmin}
                  onDelete={() => deleteMutation.mutate(tag.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun tag défini.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TagPill({
  tag,
  canDelete,
  onDelete,
}: {
  tag: CourierTag;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const fg = tag.color ? readableTextColor(tag.color) : undefined;
  return (
    <Badge
      variant="secondary"
      className="gap-2 pl-3 pr-1 py-1 text-sm font-medium border-transparent"
      style={tag.color ? { backgroundColor: tag.color, color: fg } : undefined}
    >
      {tag.name}
      {canDelete && (
        <button
          onClick={onDelete}
          className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
          aria-label={`Supprimer ${tag.name}`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}

/**
 * Returns "#000" or "#fff" based on best contrast against the given color.
 * Supports hex (#rgb, #rrggbb) and `hsl(h s% l%)` strings.
 */
function readableTextColor(color: string): string {
  const rgb = parseColor(color);
  if (!rgb) return "#000";
  // Relative luminance per WCAG
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#000" : "#fff";
}

function parseColor(input: string): [number, number, number] | null {
  const c = input.trim();
  // hex
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  // hsl(h s% l%) or hsl(h, s%, l%)
  const hsl = c.match(/hsl\(\s*([\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*\)/i);
  if (hsl) {
    const h = parseFloat(hsl[1]);
    const s = parseFloat(hsl[2]) / 100;
    const l = parseFloat(hsl[3]) / 100;
    return hslToRgb(h, s, l);
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
