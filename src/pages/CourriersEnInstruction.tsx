import { FileClock } from "lucide-react";
import { CourierCategoryList, type CourierCategoryListConfig } from "@/components/courier/CourierCategoryList";

const CONFIG: CourierCategoryListConfig = {
  category: "processing",
  icon: <FileClock className="text-primary" />,
  title: "Courriers en instruction",
  key: "instruction",
  csvName: "courriers-en-instruction",
  stateTone: "warning",
  withSla: true,
  empty: "Aucun courrier en cours d'instruction.",
  emptyFiltered: "Aucun courrier en instruction ne correspond à ces critères.",
};

export default function CourriersEnInstruction() {
  return <CourierCategoryList config={CONFIG} />;
}
