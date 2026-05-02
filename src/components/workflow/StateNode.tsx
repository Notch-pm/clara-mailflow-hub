import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap, CheckCircle2, PenLine, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WorkflowCategory } from "@/types/courier";

export interface StateNodeData {
  label: string;
  category: WorkflowCategory;
  is_initial: boolean;
  is_final: boolean;
  requires_signature?: boolean;
  is_send?: boolean;
  [key: string]: unknown;
}

const categoryConfig: Record<WorkflowCategory, { label: string; color: string }> = {
  pending: { label: "Reçu en attente", color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  processing: { label: "En traitement", color: "bg-blue-100 text-blue-800 border-blue-300" },
  processed: { label: "Traité", color: "bg-green-100 text-green-800 border-green-300" },
  archived: { label: "Archivé", color: "bg-gray-100 text-gray-600 border-gray-300" },
};

function StateNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as StateNodeData;
  const config = categoryConfig[nodeData.category] || categoryConfig.pending;

  return (
    <div
      className={`px-4 py-3 rounded-xl border-2 bg-card shadow-md min-w-[160px] transition-shadow ${
        selected ? "ring-2 ring-ring shadow-lg" : ""
      } ${nodeData.is_final ? "border-green-500" : nodeData.is_initial ? "border-primary" : "border-border"}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-3 !h-3" />

      <div className="flex items-center gap-2 mb-1">
        {nodeData.is_initial && <Zap className="h-3.5 w-3.5 text-primary" />}
        {nodeData.is_final && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
        {nodeData.requires_signature && (
          <PenLine className="h-3.5 w-3.5 text-amber-600" aria-label="Signature requise" />
        )}
        {nodeData.is_send && (
          <Send className="h-3.5 w-3.5 text-blue-600" aria-label="Envoyer" />
        )}
        <span className="font-semibold text-sm text-foreground truncate">{nodeData.label}</span>
      </div>

      <Badge variant="outline" className={`text-[10px] ${config.color}`}>
        {config.label}
      </Badge>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-3 !h-3" />
    </div>
  );
}

export const StateNode = memo(StateNodeComponent);
