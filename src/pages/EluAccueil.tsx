import { ArrowRight, ChevronRight, PenLine, Stamp, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { EluScreen } from "@/components/elu/EluScreenHeader";
import { EluSearchLink } from "@/components/elu/EluSearchField";
import { useEluMonthCounters } from "@/hooks/useEluMonthCounters";
import { useEluSignatureQueue } from "@/hooks/useEluSignatureQueue";
import { useEluVisaQueue } from "@/hooks/useEluVisaQueue";
import { cn } from "@/lib/utils";
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

/** Carte d'une file d'attente (signature, visa) : le compteur, l'ancienneté, le bouton. */
function QueueCard({
  icon: Icon,
  count,
  noun,
  meta,
  cta,
  to,
  tone,
}: {
  icon: LucideIcon;
  count: number;
  noun: string;
  meta: string;
  cta: string;
  to: string;
  tone: "primary" | "quiet";
}) {
  const primary = tone === "primary";
  return (
    <div
      className={cn(
        "flex flex-col gap-[18px] rounded-[--radius] p-5",
        primary ? "bg-primary text-primary-foreground shadow-airbnb-lg" : "border bg-card text-foreground shadow-airbnb-sm",
      )}
    >
      <div className="flex items-start gap-3.5">
        <Icon className={cn("mt-0.5 h-[30px] w-[30px] shrink-0", !primary && "text-primary")} aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[40px] font-extrabold leading-none tracking-tight tabular-nums">{count}</span>
          <span className="text-[19px] font-semibold">{noun}</span>
          <span className={cn("text-[15px]", primary ? "opacity-85" : "text-muted-foreground")}>{meta}</span>
        </div>
      </div>
      {count > 0 && (
        <Link
          to={to}
          className={cn(
            "flex min-h-14 items-center justify-center gap-2 rounded-xl text-[18px] font-bold transition active:scale-[0.98]",
            primary ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground",
          )}
        >
          {cta}
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

export default function EluAccueil() {
  const { count, items, isSignatory } = useEluSignatureQueue();
  const visa = useEluVisaQueue();
  const { counters } = useEluMonthCounters();

  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const oldest = items.length > 0 ? items[0].waitingDays : 0;
  const oldestVisa = Math.max(0, ...visa.items.map((i) => i.waitingDays));

  return (
    <EluScreen>
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-extrabold tracking-tight text-foreground">Bonjour,</h1>
        <span className="text-base text-muted-foreground first-letter:uppercase">{today}</span>
      </div>

      {/* Chaque carte n'a de sens que pour qui peut agir : sans fiche de
          signataire (ou sans l'attribut viseur), elle promettrait une action
          qui ne viendra jamais. Un élu peut porter les deux qualités. */}
      {isSignatory && (
        <QueueCard
          icon={PenLine}
          count={count}
          noun={count === 1 ? "courrier à signer" : "courriers à signer"}
          meta={count === 0 ? "Rien ne vous attend" : oldestWaitingLabel(oldest)}
          cta="Ouvrir la signature"
          to="/elu/a-signer"
          tone="primary"
        />
      )}

      {visa.isViseur && (
        <QueueCard
          icon={Stamp}
          count={visa.count}
          noun={visa.count === 1 ? "réponse à viser" : "réponses à viser"}
          meta={visa.count === 0 ? "Rien ne vous attend" : oldestWaitingLabel(oldestVisa)}
          cta="Ouvrir les visas"
          to="/elu/a-viser"
          // Une seule carte pleine à l'écran : la signature garde l'accent
          // quand l'élu porte les deux qualités.
          tone={isSignatory ? "quiet" : "primary"}
        />
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
