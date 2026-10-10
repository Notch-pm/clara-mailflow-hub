import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  describeMoveGroups,
  MAILROOM_VIEWS,
  summarizeMoves,
  type MailroomItem,
  type MailroomView,
  viewOfStage,
} from "@/lib/mailroom";

/** Au-delà, une analyse encore en file est annoncée telle quelle. */
const ANALYSIS_WAIT_MS = 3 * 60_000;

export interface MailroomMove {
  ids: string[];
  /** Participe passé : « routé » — accordé au pluriel par un « s ». */
  verb: string;
  /** Ce que l'action a fait, pour un courrier seul : « Transmis à Voirie ». */
  detail?: string;
  /** Attendre la fin de l'analyse IA avant d'annoncer l'onglet d'arrivée. */
  waitAnalysis?: boolean;
}

interface Pending extends MailroomMove {
  since: number;
  /** Onglet de départ de chaque courrier, pour dire « reste dans ». */
  from: Map<string, MailroomView | null>;
}

interface Options {
  items: MailroomItem[];
  /** Instant de la dernière lecture de la liste (`dataUpdatedAt`). */
  updatedAt: number;
  /** Courrier encore affiché dans le panneau : on le suit dans son nouvel onglet. */
  isFocused: (id: string) => boolean;
  /** Courrier visible avec les filtres en cours. */
  isVisible: (id: string) => boolean;
  /** Montrer le courrier : son onglet, sa ligne, son panneau. */
  show: (id: string, view: MailroomView | null) => void;
}

/**
 * Après une action, le courrier change d'onglet. On attend la liste RELUE
 * (l'étape se recalcule sur le serveur), puis : un toast qui nomme l'onglet
 * d'arrivée (ou le décompte par onglet, pour un lot), et pour un courrier seul
 * encore affiché, la vue qui le suit.
 */
export function useMailroomMoves({ items, updatedAt, isFocused, isVisible, show }: Options) {
  const [pending, setPending] = useState<Pending[]>([]);
  // Les rappels changent à chaque rendu : l'effet lit leur dernière version.
  const latest = useRef({ isFocused, isVisible, show });
  latest.current = { isFocused, isVisible, show };

  const track = useCallback(
    (move: MailroomMove) => {
      const from = new Map(
        move.ids.map((id) => {
          const item = items.find((i) => i.row.id === id);
          return [id, item ? viewOfStage(item.stage) : null] as const;
        }),
      );
      setPending((p) => [...p, { ...move, since: Date.now(), from }]);
    },
    [items],
  );

  useEffect(() => {
    if (!pending.length) return;
    const now = Date.now();
    const done: Pending[] = [];
    for (const move of pending) {
      if (updatedAt < move.since) continue;
      const moved = items.filter((i) => move.ids.includes(i.row.id));
      const analysing = moved.some((i) => i.stage === "analysing");
      if (move.waitAnalysis && analysing && now - move.since < ANALYSIS_WAIT_MS) continue;
      done.push(move);
      announce(move, moved, items, latest.current);
    }
    if (done.length) setPending((p) => p.filter((m) => !done.includes(m)));
  }, [pending, items, updatedAt]);

  /** Courriers suivis, que le panneau garde affichés même hors de l'onglet courant. */
  const followed = new Set(pending.filter((m) => m.ids.length === 1).map((m) => m.ids[0]));

  return { track, followed };
}

function announce(
  move: Pending,
  moved: MailroomItem[],
  items: MailroomItem[],
  { isFocused, isVisible, show }: Omit<Options, "items" | "updatedAt">,
) {
  if (move.ids.length > 1) {
    const n = move.ids.length;
    toast.success(`${n} courriers ${move.verb}s`, { description: describeMoveGroups(summarizeMoves(items, move.ids)) });
    return;
  }

  const item = moved[0];
  const id = move.ids[0];
  const name = item?.row.chrono ? `Courrier ${item.row.chrono}` : "Courrier";
  if (!item) {
    toast.success(`${name} ${move.verb}`, { description: move.detail });
    return;
  }
  const view = viewOfStage(item.stage);
  const [group] = summarizeMoves(items, [id]);
  const where = view === null
    ? "en cours d'analyse"
    : `${move.from.get(id) === view ? "reste dans" : "désormais dans"} « ${MAILROOM_VIEWS[view].label} »${group?.late ? ", en retard" : ""}`;
  const visible = isVisible(id);
  const description = [move.detail, where, !visible && "masqué par les filtres en cours"].filter(Boolean).join(" · ");

  if (visible && isFocused(id)) {
    show(id, view);
    toast.success(`${name} ${move.verb}`, { description });
    return;
  }
  toast.success(`${name} ${move.verb}`, {
    description,
    action: visible ? { label: "Afficher", onClick: () => show(id, view) } : undefined,
  });
}
