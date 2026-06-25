import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  createNote,
  updateNote,
  deleteNote,
  type CourierNote,
} from "@/services/courierNoteService";
import { getOrgMembers } from "@/services/userService";
import MentionTextarea, { renderNoteContent, type MentionUser } from "./MentionTextarea";

interface Props {
  courierId: string;
  organizationId: string;
  notes: CourierNote[];
  readOnly?: boolean;
}

export default function NotesInlineSidebar({ courierId, organizationId, notes, readOnly = false }: Props) {
  const qc = useQueryClient();
  const queryKey = ["courier-notes", courierId];

  const authorIds = useMemo(
    () => [...new Set(notes.map((n) => n.created_by).filter(Boolean) as string[])],
    [notes],
  );

  const { data: usersMap = new Map<string, string>() } = useQuery({
    queryKey: ["users-by-id", authorIds.join(",")],
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("id, first_name, last_name, email")
        .in("id", authorIds);
      const m = new Map<string, string>();
      (data ?? []).forEach((u) => {
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || "Utilisateur";
        m.set(u.id, name);
      });
      return m;
    },
    enabled: authorIds.length > 0,
  });

  // Liste des membres pour les mentions @
  const { data: members = [] } = useQuery({
    queryKey: ["org-members-mentions", organizationId],
    queryFn: () => getOrgMembers(organizationId),
    enabled: !!organizationId && !readOnly,
  });

  const mentionUsers: MentionUser[] = useMemo(
    () =>
      members
        .filter((m) => m.is_active !== false && m.membership_active !== false)
        .map((m) => ({
          id: m.id,
          label:
            [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.email || "Utilisateur",
          email: m.email,
        })),
    [members],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [editingMentions, setEditingMentions] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
  };

  const createMut = useMutation({
    mutationFn: ({ content, mentions }: { content: string; mentions: string[] }) =>
      createNote(organizationId, courierId, content, mentions),
    onSuccess: () => {
      setDraft("");
      setDraftMentions([]);
      setAddOpen(false);
      invalidate();
      toast.success("Note ajoutée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, content, mentions }: { id: string; content: string; mentions: string[] }) =>
      updateNote(id, content, mentions),
    onSuccess: () => {
      setEditingId(null);
      setEditingDraft("");
      setEditingMentions([]);
      invalidate();
      toast.success("Note modifiée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => { setDeleteId(null); invalidate(); toast.success("Note supprimée"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col h-full border-l bg-amber-50/40">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-amber-50 shrink-0">
        <span className="text-sm font-semibold text-amber-900">
          Notes internes {notes.length > 0 && <span className="text-amber-700">{notes.length}</span>}
        </span>
        {!readOnly && (
          <Button
            size="sm"
            className="h-7 bg-green-600 hover:bg-green-700 text-white text-xs px-2.5"
            onClick={() => { setAddOpen((o) => !o); setDraft(""); setDraftMentions([]); }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Ajouter
          </Button>
        )}
      </div>

      {/* Add form */}
      {addOpen && (
        <div className="px-3 py-2 border-b bg-amber-50 space-y-2 shrink-0">
          <MentionTextarea
            autoFocus
            value={draft}
            onChange={(v, ids) => { setDraft(v); setDraftMentions(ids); }}
            users={mentionUsers}
            placeholder="Saisir une note… Tapez @ pour mentionner"
            className="min-h-[80px] text-sm bg-yellow-100 border-yellow-300 resize-none"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAddOpen(false); setDraft(""); setDraftMentions([]); }}>
              Annuler
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
              disabled={!draft.trim() || createMut.isPending}
              onClick={() => createMut.mutate({ content: draft, mentions: draftMentions })}
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Enregistrer
            </Button>
          </div>
        </div>
      )}

      {/* RGPD notice */}
      <div className="px-3 py-2 border-b bg-amber-50/60 shrink-0">
        <p className="text-[10px] text-amber-800/70 leading-snug">
          Le contenu des notes doit respecter les préconisations du RGPD et ne pas contenir d'informations sensibles.
        </p>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {notes.length === 0 ? (
          <p className="text-xs text-amber-700/60 italic text-center mt-4">Aucune note.</p>
        ) : (
          notes.map((n) => (
            <div
              key={n.id}
              className="rounded bg-yellow-200 shadow-sm border border-yellow-300 px-3 py-2.5 space-y-2 group"
            >
              {editingId === n.id ? (
                <>
                  <MentionTextarea
                    autoFocus
                    value={editingDraft}
                    onChange={(v, ids) => { setEditingDraft(v); setEditingMentions(ids); }}
                    users={mentionUsers}
                    className="min-h-[70px] text-sm bg-yellow-100 border-yellow-300 resize-none"
                  />
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                      onClick={() => { setEditingId(null); setEditingDraft(""); setEditingMentions([]); }}>
                      <X className="h-3 w-3 mr-0.5" />Annuler
                    </Button>
                    <Button size="sm" className="h-6 text-xs px-2 bg-green-600 hover:bg-green-700 text-white"
                      disabled={!editingDraft.trim() || updateMut.isPending}
                      onClick={() => updateMut.mutate({ id: n.id, content: editingDraft, mentions: editingMentions })}>
                      <Check className="h-3 w-3 mr-0.5" />Enregistrer
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap break-words text-yellow-950">
                    {renderNoteContent(n.content, mentionUsers)}
                  </p>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] text-yellow-700 leading-tight">
                      {n.created_by && (
                        <span className="font-medium block">{usersMap.get(n.created_by) ?? "…"}</span>
                      )}
                      {new Date(n.created_at).toLocaleString("fr-FR", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                      {n.updated_at && n.updated_at !== n.created_at && " · modifiée"}
                    </span>
                    {!readOnly && (
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button type="button" size="icon" variant="ghost" className="h-6 w-6 hover:bg-yellow-900/15"
                          onClick={() => {
                            setEditingId(n.id);
                            setEditingDraft(n.content);
                            setEditingMentions(n.mentioned_user_ids ?? []);
                          }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost"
                          className="h-6 w-6 text-red-600 hover:text-red-700 hover:bg-yellow-900/15"
                          onClick={() => setDeleteId(n.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette note ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est définitive.</AlertDialogDescription>
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
