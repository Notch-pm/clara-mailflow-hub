import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatQuartierPoint } from "@/services/statsService";
import { CHART_COLORS, baseChart, baseTooltip } from "../chartConfig";

const NO_QUARTIER_COLOR = "#9ca3af";

interface Props {
  data: StatQuartierPoint[] | undefined;
  loading: boolean;
}

export function UsagersByQuartierChart({ data, loading }: Props) {
  const points = (data ?? []).filter((d) => d.count > 0);
  const labels = points.map((d) => d.quartier_name);
  const series = points.map((d) => d.count);
  const colors = points.map((d, i) => d.color ?? (d.quartier_id === null ? NO_QUARTIER_COLOR : CHART_COLORS[i % CHART_COLORS.length]));

  const options: ApexOptions = {
    chart: { ...baseChart, type: "donut", id: "usagers-by-quartier" },
    labels,
    colors,
    plotOptions: { pie: { donut: { size: "60%", labels: { show: true, total: { show: true, label: "Total", fontSize: "13px" } } } } },
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} usager(s)` } },
    legend: { position: "bottom", fontSize: "11px", fontFamily: "'Nunito Sans', sans-serif" },
    dataLabels: { style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" } },
  };

  const isEmpty = !loading && !series.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Usagers par quartier</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isEmpty ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            Aucun usager rattaché à un quartier
          </div>
        ) : (
          <ReactApexChart options={options} series={series} type="donut" height={280} />
        )}
      </CardContent>
    </Card>
  );
}
