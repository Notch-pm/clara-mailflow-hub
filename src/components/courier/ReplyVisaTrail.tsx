import { useQuery } from "@tanstack/react-query";
import { Stamp } from "lucide-react";
import { listReplyVisas, visaPersonName, type ReplyVisa } from "@/services/courierVisaService";
import { cn } from "@/lib/utils";

// Trace des visas d'une réponse : qui a visé, quand, à quelle étape, à la place
// de qui. Un visa périmé (la réponse est repassée par l'étape) reste affiché,
// grisé : il a eu lieu, mais un nouveau visa a été exigé.

function formatVisaDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function ReplyVisaTrail({ visas, className }: { visas: ReplyVisa[]; className?: string }) {
  if (visas.length === 0) return null;
  return (
    <ul className={cn("space-y-1.5", className)} aria-label="Visas de la réponse">
      {visas.map((v) => {
        const superseded = !!v.superseded_at;
        const onBehalf = v.designated_user_id && v.designated_user_id !== v.user_id;
        return (
          <li
            key={v.id}
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
              superseded ? "bg-muted/40 text-muted-foreground" : "border-primary/30 bg-primary/5",
            )}
          >
            <Stamp className={cn("mt-0.5 h-4 w-4 shrink-0", superseded ? "text-muted-foreground" : "text-primary")} />
            <div className="min-w-0 flex-1">
              <p>
                Visé par <span className="font-medium">{visaPersonName(v.user)}</span> le {formatVisaDate(v.visa_at)}
                {v.state_name ? <> — étape « {v.state_name} »</> : null}
                {onBehalf ? <span className="text-muted-foreground"> (à la place de {visaPersonName(v.designated)})</span> : null}
              </p>
              {v.comment && <p className="mt-0.5 text-xs text-muted-foreground">« {v.comment} »</p>}
              {superseded && <p className="mt-0.5 text-xs italic">Visa antérieur, à refaire après un retour en arrière.</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Section autonome (écran du courrier sortant) : charge et affiche les visas d'une réponse. */
export function ReplyVisaSection({
  organizationId,
  replyId,
  stateId = null,
}: {
  organizationId: string;
  replyId: string;
  /** État courant : une transition (qui peut périmer un visa) relit la trace. */
  stateId?: string | null;
}) {
  const { data: visas = [] } = useQuery({
    queryKey: ["reply-visas", organizationId, [replyId], stateId],
    queryFn: () => listReplyVisas(organizationId, [replyId]),
    enabled: !!organizationId && !!replyId,
  });
  if (visas.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Visas</p>
      <ReplyVisaTrail visas={visas} />
    </div>
  );
}
