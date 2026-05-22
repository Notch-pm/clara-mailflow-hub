import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatChannelPoint } from "@/services/statsService";
import { CHART_COLORS, baseChart, baseTooltip } from "../chartConfig";

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  paper: "Courrier papier",
  portal: "Portail",
  manual: "Saisie manuelle",
  inconnu: "Inconnu",
};

interface Props {
  data: StatChannelPoint[] | undefined;
  loading: boolean;
}

export function ByChannelChart({ data, loading }: Props) {
  const labels = (data ?? []).map((d) => CHANNEL_LABELS[d.channel] ?? d.channel);
  const series = (data ?? []).map((d) => d.count);

  const options: ApexOptions = {
    chart: { ...baseChart, type: "donut", id: "by-channel" },
    labels,
    colors: CHART_COLORS,
    plotOptions: { pie: { donut: { size: "60%", labels: { show: true, total: { show: true, label: "Total", fontSize: "13px" } } } } },
    tooltip: { ...baseTooltip, y: { formatter: (v) => `${v} courrier(s)` } },
    legend: { position: "bottom", fontSize: "11px", fontFamily: "'Nunito Sans', sans-serif" },
    dataLabels: { style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" } },
  };

  const isEmpty = !loading && !series.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Répartition par canal d'entrée</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isEmpty ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            Aucun courrier sur la période sélectionnée
          </div>
        ) : (
          <ReactApexChart options={options} series={series} type="donut" height={280} />
        )}
      </CardContent>
    </Card>
  );
}
