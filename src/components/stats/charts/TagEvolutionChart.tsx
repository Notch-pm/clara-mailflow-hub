import { useMemo } from "react";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatTagPoint } from "@/services/statsService";
import { CHART_COLORS, baseChart, baseGrid, baseXAxis, baseYAxis, baseTooltip } from "../chartConfig";
import { format, parse } from "date-fns";
import { fr } from "date-fns/locale";

interface Props {
  data: StatTagPoint[] | undefined;
  loading: boolean;
}

export function TagEvolutionChart({ data, loading }: Props) {
  const { series, categories } = useMemo(() => {
    if (!data?.length) return { series: [], categories: [] };
    const tags = [...new Set(data.map((d) => d.tag_name))];
    const periods = [...new Set(data.map((d) => d.period))].sort();
    const cats = periods.map((p) =>
      format(parse(p, "yyyy-MM", new Date()), "MMM yy", { locale: fr }),
    );
    const s = tags.map((tag) => ({
      name: tag,
      data: periods.map((period) => {
        const found = data.find((d) => d.tag_name === tag && d.period === period);
        return found?.count ?? 0;
      }),
    }));
    return { series: s, categories: cats };
  }, [data]);

  const options: ApexOptions = {
    chart: { ...baseChart, type: "line", id: "tag-evolution" },
    stroke: { curve: "smooth", width: 2 },
    colors: CHART_COLORS,
    xaxis: { ...baseXAxis, categories },
    yaxis: baseYAxis,
    grid: baseGrid,
    tooltip: { ...baseTooltip, shared: true, y: { formatter: (v) => `${v}` } },
    dataLabels: { enabled: false },
    legend: { position: "bottom", fontSize: "11px", fontFamily: "'Nunito Sans', sans-serif" },
    markers: { size: 3 },
  };

  const isEmpty = !loading && (!series.length);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Évolution des tags appliqués sur les nouveaux courriers entrants</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isEmpty ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            Aucun tag sur la période sélectionnée
          </div>
        ) : (
          <ReactApexChart options={options} series={series} type="line" height={280} />
        )}
      </CardContent>
    </Card>
  );
}
