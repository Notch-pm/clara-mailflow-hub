import { useMemo } from "react";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatTagPoint } from "@/services/statsService";
import type { TagGroup } from "@/services/courierTagService";
import { CHART_COLORS, baseChart, baseGrid, baseXAxis, baseYAxis, baseTooltip } from "../chartConfig";
import { format, parse } from "date-fns";
import { fr } from "date-fns/locale";

interface Props {
  data: StatTagPoint[] | undefined;
  loading: boolean;
  /**
   * Thème et sentiment ne se lisent pas sur la même courbe : l'un compte des
   * sujets, l'autre mesure un ton. Un graphique par groupe, depuis le
   * 2026-09-10.
   */
  group: TagGroup;
  /** Couleur de chaque tag, telle que paramétrée. Le dégradé vert → rouge des sentiments ne vaut que s'il est respecté ici. */
  colorByName?: Map<string, string>;
}

const TITLES: Record<TagGroup, { title: string; empty: string }> = {
  theme: {
    title: "Évolution des thèmes appliqués aux courriers entrants",
    empty: "Aucun thème sur la période sélectionnée",
  },
  sentiment: {
    title: "Évolution des sentiments relevés sur les courriers entrants",
    empty: "Aucun sentiment sur la période sélectionnée",
  },
};

export function TagEvolutionChart({ data, loading, group, colorByName }: Props) {
  const { series, categories, colors } = useMemo(() => {
    const rows = (data ?? []).filter((d) => (d.tag_group ?? "theme") === group);
    if (!rows.length) return { series: [], categories: [], colors: CHART_COLORS };
    const tags = [...new Set(rows.map((d) => d.tag_name))];
    const periods = [...new Set(rows.map((d) => d.period))].sort();
    const cats = periods.map((p) =>
      format(parse(p, "yyyy-MM", new Date()), "MMM yy", { locale: fr }),
    );
    const s = tags.map((tag) => ({
      name: tag,
      data: periods.map((period) => {
        const found = rows.find((d) => d.tag_name === tag && d.period === period);
        return found?.count ?? 0;
      }),
    }));
    // La couleur du tag prime ; la palette générique ne sert qu'aux orphelins
    // (tag appliqué puis supprimé du référentiel).
    const c = tags.map(
      (tag, i) => colorByName?.get(tag.toLowerCase()) ?? CHART_COLORS[i % CHART_COLORS.length],
    );
    return { series: s, categories: cats, colors: c };
  }, [data, group, colorByName]);

  const options: ApexOptions = {
    chart: { ...baseChart, type: "line", id: `tag-evolution-${group}` },
    stroke: { curve: "smooth", width: 2 },
    colors,
    xaxis: { ...baseXAxis, categories },
    yaxis: baseYAxis,
    grid: baseGrid,
    tooltip: { ...baseTooltip, shared: true, y: { formatter: (v) => `${v}` } },
    dataLabels: { enabled: false },
    legend: { position: "bottom", fontSize: "11px", fontFamily: "'Nunito Sans', sans-serif" },
    markers: { size: 3 },
  };

  const isEmpty = !loading && !series.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{TITLES[group].title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isEmpty ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            {TITLES[group].empty}
          </div>
        ) : (
          <ReactApexChart options={options} series={series} type="line" height={280} />
        )}
      </CardContent>
    </Card>
  );
}
