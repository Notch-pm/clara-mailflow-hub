import { useCallback, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/contexts/OrganizationContext";
import { StateNode, type StateNodeData } from "@/components/workflow/StateNode";
import { StateEditPanel } from "@/components/workflow/StateEditPanel";
import { WorkflowToolbar } from "@/components/workflow/WorkflowToolbar";
import {
  getWorkflowById,
  createState,
  updateState,
  deleteState,
  createTransition,
  deleteTransition,
  getAffectedCouriers,
  clearInitialFlag,
} from "@/services/workflowService";
import type { WorkflowCategory, WorkflowState, WorkflowTransition } from "@/types/courier";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const nodeTypes = { stateNode: StateNode };

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;

function layoutNodes(states: WorkflowState[], transitions: WorkflowTransition[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });

  states.forEach((s) => {
    g.setNode(s.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  transitions.forEach((t) => {
    g.setEdge(t.from_state_id, t.to_state_id);
  });

  dagre.layout(g);

  return states.map((s) => {
    const pos = g.node(s.id);
    return {
      id: s.id,
      type: "stateNode",
      position: { x: (pos?.x ?? 0) - NODE_WIDTH / 2, y: (pos?.y ?? 0) - NODE_HEIGHT / 2 },
      data: {
        label: s.name,
        category: s.category,
        is_initial: s.is_initial ?? false,
        is_final: s.is_final ?? false,
        requires_signature: (s as any).requires_signature ?? false,
        is_send: (s as any).is_send ?? false,
      } satisfies StateNodeData,
    };
  });
}

function toEdges(transitions: WorkflowTransition[]): Edge[] {
  return transitions.map((t) => ({
    id: t.id,
    source: t.from_state_id,
    target: t.to_state_id,
    label: t.name ?? undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 2 },
  }));
}

// Business rule helpers
const CATEGORY_ORDER: Record<WorkflowCategory, number> = {
  pending: 0,
  processing: 1,
  processed: 2,
  archived: 3,
};

function isTransitionAllowed(
  sourceCategory: WorkflowCategory,
  targetCategory: WorkflowCategory
): { allowed: boolean; reason?: string } {
  if (sourceCategory === "archived") {
    return { allowed: false, reason: "Un état archivé ne peut pas avoir de transitions sortantes." };
  }
  if (sourceCategory === "processed" && targetCategory === "pending") {
    return { allowed: false, reason: "Un état traité ne peut pas retourner vers un état en attente." };
  }
  return { allowed: true };
}

export default function WorkflowDetail() {
  const { id: workflowId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ stateId: string; courierCount: number } | null>(null);

  const { data: workflow, isLoading } = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: async () => {
      if (!organizationId || !workflowId) throw new Error("Missing params");
      const { data, error } = await getWorkflowById(organizationId, workflowId);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && !!workflowId,
  });

  // Set nodes/edges when workflow loads
  const [initialized, setInitialized] = useState(false);
  if (workflow && !initialized) {
    const states = (workflow.workflow_states ?? []) as WorkflowState[];
    const transitions = (workflow.workflow_transitions ?? []) as WorkflowTransition[];
    setNodes(layoutNodes(states, transitions));
    setEdges(toEdges(transitions));
    setInitialized(true);
  }

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;

      const srcData = sourceNode.data as unknown as StateNodeData;
      const tgtData = targetNode.data as unknown as StateNodeData;
      const check = isTransitionAllowed(srcData.category, tgtData.category);
      if (!check.allowed) {
        toast({ title: "Transition invalide", description: check.reason, variant: "destructive" });
        return;
      }

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `temp-${Date.now()}`,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [nodes, setEdges, toast]
  );

  const handleAddState = useCallback(
    async (category: WorkflowCategory) => {
      if (!organizationId || !workflowId) return;
      const isReply = (workflow as any)?.type === "reply";
      const name = isReply
        ? (category === "pending" ? "Non répondu"
          : category === "processing" ? "En cours"
          : category === "processed" ? "Répondu"
          : "Archivé")
        : (category === "pending" ? "Nouveau - Attente"
          : category === "processing" ? "Nouveau - Traitement"
          : category === "processed" ? "Nouveau - Traité"
          : "Nouveau - Archivé");

      const { data, error } = await createState(organizationId, workflowId, { name, category });
      if (error) {
        toast({ title: "Erreur", description: error.message, variant: "destructive" });
        return;
      }
      if (!data) return;

      const newNode: Node = {
        id: data.id,
        type: "stateNode",
        position: { x: Math.random() * 300 + 50, y: Math.random() * 300 + 50 },
        data: {
          label: data.name,
          category: data.category,
          is_initial: data.is_initial ?? false,
          is_final: data.is_final ?? false,
          requires_signature: (data as any).requires_signature ?? false,
          is_send: (data as any).is_send ?? false,
        } satisfies StateNodeData,
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [organizationId, workflowId, workflow, setNodes, toast]
  );

  const handleUpdateNode = useCallback(
    async (data: { name?: string; category?: WorkflowCategory; is_initial?: boolean; is_final?: boolean; requires_signature?: boolean; is_send?: boolean }) => {
      if (!selectedNodeId || !workflowId) return;

      // If setting is_initial, clear others first
      if (data.is_initial === true) {
        await clearInitialFlag(workflowId, selectedNodeId);
        setNodes((nds) =>
          nds.map((n) =>
            n.id !== selectedNodeId
              ? { ...n, data: { ...n.data, is_initial: false } }
              : n
          )
        );
      }

      const { error } = await updateState(selectedNodeId, data);
      if (error) {
        toast({ title: "Erreur", description: error.message, variant: "destructive" });
        return;
      }

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n;
          const current = n.data as unknown as StateNodeData;
          return {
            ...n,
            data: {
              ...current,
              label: data.name ?? current.label,
              category: data.category ?? current.category,
              is_initial: data.is_initial ?? current.is_initial,
              is_final: data.is_final ?? current.is_final,
              requires_signature: data.requires_signature ?? current.requires_signature,
              is_send: data.is_send ?? current.is_send,
            } satisfies StateNodeData,
          };
        })
      );
    },
    [selectedNodeId, workflowId, setNodes, toast]
  );

  const handleDeleteNode = useCallback(async () => {
    if (!selectedNodeId) return;

    // Check affected couriers
    const { data: couriers } = await getAffectedCouriers([selectedNodeId]);
    if (couriers && couriers.length > 0) {
      setDeleteConfirm({ stateId: selectedNodeId, courierCount: couriers.length });
      return;
    }

    await performDeleteState(selectedNodeId);
  }, [selectedNodeId]);

  const performDeleteState = useCallback(
    async (stateId: string) => {
      const { error } = await deleteState(stateId);
      if (error) {
        toast({ title: "Erreur", description: error.message, variant: "destructive" });
        return;
      }
      setNodes((nds) => nds.filter((n) => n.id !== stateId));
      setEdges((eds) => eds.filter((e) => e.source !== stateId && e.target !== stateId));
      setSelectedNodeId(null);
      setDeleteConfirm(null);
    },
    [setNodes, setEdges, toast]
  );

  const handleSave = useCallback(async () => {
    if (!organizationId || !workflowId) return;

    // Validate: at least one initial state
    const hasInitial = nodes.some((n) => (n.data as unknown as StateNodeData).is_initial);
    if (!hasInitial) {
      toast({ title: "Validation", description: "Il faut au moins un état initial.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // Sync transitions: delete all existing, recreate from edges
      const { data: wf } = await getWorkflowById(organizationId, workflowId);
      const existingTransitions = (wf?.workflow_transitions ?? []) as WorkflowTransition[];

      // Delete removed transitions
      const currentEdgeIds = new Set(edges.map((e) => e.id));
      for (const t of existingTransitions) {
        if (!currentEdgeIds.has(t.id)) {
          await deleteTransition(t.id);
        }
      }

      // Create new transitions (temp IDs)
      for (const e of edges) {
        if (e.id.startsWith("temp-")) {
          const { data, error } = await createTransition(
            organizationId,
            workflowId,
            e.source,
            e.target,
            typeof e.label === "string" ? e.label : undefined
          );
          if (error) throw error;
          // Update edge ID with real ID
          if (data) {
            setEdges((eds) => eds.map((ed) => (ed.id === e.id ? { ...ed, id: data.id } : ed)));
          }
        }
      }

      toast({ title: "Sauvegardé", description: "Le workflow a été mis à jour." });
      queryClient.invalidateQueries({ queryKey: ["workflow", workflowId] });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [organizationId, workflowId, nodes, edges, toast, queryClient, setEdges]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onEdgeDoubleClick = useCallback(
    async (_: any, edge: Edge) => {
      if (edge.id.startsWith("temp-")) {
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      } else {
        const { error } = await deleteTransition(edge.id);
        if (!error) {
          setEdges((eds) => eds.filter((e) => e.id !== edge.id));
        }
      }
    },
    [setEdges]
  );

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Chargement…</div>;
  }

  const selectedData = selectedNode?.data as unknown as StateNodeData | undefined;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center gap-3 p-4 border-b">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">{workflow?.name ?? "Workflow"}</h1>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <WorkflowToolbar onAddState={handleAddState} onSave={handleSave} saving={saving} workflowType={(workflow as any)?.type ?? null} />

        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onEdgeDoubleClick={onEdgeDoubleClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {selectedData && selectedNodeId && (
          <StateEditPanel
            stateId={selectedNodeId}
            name={selectedData.label}
            category={selectedData.category}
            isInitial={selectedData.is_initial}
            isFinal={selectedData.is_final}
            requiresSignature={selectedData.requires_signature ?? false}
            workflowType={(workflow as any)?.type ?? null}
            onUpdate={handleUpdateNode}
            onDelete={handleDeleteNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet état ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm?.courierCount} courrier(s) utilisent cet état. Ils seront désassociés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirm && performDeleteState(deleteConfirm.stateId)}>
              Supprimer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
