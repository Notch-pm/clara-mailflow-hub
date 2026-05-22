import { useMemo } from "react";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatDayPoint } from "@/services/statsService";
import { CHART_COLORS, baseChart, baseGrid, baseXAxis, baseTooltip } from "../chartConfig";
import { format, subDays, startOfDay } from "date-fns";
import { fr } from "date-fns/locale";

interface Props {
  data: StatDayPoint[] | undefined;
  loading: boolean;
}

function buildFullRange(data: StatDayPoint[]): { categories: string[]; counts: number[] } {
  const lookup = new Map(data.map((d) => [d.day, d.count]));
  const today = startOfDay(new Date());
  const categories: string[] = [];
  const counts: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = subDays(today, i);
    const key = format(d, "yyyy-MM-dd");
    categories.push(format(d, "dd/MM", { locale: fr }));
    counts.push(lookup.get(key) ?? 0);
  }
  return { categories, counts };
}

export function InboundDailyChart({ data, loading }: Props) {
  const { categories, counts } = useMemo(
    () => buildFullRange(data ?? []),
    [data],
  );

  const series = [{ name: "Courriers entrants", data: counts }];

  const options: ApexOptions = {
    chart: { ...baseChart, type: "area", id: "inbound-daily" },
    stroke: { curve: "smooth", width: 2 },
    fill: { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05 } },
    colors: [CHART_COLORS[0]],
    xaxis: { ...baseXAxis, categories },
    yaxis: {
      min: 0,
      forceNiceScale: true,
      labels: {
        style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" },
        formatter: (v) => Math.round(v).toString(),
      },
    },
    grid: baseGrid,
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} courrier(s)` } },
    dataLabels: { enabled: false },
    markers: { size: 3 },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Courriers entrants — 30 derniers jours</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : (
          <ReactApexChart options={options} series={series} type="area" height={280} />
        )}
      </CardContent>
    </Card>
  );
}
