import { Button } from "@/components/ui/button";
import { Plus, Save } from "lucide-react";
import type { WorkflowCategory } from "@/types/courier";

interface WorkflowToolbarProps {
  onAddState: (category: WorkflowCategory) => void;
  onSave: () => void;
  saving: boolean;
}

const addOptions: { category: WorkflowCategory; label: string; color: string }[] = [
  { category: "pending", label: "Reçu", color: "bg-yellow-500 hover:bg-yellow-600" },
  { category: "processing", label: "Traitement", color: "bg-blue-500 hover:bg-blue-600" },
  { category: "processed", label: "Traité", color: "bg-green-500 hover:bg-green-600" },
  { category: "archived", label: "Archivé", color: "bg-gray-500 hover:bg-gray-600" },
];

export function WorkflowToolbar({ onAddState, onSave, saving }: WorkflowToolbarProps) {
  return (
    <div className="w-48 border-r bg-card p-4 space-y-3 overflow-y-auto">
      <h3 className="font-semibold text-sm mb-2">Ajouter un état</h3>
      {addOptions.map((opt) => (
        <Button
          key={opt.category}
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => onAddState(opt.category)}
        >
          <div className={`w-3 h-3 rounded-full ${opt.color}`} />
          {opt.label}
        </Button>
      ))}

      <div className="pt-4 border-t">
        <Button className="w-full" size="sm" onClick={onSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Sauvegarde..." : "Sauvegarder"}
        </Button>
      </div>
    </div>
  );
}
