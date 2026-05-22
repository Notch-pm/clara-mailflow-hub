import type { ApexOptions } from "apexcharts";

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
