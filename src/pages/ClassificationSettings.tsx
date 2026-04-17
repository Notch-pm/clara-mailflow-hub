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
