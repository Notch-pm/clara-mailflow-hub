import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, ArrowLeft, GitBranch, Settings, Tags, Building2, ClipboardList, Mail, PenTool, FileText, Globe, Sparkles, RefreshCw, LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { triggerSocleSync, type SocleSyncResult } from "@/services/socleSyncService";
import UsersPage from "./UsersPage";
import Workflows from "./Workflows";
import ClassificationSettings from "./ClassificationSettings";
import ProceduresSettings from "./ProceduresSettings";
import SignaturesSettings from "./SignaturesSettings";
import ModeleSettings from "./ModeleSettings";

import ImapSettings from "@/components/ImapSettings";
import SocleOrganizationTree from "@/components/SocleOrganizationTree";
import PortalFormsSettings from "@/components/portal/PortalFormsSettings";
import AiUsageSettings from "@/components/AiUsageSettings";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldAlert } from "lucide-react";

type Section = "menu" | "organisations" | "utilisateurs" | "workflows" | "classification" | "demarches" | "emails" | "signatures" | "modeles" | "portail" | "ia";

const settingSections: { key: Section; title: string; description: string; icon: LucideIcon }[] = [
  { key: "organisations", title: "Organisations", description: "Hiérarchie des organisations du référentiel : workflows, boîtes IMAP, membres et signataires par organisation", icon: Building2 },
  { key: "utilisateurs", title: "Utilisateurs", description: "Gestion des membres et rôles", icon: Users },
  { key: "signatures", title: "Signatures et tampons", description: "Signataires et signatures manuscrites", icon: PenTool },
  { key: "emails", title: "Emails (IMAP)", description: "Réception automatique des emails comme courriers entrants", icon: Mail },
  { key: "workflows", title: "Workflows", description: "Processus de traitement du courrier", icon: GitBranch },
  { key: "demarches", title: "Démarches", description: "Liste des démarches administratives proposées", icon: ClipboardList },
  { key: "classification", title: "Classification", description: "Tags de classement des courriers", icon: Tags },
  { key: "modeles", title: "Modèles de documents", description: "Modèle Word pour les courriers papier", icon: FileText },
  { key: "portail", title: "Portail citoyen", description: "Formulaires intégrables sur votre site web", icon: Globe },
  { key: "ia", title: "Consommation IA", description: "Suivi de la consommation des appels IA (lecture seule)", icon: Sparkles },
];

const syncCounterLabels = [
  { key: "organizations", label: "Organisations" },
  { key: "categories", label: "Catégories" },
  { key: "document_types", label: "Types de documents" },
  { key: "procedures", label: "Démarches" },
] as const;

function syncSummaryMessage(result: SocleSyncResult): string {
  const counters = result.results?.[0]?.counters;
  if (!counters) return result.message;
  const parts = syncCounterLabels.map(({ key, label }) => {
    const c = counters[key];
    return `${label} : ${c.created + c.updated + c.adopted + c.obsoleted}`;
  });
  return `Éléments modifiés — ${parts.join(", ")}.`;
}

const sectionLabels: Record<string, string> = {
  organisations: "Organisations (référentiel)",
  utilisateurs: "Utilisateurs et rôles",
  signatures: "Signatures et tampons",
  emails: "Emails — réception IMAP",
  workflows: "Workflows",
  demarches: "Démarches administratives",
  classification: "Classification (tags)",
  modeles: "Modèles de documents",
  portail: "Portail citoyen — formulaires",
  ia: "Consommation IA",
};

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>("menu");
  const { organizationId } = useOrganization();
  const { profile, membership } = useAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = profile?.is_superadmin === true;
  const isOrgAdmin = membership?.role === "admin" || membership?.role === "administrateur";
  const isAllowed = isSuperAdmin || isOrgAdmin;

  const socleSyncMutation = useMutation({
    mutationFn: () => triggerSocleSync(organizationId!),
    onSuccess: (result) => {
      const orgResult = result.results?.[0];
      if (orgResult?.status === "error") {
        toast.error("Échec de la synchronisation du référentiel : " + (orgResult.error ?? "erreur inconnue"));
        return;
      }
      toast.success("Synchronisation du référentiel terminée", {
        description: syncSummaryMessage(result),
      });
      // Rafraîchit toutes les données miroir du Socle (préfixes, toutes orgs confondues).
      for (const key of ["socle-organizations", "socle-orgs-config", "socle-categories", "socle-last-sync", "procedures", "procedures-displayed"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error("Échec de la synchronisation du référentiel : " + e.message),
  });

  if (!isAllowed) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
            <p className="text-muted-foreground">Configuration générale de l'application</p>
          </div>
        </div>
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
              <ShieldAlert className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-base">Accès réservé</CardTitle>
              <CardDescription>
                Seuls les administrateurs de l'organisation et les superadministrateurs peuvent accéder aux paramètres. Contactez votre administrateur si vous avez besoin de modifier la configuration.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (activeSection !== "menu") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Retour au menu" onClick={() => setActiveSection("menu")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
            <p className="text-muted-foreground">{sectionLabels[activeSection]}</p>
          </div>
        </div>
        {activeSection === "organisations" && organizationId && (
          <SocleOrganizationTree orgId={organizationId} />
        )}
        {activeSection === "utilisateurs" && <UsersPage />}
        {activeSection === "emails" && organizationId && (
          <ImapSettings orgId={organizationId} />
        )}
        {activeSection === "workflows" && <Workflows />}
        {activeSection === "classification" && <ClassificationSettings />}
        {activeSection === "demarches" && <ProceduresSettings />}
        {activeSection === "signatures" && <SignaturesSettings />}
        {activeSection === "modeles" && organizationId && (
          <ModeleSettings orgId={organizationId} />
        )}
        {activeSection === "portail" && <PortalFormsSettings />}
        {activeSection === "ia" && organizationId && (
          <AiUsageSettings organizationId={organizationId} editable={false} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
            <p className="text-muted-foreground">Configuration générale de l'application</p>
          </div>
        </div>
        {organizationId && (
          <Button
            onClick={() => socleSyncMutation.mutate()}
            disabled={socleSyncMutation.isPending}
            variant="outline"
            className="gap-2 shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${socleSyncMutation.isPending ? "animate-spin" : ""}`} />
            {socleSyncMutation.isPending ? "Synchronisation en cours…" : "Synchronisation du référentiel"}
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {settingSections.map((section) => (
          <Card
            key={section.key}
            className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
            onClick={() => setActiveSection(section.key)}
          >
            <CardHeader className="flex flex-row items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <section.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
