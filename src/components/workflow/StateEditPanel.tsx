import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, X, PenLine } from "lucide-react";
import type { WorkflowCategory } from "@/types/courier";

interface StateEditPanelProps {
  stateId: string;
  name: string;
  category: WorkflowCategory;
  isInitial: boolean;
  isFinal: boolean;
  requiresSignature?: boolean;
  workflowType?: "inbound" | "reply" | null;
  onUpdate: (data: {
    name?: string;
    category?: WorkflowCategory;
    is_initial?: boolean;
    is_final?: boolean;
    requires_signature?: boolean;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
}

const categories: { value: WorkflowCategory; label: string }[] = [
  { value: "pending", label: "Reçu en attente" },
  { value: "processing", label: "En cours de traitement" },
  { value: "processed", label: "Traité" },
  { value: "archived", label: "Archivé" },
];

export function StateEditPanel({
  name,
  category,
  isInitial,
  isFinal,
  requiresSignature = false,
  workflowType = null,
  onUpdate,
  onDelete,
  onClose,
}: StateEditPanelProps) {
  const isReply = workflowType === "reply";
  return (
    <div className="w-64 border-l bg-card p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Éditer l'état</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="state-name">Nom</Label>
        <Input
          id="state-name"
          value={name}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Catégorie</Label>
        <Select value={category} onValueChange={(v) => onUpdate({ category: v as WorkflowCategory })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="is-initial">État initial</Label>
        <Switch
          id="is-initial"
          checked={isInitial}
          onCheckedChange={(v) => onUpdate({ is_initial: v })}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="is-final">État final</Label>
        <Switch
          id="is-final"
          checked={isFinal}
          onCheckedChange={(v) => onUpdate({ is_final: v })}
        />
      </div>

      {isReply && (
        <div className="flex items-center justify-between border-t pt-3">
          <Label htmlFor="requires-signature" className="flex items-center gap-2">
            <PenLine className="h-4 w-4 text-amber-600" />
            Signature requise
          </Label>
          <Switch
            id="requires-signature"
            checked={requiresSignature}
            onCheckedChange={(v) => onUpdate({ requires_signature: v })}
          />
        </div>
      )}

      <Button variant="destructive" size="sm" className="w-full" onClick={onDelete}>
        <Trash2 className="h-4 w-4 mr-2" />
        Supprimer l'état
      </Button>
    </div>
  );
}
