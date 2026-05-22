import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatMonthPoint } from "@/services/statsService";
import { CHART_COLORS, baseChart, baseGrid, baseXAxis, baseYAxis, baseTooltip } from "../chartConfig";
import { format, parse } from "date-fns";
import { fr } from "date-fns/locale";

interface Props {
  data: StatMonthPoint[] | undefined;
  loading: boolean;
}

export function InboundVolumeChart({ data, loading }: Props) {
  const categories = (data ?? []).map((d) =>
    format(parse(d.month, "yyyy-MM", new Date()), "MMM yy", { locale: fr }),
  );
  const series = [{ name: "Courriers entrants", data: (data ?? []).map((d) => d.count) }];

  const options: ApexOptions = {
    chart: { ...baseChart, type: "bar", id: "inbound-volume" },
    plotOptions: { bar: { borderRadius: 4, columnWidth: "60%" } },
    colors: [CHART_COLORS[0]],
    xaxis: { ...baseXAxis, categories },
    yaxis: baseYAxis,
    grid: baseGrid,
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} courrier(s)` } },
    dataLabels: { enabled: false },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Courriers entrants — 12 derniers mois</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : (
          <ReactApexChart options={options} series={series} type="bar" height={280} />
        )}
      </CardContent>
    </Card>
  );
}
