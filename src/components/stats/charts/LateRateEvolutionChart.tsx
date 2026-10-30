import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LateRateEvolution } from "@/lib/stats-sla";
import { CHART_COLORS, CHART_TOTAL_COLOR, useChartBase, baseGrid, baseXAxis, baseTooltip } from "../chartConfig";
import { format, parse } from "date-fns";
import { fr } from "date-fns/locale";

interface Props {
  data: LateRateEvolution | undefined;
  loading: boolean;
}

function revealMarkers(chart: { el: HTMLElement }) {
  chart.el
    .querySelectorAll(".apexcharts-series-markers-wrap.apexcharts-element-hidden")
    .forEach((el) => el.classList.remove("apexcharts-element-hidden"));
}

/**
 * Taux de retard par mois de réception, sur 12 mois. La première courbe
 * (pointillés, gris foncé) est l'ensemble ; les suivantes, les services qui
 * reçoivent le plus.
 */
export function LateRateEvolutionChart({ data, loading }: Props) {
  const chartBase = useChartBase();
  const categories = (data?.months ?? []).map((m) =>
    format(parse(m, "yyyy-MM", new Date()), "MMM yy", { locale: fr }),
  );
  const seriesData = data?.series ?? [];
  const series = seriesData.map((s) => ({ name: s.service_name, data: s.rates }));
  const colors = seriesData.map((_, i) => (i === 0 ? CHART_TOTAL_COLOR : CHART_COLORS[(i - 1) % CHART_COLORS.length]));

  const options: ApexOptions = {
    chart: {
      ...chartBase,
      type: "line",
      id: "late-rate-evolution",
      // ApexCharts ne révèle les points qu'après avoir tracé un segment de
      // ligne : un mois isolé entre deux mois sans courrier n'en a pas, et son
      // point resterait masqué. On les révèle nous-mêmes.
      events: { mounted: revealMarkers, updated: revealMarkers },
    },
    colors,
    stroke: {
      curve: "smooth",
      width: seriesData.map((_, i) => (i === 0 ? 3 : 2)),
      dashArray: seriesData.map((_, i) => (i === 0 ? 5 : 0)),
    },
    markers: { size: 3 },
    xaxis: { ...baseXAxis, categories },
    yaxis: {
      min: 0,
      max: 100,
      tickAmount: 5,
      labels: {
        style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" },
        formatter: (v: number) => `${Math.round(v)} %`,
      },
    },
    grid: baseGrid,
    tooltip: {
      ...baseTooltip,
      shared: true,
      y: { formatter: (v) => (v === null || v === undefined ? "—" : `${v} %`) },
    },
    dataLabels: { enabled: false },
    legend: { position: "bottom", fontSize: "11px", fontFamily: "'Nunito Sans', sans-serif" },
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Évolution du taux de retard par service — 12 derniers mois
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : !series.length ? (
          <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
            Aucun courrier reçu avec un délai de résolution sur 12 mois
          </div>
        ) : (
          <ReactApexChart options={options} series={series} type="line" height={320} />
        )}
      </CardContent>
    </Card>
  );
}
