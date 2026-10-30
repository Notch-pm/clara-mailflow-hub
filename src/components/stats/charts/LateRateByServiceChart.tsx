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

/** Part des courriers reçus qui sont (ou ont été) en retard de résolution, par service. */
export function LateRateByServiceChart({ data, loading }: Props) {
  const chartBase = useChartBase();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const rows = [...(data ?? [])].sort((a, b) => b.late_rate - a.late_rate || b.received - a.received);
  const categories = rows.map((d) => d.service_name);
  const series = [{ name: "Taux de retard", data: rows.map((d) => d.late_rate) }];

  const options: ApexOptions = {
    chart: { ...chartBase, type: "bar", id: "late-rate-by-service" },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "60%" } },
    colors: [CHART_COLORS[7]],
    xaxis: {
      categories,
      min: 0,
      max: 100,
      tickAmount: 5,
      labels: {
        style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" },
        formatter: (v) => `${Math.round(Number(v))} %`,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: horizontalBarYAxis(isPhone),
    grid: baseGrid,
    tooltip: {
      ...baseTooltip,
      y: {
        formatter: (v, { dataPointIndex }) => {
          const r = rows[dataPointIndex];
          if (!r) return `${v} %`;
          return `${v} % — ${r.late_processed + r.late_open} en retard sur ${r.received} reçu(s)`;
        },
      },
    },
    dataLabels: {
      enabled: true,
      formatter: (v) => `${v} %`,
      style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" },
    },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Taux de retard sur les courriers reçus</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : !rows.length ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground text-center">
            Aucun courrier reçu avec un délai de résolution sur la période
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
