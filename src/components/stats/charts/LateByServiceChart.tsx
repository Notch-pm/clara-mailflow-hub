import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { PHONE_QUERY } from "@/lib/breakpoints";
import type { LateByService } from "@/lib/stats-sla";
import { CHART_COLORS, useChartBase, baseGrid, baseTooltip, boundedBarHeight, horizontalBarYAxis } from "../chartConfig";

interface Props {
  data: LateByService[] | undefined;
  loading: boolean;
}

/** Nombre de courriers en retard de résolution, par service : traités hors délai et encore ouverts. */
export function LateByServiceChart({ data, loading }: Props) {
  const chartBase = useChartBase();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const rows = (data ?? []).filter((d) => d.late_processed + d.late_open > 0);
  const categories = rows.map((d) => d.service_name);
  const series = [
    { name: "Traités en retard", data: rows.map((d) => d.late_processed) },
    { name: "En retard, non traités", data: rows.map((d) => d.late_open) },
  ];
  const maxVal = Math.max(...rows.map((d) => d.late_processed + d.late_open), 1);

  const options: ApexOptions = {
    chart: { ...chartBase, type: "bar", stacked: true, id: "late-by-service" },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "60%" } },
    colors: [CHART_COLORS[3], CHART_COLORS[7]],
    xaxis: {
      categories,
      tickAmount: Math.min(maxVal, 8),
      labels: {
        style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" },
        formatter: (v) => {
          const n = Number(v);
          return Number.isInteger(n) ? String(n) : "";
        },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: horizontalBarYAxis(isPhone),
    grid: baseGrid,
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} courrier(s)` } },
    dataLabels: { enabled: false },
    legend: { position: "bottom", fontSize: "11px", fontFamily: "'Nunito Sans', sans-serif" },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Courriers en retard par service</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : !rows.length ? (
          <div className="h-[280px] flex flex-col items-center justify-center text-sm text-muted-foreground text-center">
            <p>Aucun courrier en retard sur la période</p>
            <p className="text-xs">(seules les organisations ayant un délai de résolution sont comptées)</p>
          </div>
        ) : (
          <ReactApexChart
            options={options}
            series={series}
            type="bar"
            height={boundedBarHeight(categories.length, 44)}
          />
        )}
      </CardContent>
    </Card>
  );
}
