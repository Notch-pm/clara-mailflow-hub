import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatProcessingPoint } from "@/services/statsService";
import { CHART_COLORS, baseChart, baseGrid, baseTooltip } from "../chartConfig";

interface Props {
  data: StatProcessingPoint[] | undefined;
  loading: boolean;
}

export function ProcessingTimesChart({ data, loading }: Props) {
  const categories = (data ?? []).map((d) => d.service_name);
  const series = [
    {
      name: "Réception → Instruction",
      data: (data ?? []).map((d) => d.avg_days_to_instruction ?? 0),
    },
    {
      name: "Réception → Traité",
      data: (data ?? []).map((d) => d.avg_days_to_processed ?? 0),
    },
  ];

  const options: ApexOptions = {
    chart: { ...baseChart, type: "bar", id: "processing-times" },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "70%" } },
    colors: [CHART_COLORS[2], CHART_COLORS[0]],
    xaxis: {
      categories,
      labels: {
        style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" },
        formatter: (v) => `${v}j`,
      },
      axisBorder: { show: false },
    },
    yaxis: { labels: { style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" } } },
    grid: baseGrid,
    tooltip: {
      ...baseTooltip,
      y: { formatter: (v) => (v > 0 ? `${v} jour(s)` : "—") },
    },
    dataLabels: { enabled: false },
    legend: { position: "bottom", fontSize: "11px", fontFamily: "'Nunito Sans', sans-serif" },
  };

  const isEmpty = !loading && !categories.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Délais de traitement par service (jours)</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isEmpty ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            Aucune donnée de traitement disponible
          </div>
        ) : (
          <ReactApexChart
            options={options}
            series={series}
            type="bar"
            height={Math.max(200, categories.length * 60)}
          />
        )}
      </CardContent>
    </Card>
  );
}
