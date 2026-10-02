import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useDashboard, useDashboardTrends } from "@/hooks/useDashboard";
import { canAccessStats, isOrgAdmin } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  longDate,
  monthName,
  scopeLabel,
  sparklinePaths,
  type DashboardList,
  type DashboardRole,
  type TrendChart,
  type Tone,
} from "@/lib/dashboard";

// ─── Tons ────────────────────────────────────────────────────────────────────

const PILL: Record<Tone, string> = {
  urgent: "bg-destructive/10 text-destructive",
  attention: "bg-secondary/45 text-secondary-foreground",
  neutral: "bg-muted text-muted-foreground",
  good: "bg-primary/10 text-primary",
};

// ─── Liste ───────────────────────────────────────────────────────────────────

const LIST_GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:grid-cols-[minmax(0,1fr)_150px_120px]";

function ListTabs({
  lists,
  current,
  onChange,
}: {
  lists: DashboardList[];
  current: DashboardRole;
  onChange: (role: DashboardRole) => void;
}) {
  return (
    <div role="tablist" aria-label="Listes" className="flex h-9 max-w-full overflow-x-auto rounded-full bg-muted p-[3px]">
      {lists.map((list) => {
        const on = list.role === current;
        return (
          <button
            key={list.role}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(list.role)}
            className={cn(
              "inline-flex h-[30px] shrink-0 items-center gap-[7px] whitespace-nowrap rounded-full px-3 text-[13px] transition-colors",
              on ? "bg-card font-bold text-foreground shadow-airbnb-sm" : "font-semibold text-muted-foreground hover:text-foreground",
            )}
          >
            {list.tabLabel}
            <span
              className={cn(
                "grid h-[18px] min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-extrabold",
                on ? "bg-secondary text-secondary-foreground" : "bg-border text-muted-foreground",
              )}
            >
              {list.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ListSection({
  lists,
  current,
  onChange,
  loading,
}: {
  lists: DashboardList[];
  current: DashboardList;
  onChange: (role: DashboardRole) => void;
  loading: boolean;
}) {
  const tabs = lists.length > 1;
  return (
    <section className="flex min-w-0 flex-[2_1_560px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        {tabs ? (
          <ListTabs lists={lists} current={current.role} onChange={onChange} />
        ) : (
          <>
            <h2 className="text-base font-bold">{current.title}</h2>
            <span className="rounded-full bg-muted px-[9px] py-0.5 text-xs font-bold text-muted-foreground">{current.count}</span>
          </>
        )}
        <span className="flex-1" />
        <Link to={current.link.href} className="whitespace-nowrap text-[13px] font-semibold text-primary hover:underline">
          {current.link.label}
        </Link>
      </div>
      <Card className="overflow-hidden shadow-airbnb" role={tabs ? "tabpanel" : undefined}>
        <div className={cn(LIST_GRID, "border-b px-4 py-2.5 text-xs font-semibold text-muted-foreground")}>
          <span>Courrier</span>
          <span className="hidden sm:block">{current.columns[0]}</span>
          <span className="text-right">{current.columns[1]}</span>
        </div>
        {loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : current.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Aucun courrier dans cette liste.</p>
        ) : (
          <div className="divide-y divide-border/70">
            {current.rows.map((row) => (
              <Link
                key={row.id}
                to={row.href}
                className={cn(LIST_GRID, "items-center px-4 py-3 transition-colors hover:bg-muted/50")}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-bold">{row.title}</span>
                  <span className="truncate text-[12.5px] text-muted-foreground">
                    {row.chrono && <span className="font-mono text-[11.5px]">{row.chrono}</span>}
                    {row.chrono && row.sender && " · "}
                    {row.sender}
                    {/* Sur téléphone, la colonne du milieu passe sous le titre. */}
                    <span className="sm:hidden">{(row.chrono || row.sender) && " · "}{row.mid}</span>
                  </span>
                </div>
                <span className="hidden truncate text-[12.5px] font-semibold text-foreground/85 sm:block">{row.mid}</span>
                <div className="flex justify-end">
                  <span className={cn("whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-bold", PILL[row.tone])}>
                    {row.end}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

// ─── Tendances ───────────────────────────────────────────────────────────────

function Sparkline({
  chart,
  active,
  onActive,
}: {
  chart: TrendChart;
  active: number | null;
  onActive: (i: number | null) => void;
}) {
  const { line, area, y } = useMemo(() => sparklinePaths(chart.points.map((p) => p.value)), [chart.points]);
  const n = chart.points.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const marker = active ?? (n && y[n - 1] !== null ? n - 1 : null);
  return (
    <div className="relative h-10" onMouseLeave={() => onActive(null)}>
      <svg
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full overflow-visible"
        aria-hidden="true"
      >
        <path d={area} className="fill-primary/[0.08]" />
        <path
          d={line}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ vectorEffect: "non-scaling-stroke" }}
        />
      </svg>
      {active !== null && (
        <span
          className="pointer-events-none absolute inset-y-0 w-px bg-border"
          style={{ left: `${x(active)}%` }}
          aria-hidden="true"
        />
      )}
      {marker !== null && y[marker] !== null && (
        <span
          className="pointer-events-none absolute -ml-[3.5px] -mt-[3.5px] h-[7px] w-[7px] rounded-full bg-primary ring-2 ring-card"
          style={{ left: `${x(marker)}%`, top: `${(y[marker]! / 32) * 100}%` }}
          aria-hidden="true"
        />
      )}
      {/* Zones de survol : une colonne par mois, plus large que le point. */}
      <div className="absolute inset-0 flex" aria-hidden="true">
        {chart.points.map((p, i) => (
          <span key={p.label} className="h-full flex-1" onMouseEnter={() => onActive(i)} />
        ))}
      </div>
    </div>
  );
}

function TrendCard({ chart, loading }: { chart: TrendChart; loading: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const shown = active !== null ? chart.points[active] : chart.points[chart.points.length - 1];
  return (
    <div className="flex min-w-[200px] flex-[1_0_200px] flex-col gap-1 rounded-lg border bg-card px-4 py-3.5 shadow-sm">
      <span className="truncate text-[13px] font-semibold text-muted-foreground">{chart.label}</span>
      {loading || !shown ? (
        <Skeleton className="mb-2 h-7 w-20" />
      ) : (
        <div className="mb-2 flex items-baseline gap-1.5">
          <span className="text-[22px] font-extrabold tracking-tight tabular-nums">{shown.display}</span>
          {/* Au survol, le mois suit l'unité et l'écart s'efface. */}
          <span className="min-w-0 truncate text-[13px] text-muted-foreground">
            {active !== null ? `${chart.unit} · ${shown.short}` : chart.unit}
          </span>
          <span className="flex-1" />
          {active === null && (
            <span
              className={cn(
                "shrink-0 whitespace-nowrap text-xs font-bold tabular-nums",
                chart.trend === "good" && "text-primary",
                chart.trend === "bad" && "text-destructive",
                chart.trend === null && "text-muted-foreground",
              )}
            >
              {chart.delta ?? "—"}
            </span>
          )}
        </div>
      )}
      {loading ? <Skeleton className="h-10 w-full" /> : <Sparkline chart={chart} active={active} onActive={setActive} />}
      <table className="sr-only">
        <caption>{chart.label}, par mois</caption>
        <tbody>
          {chart.points.map((p) => (
            <tr key={p.label}>
              <th scope="row">{p.label}</th>
              <td>{p.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TREND_PLACEHOLDERS = [
  "Courriers reçus",
  "En cours",
  "Courriers répondus",
  "Délai moyen de réponse",
  "Délai moyen de traitement",
];

function TrendsSection({
  pending,
  scopeIds,
  scopeToggle,
  showStatsLink,
}: {
  /** Périmètre pas encore connu (rattachements en lecture) : squelettes, sans requête. */
  pending: boolean;
  scopeIds: string[] | null;
  scopeToggle: { mine: boolean; onChange: (mine: boolean) => void } | null;
  showStatsLink: boolean;
}) {
  const trends = useDashboardTrends(scopeIds, !pending);
  const { charts, lastMonth, error } = trends;
  const isLoading = pending || trends.isLoading;
  const shown: TrendChart[] = charts.length
    ? charts
    : TREND_PLACEHOLDERS.map((label) => ({ key: label, label, unit: "", points: [], delta: null, trend: null }));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-base font-bold">Tendances</h2>
        <span className="text-[12.5px] text-muted-foreground">
          12 derniers mois
          {lastMonth && ` · valeur de ${monthName(lastMonth)}, écart avec le mois d'avant`}
        </span>
        <span className="flex-1" />
        {scopeToggle && (
          <div
            className="flex h-[34px] shrink-0 rounded-full border p-[3px]"
            role="group"
            aria-label="Périmètre des tendances"
          >
            {[
              { mine: true, label: "Mon service" },
              { mine: false, label: "Toute l'organisation" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={scopeToggle.mine === option.mine}
                onClick={() => scopeToggle.onChange(option.mine)}
                className={cn(
                  "h-[26px] whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold text-foreground",
                  scopeToggle.mine === option.mine && "bg-muted",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {showStatsLink && (
          <Link to="/statistiques" className="whitespace-nowrap text-[13px] font-semibold text-primary hover:underline">
            Statistiques
          </Link>
        )}
      </div>
      {error ? (
        <p className="text-sm text-muted-foreground">Les tendances n'ont pas pu être chargées.</p>
      ) : (
        <div className="-m-0.5 flex gap-3 overflow-x-auto p-0.5 pb-2">
          {shown.map((chart) => (
            <TrendCard key={chart.key} chart={chart} loading={isLoading} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Accueil : ce qui attend l'utilisateur selon ses casquettes (agent d'un
 * service, service courrier, viseur ou signataire), la liste de travail
 * correspondante et les tendances des douze derniers mois.
 */
export default function Dashboard() {
  const { organizationId } = useOrganization();
  const { profile, membership } = useAuth();
  const dashboard = useDashboard();
  const { roles, lists, myScope } = dashboard;

  const [listRole, setListRole] = useState<DashboardRole | null>(null);
  const currentList = lists.find((l) => l.role === (listRole ?? dashboard.defaultList)) ?? lists[0];

  // Tendances : l'organisation entière pour qui la regarde déjà (service
  // courrier, parapheur, administrateur) ; son service pour un agent seul.
  const orgWide = roles.includes("mailroom") || roles.includes("parapheur") || isOrgAdmin(membership);
  const canToggleScope = !!myScope && orgWide;
  const [trendsMine, setTrendsMine] = useState<boolean | null>(null);
  const mine = !!myScope && (trendsMine ?? !orgWide);
  const trendScope = useMemo(() => (mine && myScope ? [...myScope] : null), [mine, myScope]);

  if (!organizationId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Sélectionnez une organisation pour voir vos données.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* La recherche globale vit dans l'en-tête de l'application. */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-[1_1_320px]">
          <h1 className="text-2xl font-bold tracking-tight">
            Bonjour{profile?.first_name ? ` ${profile.first_name}` : ""}
          </h1>
          <p className="mt-0.5 text-muted-foreground">
            {longDate()}
            {!dashboard.isLoading && ` · ${scopeLabel(roles, dashboard.serviceNames, membership?.organization_name ?? null)}`}
          </p>
        </div>
        {dashboard.hero && (
          <Button asChild className="h-10 gap-2 rounded-lg px-4 font-bold">
            <Link to={dashboard.hero.href}>
              <CheckCheck className="h-4 w-4" strokeWidth={2.2} />
              {dashboard.hero.label}
            </Link>
          </Button>
        )}
      </div>

      <TrendsSection
        pending={dashboard.isLoading}
        scopeIds={trendScope}
        scopeToggle={canToggleScope ? { mine, onChange: setTrendsMine } : null}
        showStatsLink={canAccessStats(profile, membership)}
      />

      {dashboard.error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Impossible de charger vos courriers. Rechargez la page dans un instant.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-start gap-6">
        {/* Tant que les rattachements ne sont pas lus, les casquettes (donc les
            onglets) ne sont pas connues : un squelette plutôt qu'un onglet qui surgit. */}
        {dashboard.isLoading ? (
          <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-3">
            <Skeleton className="h-9 w-64 rounded-full" />
            <Skeleton className="h-60 w-full rounded-lg" />
          </div>
        ) : currentList && (
          <ListSection
            lists={lists}
            current={currentList}
            onChange={setListRole}
            loading={currentList.role === "parapheur" ? dashboard.parapheurLoading : dashboard.isLoading}
          />
        )}
      </div>
    </div>
  );
}
