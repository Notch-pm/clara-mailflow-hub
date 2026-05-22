import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatServicePoint } from "@/services/statsService";
import { CHART_COLORS, baseChart, baseGrid, baseTooltip } from "../chartConfig";

interface Props {
  data: StatServicePoint[] | undefined;
  loading: boolean;
  direction: "inbound" | "outbound";
}

export function ByServiceChart({ data, loading, direction }: Props) {
  const title =
    direction === "inbound"
      ? "Courriers entrants par service"
      : "Courriers sortants par service";

  const isEmpty = !loading && !(data ?? []).length;

  if (direction === "outbound") {
    const labels = (data ?? []).map((d) => d.service_name);
    const series = (data ?? []).map((d) => d.count);

    const options: ApexOptions = {
      chart: { ...baseChart, type: "donut", id: "by-service-outbound" },
      labels,
      colors: CHART_COLORS,
      plotOptions: {
        pie: {
          donut: {
            size: "60%",
            labels: { show: true, total: { show: true, label: "Total", fontSize: "13px" } },
          },
        },
      },
      tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} courrier(s)` } },
      legend: { position: "bottom", fontSize: "11px", fontFamily: "'Nunito Sans', sans-serif" },
      dataLabels: { style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" } },
    };

    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : isEmpty ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
              Aucune donnée sur la période sélectionnée
            </div>
          ) : (
            <ReactApexChart options={options} series={series} type="donut" height={280} />
          )}
        </CardContent>
      </Card>
    );
  }

  // Inbound — horizontal bar
  const categories = (data ?? []).map((d) => d.service_name);
  const maxVal = Math.max(...(data ?? []).map((d) => d.count), 1);
  const barSeries = [{ name: "Entrants", data: (data ?? []).map((d) => d.count) }];

  const options: ApexOptions = {
    chart: { ...baseChart, type: "bar", id: "by-service-inbound" },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "60%" } },
    colors: [CHART_COLORS[0]],
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
    yaxis: { labels: { style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" } } },
    grid: baseGrid,
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} courrier(s)` } },
    dataLabels: { enabled: false },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isEmpty ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            Aucune donnée sur la période sélectionnée
          </div>
        ) : (
          <ReactApexChart
            options={options}
            series={barSeries}
            type="bar"
            height={Math.max(200, categories.length * 44)}
          />
        )}
      </CardContent>
    </Card>
  );
}
