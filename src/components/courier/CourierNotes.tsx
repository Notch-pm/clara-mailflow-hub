import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Check, X, Plus, StickyNote, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  type CourierNote,
} from "@/services/courierNoteService";
import { cn } from "@/lib/utils";

interface Props {
  courierId: string;
  organizationId: string;
  /** When true, hide the "add" form (e.g. courier in a final state). */
  readOnly?: boolean;
}

export default function CourierNotes({ courierId, organizationId, readOnly = false }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const queryKey = ["courier-notes", courierId];

  const { data: notes = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listNotes(courierId),
    enabled: !!courierId,
  });

  const createMut = useMutation({
    mutationFn: (content: string) => createNote(organizationId, courierId, content),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      toast.success("Note ajoutée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => updateNote(id, content),
    onSuccess: () => {
      setEditingId(null);
      setEditingDraft("");
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      toast.success("Note modifiée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => {
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier-events", courierId] });
      toast.success("Note supprimée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startEdit(n: CourierNote) {
    setEditingId(n.id);
    setEditingDraft(n.content);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Notes internes</h3>
        <span className="text-xs text-muted-foreground">({notes.length})</span>
      </div>

      <div
        role="note"
        className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
      >
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <span>
          Le contenu des notes doit respecter les préconisations du RGPD et ne pas contenir d'informations sensibles.
        </span>
      </div>

      {!readOnly && (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ajouter une note interne…"
            className="min-h-[70px] text-sm"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => createMut.mutate(draft)}
              disabled={!draft.trim() || createMut.isPending}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Ajouter
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Chargement…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Aucune note pour ce courrier.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const isEditing = editingId === n.id;
            return (
              <li
                key={n.id}
                className={cn(
                  "rounded-md border bg-background p-3 text-sm space-y-2",
                  "shadow-sm",
                )}
              >
                {isEditing ? (
                  <>
                    <Textarea
                      value={editingDraft}
                      onChange={(e) => setEditingDraft(e.target.value)}
                      className="min-h-[70px] text-sm"
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(null);
                          setEditingDraft("");
                        }}
                        disabled={updateMut.isPending}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Annuler
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          updateMut.mutate({ id: n.id, content: editingDraft })
                        }
                        disabled={!editingDraft.trim() || updateMut.isPending}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Enregistrer
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap break-words">{n.content}</p>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(n.created_at).toLocaleString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {n.updated_at && n.updated_at !== n.created_at && " · modifiée"}
                      </span>
                      {!readOnly && (
                        <div className="flex gap-0.5">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => startEdit(n)}
                            aria-label="Modifier"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteId(n.id)}
                            aria-label="Supprimer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette note ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est définitive et ne peut pas être annulée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMut.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
