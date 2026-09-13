import { ArrowRight, ChevronRight, PenLine } from "lucide-react";
import { Link } from "react-router-dom";
import { EluScreen } from "@/components/elu/EluScreenHeader";
import { EluSearchLink } from "@/components/elu/EluSearchField";
import { useEluMonthCounters } from "@/hooks/useEluMonthCounters";
import { useEluSignatureQueue } from "@/hooks/useEluSignatureQueue";
import { oldestWaitingLabel } from "@/lib/elu-delay";

function CounterRow({ value, label, meta }: { value: number; label: string; meta: string }) {
  return (
    <Link
      to="/elu/indicateurs"
      className="flex min-h-[72px] items-center gap-3.5 rounded-xl border bg-card px-4 shadow-airbnb-sm"
    >
      <span className="min-w-[52px] text-[30px] font-extrabold tracking-tight tabular-nums text-foreground">
        {value}
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-[17px] font-semibold text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">{meta}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

export default function EluAccueil() {
  const { count, items, isSignatory } = useEluSignatureQueue();
  const { counters } = useEluMonthCounters();

  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const oldest = items.length > 0 ? items[0].waitingDays : 0;

  return (
    <EluScreen>
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-extrabold tracking-tight text-foreground">Bonjour,</h1>
        <span className="text-base text-muted-foreground first-letter:uppercase">{today}</span>
      </div>

      {/* La carte n'a de sens que pour un signataire : sans fiche, elle
          promettrait une action qui ne viendra jamais. */}
      {isSignatory && (
        <div className="flex flex-col gap-[18px] rounded-[--radius] bg-primary p-5 text-primary-foreground shadow-airbnb-lg">
          <div className="flex items-start gap-3.5">
            <PenLine className="mt-0.5 h-[30px] w-[30px] shrink-0" aria-hidden="true" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[40px] font-extrabold leading-none tracking-tight tabular-nums">
                {count}
              </span>
              <span className="text-[19px] font-semibold">
                {count === 1 ? "courrier à signer" : "courriers à signer"}
              </span>
              <span className="text-[15px] opacity-85">
                {count === 0 ? "Rien ne vous attend" : oldestWaitingLabel(oldest)}
              </span>
            </div>
          </div>
          {count > 0 && (
            <Link
              to="/elu/a-signer"
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary-foreground text-[18px] font-bold text-primary transition active:scale-[0.98]"
            >
              Ouvrir la signature
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}

      <EluSearchLink />

      <div className="flex flex-col gap-2.5">
        <h2 className="text-[19px] font-bold text-foreground">Le courrier ce mois</h2>
        {counters ? (
          <>
            <CounterRow value={counters.recus} label="Courriers reçus" meta={counters.monthLabel} />
            <CounterRow
              value={counters.enTraitement}
              label="En traitement"
              meta={`${counters.enAttente} en attente, ${counters.enInstruction} en instruction`}
            />
            <CounterRow value={counters.traites} label="Courriers traités" meta={counters.monthLabel} />
          </>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[15px] text-muted-foreground">
            Chargement des chiffres…
          </p>
        )}
      </div>
    </EluScreen>
  );
}
