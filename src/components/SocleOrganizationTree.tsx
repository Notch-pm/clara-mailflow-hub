import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Phone, Mail, Landmark, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { listOrgsWithConfig, type SocleOrgWithConfig } from "@/services/socleOrgConfigService";
import { buildSocleOrgTree, type SocleOrgTreeNode } from "@/lib/socleOrgTree";
import OrganizationConfigDialog from "@/components/OrganizationConfigDialog";

// Arbre des (sous-)organisations synchronisées depuis le Socle.
// Réplique de l'UI du Socle (OrganizationTree.tsx) : même rendu (chevron, logo,
// badge Obsolète, coordonnées, indentation). La hiérarchie et les libellés se
// gèrent dans le Socle ; Clara y attache sa configuration de traitement
// (workflows, boîte IMAP, membres, signataires) via le bouton « Paramétrer ».

function collectAllIds(nodes: SocleOrgTreeNode<SocleOrgWithConfig>[]): string[] {
  const ids: string[] = [];
  const walk = (list: SocleOrgTreeNode<SocleOrgWithConfig>[]) => {
    for (const n of list) {
      ids.push(n.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

export default function SocleOrganizationTree({
  orgId,
  isAdminOverride,
}: {
  orgId: string;
  isAdminOverride?: boolean;
}) {
  const { membership, profile } = useAuth();
  const isAdmin =
    isAdminOverride ?? (membership?.role === "administrateur" || !!profile?.is_superadmin);

  const [configOrg, setConfigOrg] = React.useState<SocleOrgWithConfig | null>(null);
  const [configOpen, setConfigOpen] = React.useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["socle-orgs-config", orgId],
    queryFn: () => listOrgsWithConfig(orgId),
    enabled: !!orgId,
  });

  const nodes = React.useMemo(() => buildSocleOrgTree(rows), [rows]);
  const onConfigure = React.useCallback(
    (node: SocleOrgWithConfig) => {
      setConfigOrg(node);
      setConfigOpen(true);
    },
    [],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Landmark className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Organisations</CardTitle>
            <CardDescription>
              Hiérarchie synchronisée depuis le Socle — consultation uniquement, la gestion se
              fait dans le Socle.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
            <Building2 className="h-8 w-8" />
            <p className="text-sm">
              Aucune organisation synchronisée — vérifiez le mapping Socle puis lancez une
              synchronisation.
            </p>
          </div>
        ) : (
          <Tree nodes={nodes} onConfigure={isAdmin ? onConfigure : undefined} />
        )}
      </CardContent>
      <OrganizationConfigDialog
        open={configOpen}
        onOpenChange={(o) => {
          setConfigOpen(o);
          if (!o) setConfigOrg(null);
        }}
        org={configOrg}
        orgId={orgId}
      />
    </Card>
  );
}

function Tree({
  nodes,
  onConfigure,
}: {
  nodes: SocleOrgTreeNode<SocleOrgWithConfig>[];
  onConfigure?: (node: SocleOrgWithConfig) => void;
}) {
  // Tout déplié par défaut : la hiérarchie complète est visible d'un coup d'œil.
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(collectAllIds(nodes)),
  );

  React.useEffect(() => {
    setExpanded(new Set(collectAllIds(nodes)));
  }, [nodes]);

  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <ul className="flex flex-col gap-1">
      {nodes.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          expanded={expanded}
          onToggleExpand={toggle}
          onConfigure={onConfigure}
        />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  expanded,
  onToggleExpand,
  onConfigure,
}: {
  node: SocleOrgTreeNode<SocleOrgWithConfig>;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onConfigure?: (node: SocleOrgWithConfig) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isObsolete = node.status === "obsolete" || node.obsoleted_at !== null;

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border px-2 py-2",
          isObsolete && "opacity-60",
        )}
      >
        <button
          type="button"
          aria-label={hasChildren ? (isOpen ? "Réduire" : "Développer") : undefined}
          onClick={() => hasChildren && onToggleExpand(node.id)}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground",
            hasChildren ? "hover:bg-muted" : "invisible",
          )}
        >
          <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} />
        </button>

        {node.logo_url ? (
          <img src={node.logo_url} alt="" className="size-6 shrink-0 rounded object-contain" />
        ) : (
          <Building2 className="size-5 shrink-0 text-muted-foreground" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("truncate font-medium", isObsolete && "line-through")}>
              {node.name}
            </span>
            {isObsolete ? (
              <Badge variant="secondary" className="shrink-0">
                Obsolète
              </Badge>
            ) : null}
          </div>
          {(node.phone || node.email || node.address) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {node.phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3" />
                  {node.phone}
                </span>
              ) : null}
              {node.email ? (
                <span className="inline-flex items-center gap-1">
                  <Mail className="size-3" />
                  {node.email}
                </span>
              ) : null}
              {node.address ? <span className="truncate">{node.address.split("\n")[0]}</span> : null}
            </div>
          )}
        </div>

        {onConfigure && !isObsolete ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            title="Paramétrer"
            aria-label={`Paramétrer ${node.name}`}
            onClick={() => onConfigure(node)}
          >
            <Settings className="size-4" />
          </Button>
        ) : null}
      </div>

      {hasChildren && isOpen ? (
        <ul className="mt-1 flex flex-col gap-1 border-l border-border pl-4 ml-[1.4rem]">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onConfigure={onConfigure}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
