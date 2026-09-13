import type { ApexOptions } from "apexcharts";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { PHONE_QUERY } from "@/lib/breakpoints";

export const CHART_COLORS = [
  "#0acf83",
  "#ffcd57",
  "#3b82f6",
  "#f97316",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f43f5e",
  "#a3e635",
  "#fb923c",
];

export const baseChart: ApexOptions["chart"] = {
  fontFamily: "'Nunito Sans', sans-serif",
  toolbar: {
    show: true,
    tools: {
      download: true,
      selection: true,
      zoom: true,
      zoomin: true,
      zoomout: true,
      pan: true,
      reset: true,
    },
    export: {
      csv: { columnDelimiter: ";" },
    },
  },
  zoom: { enabled: true },
};


/**
 * Base du graphique, adaptée au support.
 *
 * Sur un téléphone, la barre d'outils d'ApexCharts aligne sept icônes en haut
 * d'une carte de 330 px de large, et ses outils de zoom, de sélection et de
 * déplacement sont des gestes de souris : le graphique capte alors le
 * défilement vertical de la page, qui ne bouge plus. Masquer la barre ne
 * suffit pas — c'est `zoom.enabled` qui installe le capteur de geste.
 */
export function useChartBase(): ApexOptions["chart"] {
  const isPhone = useMediaQuery(PHONE_QUERY);
  if (!isPhone) return baseChart;
  return { ...baseChart, toolbar: { show: false }, zoom: { enabled: false } };
}

/**
 * Hauteur d'un graphique à barres horizontales, une barre par service.
 *
 * Sans borne, quinze services donnent 660 px : sur un écran de 844 px, la
 * carte occupe tout et l'on ne voit plus qu'elle. Au-delà, le graphique
 * défile de lui-même.
 */
export function boundedBarHeight(rows: number, perRow: number): number {
  return Math.min(420, Math.max(200, rows * perRow));
}

/**
 * Axe des ordonnées d'un graphique à barres horizontales : les noms
 * d'organisation y mangent une part fixe de la largeur, et sur 390 px il ne
 * resterait presque rien pour les barres.
 */
export function horizontalBarYAxis(isPhone: boolean): ApexOptions["yaxis"] {
  return {
    labels: {
      maxWidth: isPhone ? 110 : 200,
      style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" },
    },
  };
}

export const baseGrid: ApexOptions["grid"] = {
  borderColor: "#e5e7eb",
  strokeDashArray: 4,
};

export const baseXAxis: ApexOptions["xaxis"] = {
  labels: { style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" } },
  axisBorder: { show: false },
  axisTicks: { show: false },
};

export const baseYAxis: ApexOptions["yaxis"] = {
  labels: {
    style: { fontFamily: "'Nunito Sans', sans-serif", fontSize: "11px" },
    formatter: (v: number) => Math.round(v).toString(),
  },
};

export const baseTooltip: ApexOptions["tooltip"] = {
  style: { fontFamily: "'Nunito Sans', sans-serif" },
};
