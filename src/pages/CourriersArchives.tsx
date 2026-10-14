import { Archive } from "lucide-react";
import { CourierCategoryList, type CourierCategoryListConfig } from "@/components/courier/CourierCategoryList";

const CONFIG: CourierCategoryListConfig = {
  category: "archived",
  icon: <Archive className="text-primary" />,
  title: "Courriers archivés",
  key: "archives",
  csvName: "courriers-archives",
  stateTone: "muted",
  withSla: false,
  enteredAt: {
    id: "archived_at",
    title: "Archivé le",
    exportLabel: "Date d'archivage",
    groupLabel: "Mois d'archivage",
  },
  empty: "Aucun courrier archivé.",
  emptyFiltered: "Aucun courrier archivé ne correspond à ces critères.",
};

export default function CourriersArchives() {
  return <CourierCategoryList config={CONFIG} />;
}
