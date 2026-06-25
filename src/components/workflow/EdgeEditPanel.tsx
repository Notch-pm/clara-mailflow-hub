import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, X, ArrowRight, ArrowLeft } from "lucide-react";
import type { TransitionKind } from "@/services/workflowService";

interface EdgeEditPanelProps {
  edgeId: string;
  name: string;
  kind: TransitionKind;
  sourceLabel?: string;
  targetLabel?: string;
  onUpdate: (data: { name?: string; kind?: TransitionKind }) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function EdgeEditPanel({
  name,
  kind,
  sourceLabel,
  targetLabel,
  onUpdate,
  onDelete,
  onClose,
}: EdgeEditPanelProps) {
  return (
    <div className="w-64 border-l bg-card p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Éditer la transition</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Fermer" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {(sourceLabel || targetLabel) && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{sourceLabel ?? "?"}</span>
          {" → "}
          <span className="font-medium">{targetLabel ?? "?"}</span>
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="edge-name">Nom (optionnel)</Label>
        <Input
          id="edge-name"
          value={name}
          placeholder="ex. Valider, Refuser…"
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Rôle dans le workflow</Label>
        <Select
          value={kind ?? "none"}
          onValueChange={(v) =>
            onUpdate({ kind: v === "none" ? null : (v as TransitionKind) })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Aucun (secondaire)</SelectItem>
            <SelectItem value="next">
              <span className="flex items-center gap-2">
                <ArrowRight className="h-3.5 w-3.5 text-[#0acf83]" />
                Suivante (nominale)
              </span>
            </SelectItem>
            <SelectItem value="previous">
              <span className="flex items-center gap-2">
                <ArrowLeft className="h-3.5 w-3.5 text-amber-600" />
                Précédente (retour)
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground italic">
          La transition « Suivante » est utilisée par les automatisations (ex. avancement après signature). Un seul « Suivante » et un seul « Précédente » par état source.
        </p>
      </div>

      <Button variant="destructive" size="sm" className="w-full" onClick={onDelete}>
        <Trash2 className="h-4 w-4 mr-2" />
        Supprimer la transition
      </Button>
    </div>
  );
}
