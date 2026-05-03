import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
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
  RotateCcw,
  TicketPlus,
  TicketX,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  courierId: string;
  organizationId: string;
}

interface UnifiedEvent {
  id: string;
  type: string;
  at: string;
  by: string | null;
  title: string;
  detail?: string | null;
}

const ICONS: Record<string, JSX.Element> = {
  courier_created:       <FilePlus2 className="h-3.5 w-3.5" />,
  instruction_started:   <PlayCircle className="h-3.5 w-3.5" />,
  note_added:            <StickyNote className="h-3.5 w-3.5" />,
  note_updated:          <Pencil className="h-3.5 w-3.5" />,
  note_deleted:          <Trash2 className="h-3.5 w-3.5" />,
  document_added:        <Paperclip className="h-3.5 w-3.5" />,
  document_updated:      <Pencil className="h-3.5 w-3.5" />,
  document_deleted:      <FileX2 className="h-3.5 w-3.5" />,
  service_changed:       <Briefcase className="h-3.5 w-3.5" />,
  state_changed:         <ArrowRightCircle className="h-3.5 w-3.5" />,
  reply_created:         <MessageSquarePlus className="h-3.5 w-3.5" />,
  reply_deleted:         <MessageSquareX className="h-3.5 w-3.5" />,
  reply_state_changed:   <ArrowRightCircle className="h-3.5 w-3.5" />,
  reply_sent:            <Send className="h-3.5 w-3.5" />,
  reply_signed:          <PenLine className="h-3.5 w-3.5" />,
  reply_unsigned:        <PenOff className="h-3.5 w-3.5" />,
  reply_send_reset:      <RotateCcw className="h-3.5 w-3.5" />,
  ticket_created:        <TicketPlus className="h-3.5 w-3.5" />,
  ticket_updated:        <MessageSquare className="h-3.5 w-3.5" />,
  ticket_deleted:        <TicketX className="h-3.5 w-3.5" />,
};

const LABELS: Record<string, string> = {
  courier_created:       "Création du courrier",
  instruction_started:   "Début d'instruction",
  note_added:            "Note ajoutée",
  note_updated:          "Note modifiée",
  note_deleted:          "Note supprimée",
  document_added:        "Document ajouté",
  document_updated:      "Document modifié",
  document_deleted:      "Document supprimé",
  service_changed:       "Changement de service",
  state_changed:         "Changement d'état",
  reply_created:         "Réponse créée",
  reply_deleted:         "Réponse supprimée",
  reply_state_changed:   "Changement d'état de la réponse",
  reply_sent:            "Réponse envoyée",
  reply_signed:          "Réponse signée",
  reply_unsigned:        "Signature retirée",
  reply_send_reset:      "Envoi annulé",
  ticket_created:        "Ticket créé",
  ticket_updated:        "Ticket mis à jour",
  ticket_deleted:        "Ticket supprimé",
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

export default function CourierHistoryTab({ courierId, organizationId }: Props) {
  // Courier (for created_at / created_by)
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

  // Events
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

  // Collect user IDs for name lookup
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    if (courier?.created_by) ids.add(courier.created_by);
    events.forEach((e: any) => {
      if (e.created_by) ids.add(e.created_by);
    });
    return Array.from(ids);
  }, [courier, events]);

  const { data: usersMap = new Map<string, string>() } = useQuery({
    queryKey: ["users-by-id", userIds.join(",")],
    queryFn: async () => {
      if (!userIds.length) return new Map<string, string>();
      const { data, error } = await supabase
        .from("users")
        .select("id, first_name, last_name, email")
        .in("id", userIds);
      if (error) throw error;
      const m = new Map<string, string>();
      (data ?? []).forEach((u) => {
        const name =
          [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
          u.email ||
          "Utilisateur";
        m.set(u.id, name);
      });
      return m;
    },
    enabled: userIds.length > 0,
  });

  const unified = useMemo<UnifiedEvent[]>(() => {
    const out: UnifiedEvent[] = [];

    if (courier?.created_at) {
      out.push({
        id: `created-${courier.id}`,
        type: "courier_created",
        at: courier.created_at,
        by: courier.created_by ?? null,
        title: LABELS.courier_created,
      });
    }

    events.forEach((e: any) => {
      const payload = (e.payload ?? {}) as Record<string, any>;
      let detail: string | null = null;
      switch (e.event_type) {
        case "service_changed":
          detail = payload.from
            ? `${payload.from ?? "—"} → ${payload.to ?? "—"}`
            : payload.to
              ? `→ ${payload.to}`
              : null;
          break;
        case "state_changed":
          detail = payload.to_name
            ? `${payload.from_name ?? "—"} → ${payload.to_name}`
            : null;
          break;
        case "note_added":
        case "note_updated":
          if (payload.preview) detail = `« ${payload.preview} »`;
          break;
        case "document_added":
        case "document_deleted":
        case "document_updated":
          detail =
            [payload.file_name, payload.document_type]
              .filter(Boolean)
              .join(" · ") || null;
          break;
        default:
          detail = null;
      }

      out.push({
        id: e.id,
        type: e.event_type,
        at: e.created_at,
        by: e.created_by ?? null,
        title: LABELS[e.event_type] ?? e.event_type,
        detail,
      });
    });

    return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [courier, events]);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground italic">Chargement de l'historique…</p>
    );
  }

  if (!unified.length) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Aucun événement enregistré pour ce courrier.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Historique</h3>
        <span className="text-xs text-muted-foreground">({unified.length})</span>
      </div>

      <ol className="relative border-l border-border pl-5 space-y-4">
        {unified.map((ev) => {
          const userName = ev.by ? usersMap.get(ev.by) ?? "Utilisateur inconnu" : "Système";
          return (
            <li key={ev.id} className="relative">
              <span
                className="absolute -left-[26px] flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border text-muted-foreground"
                aria-hidden
              >
                {ICONS[ev.type] ?? <Activity className="h-3 w-3" />}
              </span>
              <div className="text-sm">
                <span className="font-medium">{ev.title}</span>
                {ev.detail && (
                  <span className="text-muted-foreground"> — {ev.detail}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {formatDate(ev.at)} · par <span className="font-medium">{userName}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
