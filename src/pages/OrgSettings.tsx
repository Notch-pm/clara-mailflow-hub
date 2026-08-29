import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users as UsersIcon, Mail, Plug, Tags, ClipboardList, GitBranch, Sparkles, Building2, LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import UsersPage from "./UsersPage";
import ImapSettings from "@/components/ImapSettings";
import OrgIntegrations from "@/components/OrgIntegrations";
import ClassificationSettings from "./ClassificationSettings";
import ProceduresSettings from "./ProceduresSettings";
import SocleIntegrationSettings from "@/components/SocleIntegrationSettings";
import SocleOrganizationTree from "@/components/SocleOrganizationTree";
import AiUsageSettings from "@/components/AiUsageSettings";

type Section = "menu" | "utilisateurs" | "emails" | "integrations" | "classification" | "demarches" | "organisations" | "ia";

const settingSections: { key: Section; title: string; description: string; icon: LucideIcon }[] = [
  { key: "organisations", title: "Organisations", description: "Hiérarchie des organisations du référentiel : workflows, boîtes IMAP, membres et signataires par organisation", icon: Building2 },
  { key: "utilisateurs", title: "Utilisateurs", description: "Gestion des utilisateurs et rôles", icon: UsersIcon },
  // Le serveur d'envoi (SMTP) ne se saisit plus ici : il vient du référentiel
  // (organisation racine) et arrive par la synchronisation. Ne reste que la
  // réception.
  { key: "emails", title: "Emails (réception IMAP)", description: "Boîtes de réception automatique des courriers", icon: Mail },
  { key: "integrations", title: "Intégrations", description: "Connexions aux partenaires externes (Arpège…)", icon: Plug },
  { key: "demarches", title: "Démarches", description: "Démarches synchronisées depuis le référentiel central", icon: ClipboardList },
  { key: "classification", title: "Classification", description: "Tags de classement des courriers", icon: Tags },
  { key: "ia", title: "Consommation IA", description: "Plafond et consommation des appels IA (OCR, analyse, brouillons)", icon: Sparkles },
];

const workflowsSection = { title: "Workflows", description: "Workflows de traitement des courriers", icon: GitBranch };

const sectionLabels: Record<string, string> = {
  utilisateurs: "Utilisateurs et rôles",
  emails: "Emails — IMAP (réception)",
  integrations: "Intégrations externes",
  demarches: "Démarches administratives",
  organisations: "Organisations (référentiel)",
  classification: "Classification (tags)",
  ia: "Consommation IA",
};

export default function OrgSettings() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { setOrganizationId } = useOrganization();
  const [activeSection, setActiveSection] = useState<Section>("menu");

  // Injecte l'org de l'URL dans le contexte pour que les pages workflow
  // (qui lisent useOrganization) fonctionnent depuis la vue superadmin.
  // Pas de cleanup : si on navigue vers /workflows, OrgSettings se démonte
  // avant que Workflows monte — un cleanup viderait le contexte trop tôt.
  useEffect(() => {
    if (orgId) setOrganizationId(orgId);
  }, [orgId]);

  const { data: org, isLoading } = useQuery({
    queryKey: ["organization", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").eq("id", orgId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  if (activeSection !== "menu") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Retour au menu" onClick={() => setActiveSection("menu")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{org?.name} — Paramètres</h1>
            <p className="text-muted-foreground">{sectionLabels[activeSection]}</p>
          </div>
        </div>
        {activeSection === "utilisateurs" && <UsersPage organizationId={orgId!} />}
        {activeSection === "emails" && <ImapSettings orgId={orgId!} />}
        {activeSection === "integrations" && <OrgIntegrations orgId={orgId!} />}
        {activeSection === "classification" && (
          <ClassificationSettings organizationId={orgId!} isAdminOverride />
        )}
        {activeSection === "demarches" && (
          <div className="space-y-6">
            <SocleIntegrationSettings orgId={orgId!} />
            <ProceduresSettings organizationId={orgId!} isAdminOverride />
          </div>
        )}
        {activeSection === "organisations" && <SocleOrganizationTree orgId={orgId!} isAdminOverride />}
        {activeSection === "ia" && <AiUsageSettings organizationId={orgId!} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Retour aux organisations" onClick={() => navigate("/superadmin/organisations")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{org?.name}</h1>
          <p className="text-muted-foreground">Configuration de l'organisation</p>
        </div>
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
        <Card
          className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
          onClick={() => navigate("/workflows")}
        >
          <CardHeader className="flex flex-row items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <workflowsSection.icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{workflowsSection.title}</CardTitle>
              <CardDescription>{workflowsSection.description}</CardDescription>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
