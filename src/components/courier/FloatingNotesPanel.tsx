import { useState } from "react";
import { ChevronRight, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import NotesInlineSidebar from "./NotesInlineSidebar";
import type { CourierNote } from "@/services/courierNoteService";

interface Props {
  courierId: string;
  organizationId: string;
  notes: CourierNote[];
  readOnly?: boolean;
}

export default function FloatingNotesPanel({ courierId, organizationId, notes, readOnly = false }: Props) {
  const [open, setOpen] = useState(false);
  const count = notes.length;

  return (
    <>
      {/* Languette d'ouverture */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute right-0 top-20 z-20 flex flex-col items-center gap-2 rounded-l-lg bg-amber-200 hover:bg-amber-300 text-amber-900 border border-r-0 border-amber-300 shadow-md px-1.5 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          aria-label={`Ouvrir les notes internes (${count})`}
          title="Notes internes"
        >
          <StickyNote className="h-4 w-4" />
          <span
            className="text-xs font-semibold tracking-wide"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Notes {count > 0 && `(${count})`}
          </span>
        </button>
      )}

      {/* Panneau */}
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 z-30 w-[340px] max-w-[90vw] bg-amber-50 shadow-2xl border-l border-amber-300 transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <div className="relative h-full flex flex-col">
          {open && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute -left-7 top-20 z-10 flex items-center justify-center h-12 w-7 rounded-l-md bg-amber-200 hover:bg-amber-300 text-amber-900 border border-r-0 border-amber-300 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              aria-label="Fermer les notes internes"
              title="Fermer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          <NotesInlineSidebar
            courierId={courierId}
            organizationId={organizationId}
            notes={notes}
            readOnly={readOnly}
          />
        </div>
      </div>
    </>
  );
}
