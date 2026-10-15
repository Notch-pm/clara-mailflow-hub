import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FilePlus2,
  PlayCircle,
  StickyNote,
  Pencil,
  Trash2,
  Paperclip,
  FileX2,
  Briefcase,
  ArrowRightCircle,
  Activity,
  MessageSquarePlus,
  MessageSquareX,
  MessageSquare,
  Send,
  PenLine,
  PenOff,
  Stamp,
  RotateCcw,
  TicketPlus,
  TicketX,
  ListChecks,
  BellRing,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { COURIER_EVENT_LABELS, describeCourierEvent } from "@/lib/courier-history";
import { createNote, updateNote, deleteNote, type CourierNote } from "@/services/courierNoteService";
import { getOrgMembers } from "@/services/userService";
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
import { cn } from "@/lib/utils";
import MentionTextarea, { renderNoteContent, type MentionUser } from "./MentionTextarea";

interface Props {
  courierId: string;
  organizationId: string;
  notes: CourierNote[];
  /** Sans notes (courrier sortant) : l'onglet n'est plus qu'un historique. */
  notesEnabled?: boolean;
  /** Lecture seule : les notes restent lisibles, sans ajout ni retouche. */
  readOnly?: boolean;
}

type Filter = "all" | "notes" | "events";

interface UnifiedEvent {
  id: string;
  type: string;
  at: string;
  by: string | null;
  title: string;
  detail?: string | null;
}

type FeedItem = { kind: "event"; at: string; event: UnifiedEvent } | { kind: "note"; at: string; note: CourierNote };

/** Événements que la note elle-même raconte déjà, dans la vue « Tout ». */
const NOTE_EVENTS = new Set(["note_added", "note_updated"]);

const ICONS: Record<string, JSX.Element> = {
  courier_created:       <FilePlus2 className="h-3.5 w-3.5" />,
  courier_trashed:       <Trash2 className="h-3.5 w-3.5" />,
  courier_restored:      <RotateCcw className="h-3.5 w-3.5" />,
  instruction_started:   <PlayCircle className="h-3.5 w-3.5" />,
  note_added:            <StickyNote className="h-3.5 w-3.5" />,
  note_updated:          <Pencil className="h-3.5 w-3.5" />,
  note_deleted:          <Trash2 className="h-3.5 w-3.5" />,
  document_added:        <Paperclip className="h-3.5 w-3.5" />,
  document_updated:      <Pencil className="h-3.5 w-3.5" />,
  document_deleted:      <FileX2 className="h-3.5 w-3.5" />,
  service_changed:       <Briefcase className="h-3.5 w-3.5" />,
  service_transferred:   <ArrowRightCircle className="h-3.5 w-3.5" />,
  state_changed:         <ArrowRightCircle className="h-3.5 w-3.5" />,
  reply_created:         <MessageSquarePlus className="h-3.5 w-3.5" />,
  reply_deleted:         <MessageSquareX className="h-3.5 w-3.5" />,
  reply_state_changed:   <ArrowRightCircle className="h-3.5 w-3.5" />,
  reply_sent:            <Send className="h-3.5 w-3.5" />,
  reply_signed:          <PenLine className="h-3.5 w-3.5" />,
  reply_unsigned:        <PenOff className="h-3.5 w-3.5" />,
  reply_visa_granted:    <Stamp className="h-3.5 w-3.5" />,
  reply_send_reset:      <RotateCcw className="h-3.5 w-3.5" />,
  ticket_created:        <TicketPlus className="h-3.5 w-3.5" />,
  ticket_updated:        <MessageSquare className="h-3.5 w-3.5" />,
  ticket_deleted:        <TicketX className="h-3.5 w-3.5" />,
  task_created:          <ListChecks className="h-3.5 w-3.5" />,
  task_reminded:         <BellRing className="h-3.5 w-3.5" />,
  task_completed:        <CheckCircle2 className="h-3.5 w-3.5" />,
  task_reopened:         <RotateCcw className="h-3.5 w-3.5" />,
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function userLabel(u: { first_name: string | null; last_name: string | null; email: string | null }) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || "Utilisateur";
}

/**
 * Onglet « Activité » de la fiche courrier : les notes internes et
 * l'historique des événements sur une seule frise, filtrable. Les notes
 * vivaient auparavant dans un panneau flottant, l'historique dans son propre
 * onglet : deux endroits pour une même question, « que s'est-il passé ? ».
 */
export default function CourierActivityTab({
  courierId,
  organizationId,
  notes,
  notesEnabled = true,
  readOnly = false,
}: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [editingMentions, setEditingMentions] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const effectiveFilter: Filter = notesEnabled ? filter : "events";
  const canWriteNotes = notesEnabled && !readOnly;

  const { data: courier } = useQuery({
    queryKey: ["courier-meta", courierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("couriers")
        .select("id, created_at, created_by")
        .eq("id", courierId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!courierId,
  });

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["courier-events", courierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courier_events")
        .select("*")
        .eq("courier_id", courierId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!courierId,
  });

  // Membres de l'organisation : auteurs des mentions @.
  const { data: members = [] } = useQuery({
    queryKey: ["org-members-mentions", organizationId],
    queryFn: () => getOrgMembers(organizationId),
    enabled: !!organizationId && notesEnabled,
  });

  const mentionUsers: MentionUser[] = useMemo(
    () =>
      members
        .filter((m) => m.is_active !== false && m.membership_active !== false)
        .map((m) => ({ id: m.id, label: userLabel(m), email: m.email })),
    [members],
  );

  const userIds = useMemo(() => {
    const ids = new Set<string>();
    if (courier?.created_by) ids.add(courier.created_by);
    events.forEach((e: { created_by: string | null }) => e.created_by && ids.add(e.created_by));
    notes.forEach((n) => n.created_by && ids.add(n.created_by));
    return Array.from(ids).sort();
  }, [courier, events, notes]);

  const { data: usersMap = new Map<string, string>() } = useQuery({
    queryKey: ["users-by-id", userIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, first_name, last_name, email")
        .in("id", userIds);
      if (error) throw error;
      return new Map((data ?? []).map((u) => [u.id, userLabel(u)]));
    },
    enabled: userIds.length > 0,
  });

  const unified = useMemo<UnifiedEvent[]>(() => {
    const out: UnifiedEvent[] = [];
    // Un courrier à l'initiative porte son propre événement de création, plus
    // parlant (émettrice, destinataire) : pas de doublon.
    const hasCreationEvent = events.some((e: { event_type: string }) => e.event_type === "outbound_created");
    if (courier?.created_at && !hasCreationEvent) {
      out.push({
        id: `created-${courier.id}`,
        type: "courier_created",
        at: courier.created_at,
        by: courier.created_by ?? null,
        title: COURIER_EVENT_LABELS.courier_created,
      });
    }
    events.forEach((e) => {
      const { title, detail } = describeCourierEvent(e.event_type, e.payload, e.courier_id);
      out.push({ id: e.id, type: e.event_type, at: e.created_at, by: e.created_by ?? null, title, detail });
    });
    return out;
  }, [courier, events]);

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    if (effectiveFilter !== "notes") {
      unified
        .filter((ev) => effectiveFilter === "events" || !NOTE_EVENTS.has(ev.type))
        .forEach((event) => items.push({ kind: "event", at: event.at, event }));
    }
    if (effectiveFilter !== "events") {
      notes.forEach((note) => items.push({ kind: "note", at: note.created_at, note }));
    }
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [unified, notes, effectiveFilter]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["courier-notes", courierId] });
    qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
  };

  const createMut = useMutation({
    mutationFn: ({ content, mentions }: { content: string; mentions: string[] }) =>
      createNote(organizationId, courierId, content, mentions),
    onSuccess: () => {
      setDraft("");
      setDraftMentions([]);
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
    onSuccess: () => {
      setDeleteId(null);
      invalidate();
      toast.success("Note supprimée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const segment = (value: Filter, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={filter === value}
      onClick={() => setFilter(value)}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm font-bold transition-colors",
        filter === value ? "bg-card text-foreground shadow-airbnb-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight">Activité</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {notesEnabled ? "Notes internes et historique du courrier" : "Historique du courrier"}
          </p>
        </div>
        {notesEnabled && (
          <div className="flex gap-0.5 rounded-full bg-muted p-1" role="tablist" aria-label="Filtrer l'activité">
            {segment("all", "Tout")}
            {segment("notes", "Notes")}
            {segment("events", "Historique")}
          </div>
        )}
      </div>

      {canWriteNotes && effectiveFilter !== "events" && (
        <div className="flex flex-col gap-2">
          <MentionTextarea
            value={draft}
            onChange={(v, ids) => {
              setDraft(v);
              setDraftMentions(ids);
            }}
            users={mentionUsers}
            placeholder="Ajouter une note interne… Tapez @ pour mentionner"
            className="min-h-[44px] resize-none text-sm"
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span className="flex-1">
              Les notes doivent respecter le RGPD et ne pas contenir d'informations sensibles.
            </span>
            <Button
              size="sm"
              className="h-8"
              disabled={!draft.trim() || createMut.isPending}
              onClick={() => createMut.mutate({ content: draft, mentions: draftMentions })}
            >
              Ajouter
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm italic text-muted-foreground">Chargement de l'activité…</p>
      ) : feed.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          {effectiveFilter === "notes" ? "Aucune note." : "Aucun événement enregistré pour ce courrier."}
        </p>
      ) : (
        <ol className="relative ml-2.5 flex flex-col gap-4 border-l border-border pl-5">
          {feed.map((item) => {
            if (item.kind === "event") {
              const ev = item.event;
              const userName = ev.by ? usersMap.get(ev.by) ?? "Utilisateur inconnu" : "Système";
              return (
                <li key={`e-${ev.id}`} className="relative">
                  <span
                    className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground"
                    aria-hidden
                  >
                    {ICONS[ev.type] ?? <Activity className="h-3 w-3" />}
                  </span>
                  <div className="text-sm">
                    <span className="font-semibold">{ev.title}</span>
                    {ev.detail && <span className="text-muted-foreground"> — {ev.detail}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(ev.at)} · par <span className="font-semibold">{userName}</span>
                  </div>
                </li>
              );
            }
            const n = item.note;
            const author = n.created_by ? usersMap.get(n.created_by) ?? "…" : "Utilisateur inconnu";
            return (
              <li key={`n-${n.id}`} className="group relative">
                <span
                  className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-primary"
                  aria-hidden
                >
                  <StickyNote className="h-3 w-3" />
                </span>
                <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-3 shadow-airbnb-sm">
                  {editingId === n.id ? (
                    <>
                      <MentionTextarea
                        autoFocus
                        value={editingDraft}
                        onChange={(v, ids) => {
                          setEditingDraft(v);
                          setEditingMentions(ids);
                        }}
                        users={mentionUsers}
                        className="min-h-[70px] resize-none text-sm"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => {
                            setEditingId(null);
                            setEditingDraft("");
                            setEditingMentions([]);
                          }}
                        >
                          Annuler
                        </Button>
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={!editingDraft.trim() || updateMut.isPending}
                          onClick={() => updateMut.mutate({ id: n.id, content: editingDraft, mentions: editingMentions })}
                        >
                          Enregistrer
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {renderNoteContent(n.content, mentionUsers)}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-xs text-muted-foreground">
                          Note de <span className="font-semibold">{author}</span> · {formatDate(n.created_at)}
                          {n.updated_at && n.updated_at !== n.created_at && " · modifiée"}
                        </span>
                        {canWriteNotes && (
                          <div className="flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              aria-label="Modifier la note"
                              onClick={() => {
                                setEditingId(n.id);
                                setEditingDraft(n.content);
                                setEditingMentions(n.mentioned_user_ids ?? []);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              aria-label="Supprimer la note"
                              onClick={() => setDeleteId(n.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

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
