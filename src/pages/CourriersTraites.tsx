import { CheckCircle2 } from "lucide-react";
import { CourierCategoryList, type CourierCategoryListConfig } from "@/components/courier/CourierCategoryList";

const CONFIG: CourierCategoryListConfig = {
  category: "processed",
  icon: <CheckCircle2 className="text-primary" />,
  title: "Courriers traités",
  key: "traites",
  csvName: "courriers-traites",
  stateTone: "primary",
  withSla: true,
  enteredAt: {
    id: "processed_at",
    title: "Traité le",
    exportLabel: "Date de traitement",
    groupLabel: "Mois de traitement",
  },
  empty: "Aucun courrier traité.",
  emptyFiltered: "Aucun courrier traité ne correspond à ces critères.",
};

export default function CourriersTraites() {
  return <CourierCategoryList config={CONFIG} />;
}
