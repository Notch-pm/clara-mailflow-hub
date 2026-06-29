import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, ArrowLeft, GitBranch, Settings, Tags, Briefcase, ClipboardList, Mail, PenTool, FileText, Globe, MapPin, Sparkles, LucideIcon } from "lucide-react";
import UsersPage from "./UsersPage";
import Workflows from "./Workflows";
import ClassificationSettings from "./ClassificationSettings";
import ServicesSettings from "./ServicesSettings";
import ProceduresSettings from "./ProceduresSettings";
import SignaturesSettings from "./SignaturesSettings";
import ModeleSettings from "./ModeleSettings";
import QuartiersSettings from "./QuartiersSettings";

import ImapSettings from "@/components/ImapSettings";
import GeneralSettings from "@/components/GeneralSettings";
import PortalFormsSettings from "@/components/portal/PortalFormsSettings";
import AiUsageSettings from "@/components/AiUsageSettings";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldAlert } from "lucide-react";

type Section = "menu" | "general" | "utilisateurs" | "workflows" | "classification" | "services" | "demarches" | "emails" | "signatures" | "modeles" | "portail" | "quartiers" | "ia";

const settingSections: { key: Section; title: string; description: string; icon: LucideIcon }[] = [
  { key: "general", title: "Configuration générale", description: "Paramètres globaux de l'organisation", icon: Settings },
  { key: "utilisateurs", title: "Utilisateurs", description: "Gestion des membres et rôles", icon: Users },
  { key: "signatures", title: "Signatures et tampons", description: "Signataires et signatures manuscrites", icon: PenTool },
  { key: "emails", title: "Emails (IMAP)", description: "Réception automatique des emails comme courriers entrants", icon: Mail },
  { key: "workflows", title: "Workflows", description: "Processus de traitement du courrier", icon: GitBranch },
  { key: "services", title: "Services", description: "Services de l'organisation et workflows associés", icon: Briefcase },
  { key: "demarches", title: "Démarches", description: "Liste des démarches administratives proposées", icon: ClipboardList },
  { key: "classification", title: "Classification", description: "Tags de classement des courriers", icon: Tags },
  { key: "quartiers", title: "Quartiers", description: "Découpage de la commune en quartiers", icon: MapPin },
  { key: "modeles", title: "Modèles de documents", description: "Modèle Word pour les courriers papier", icon: FileText },
  { key: "portail", title: "Portail citoyen", description: "Formulaires intégrables sur votre site web", icon: Globe },
  { key: "ia", title: "Consommation IA", description: "Suivi de la consommation des appels IA (lecture seule)", icon: Sparkles },
];

const sectionLabels: Record<string, string> = {
  general: "Configuration générale",
  utilisateurs: "Utilisateurs et rôles",
  signatures: "Signatures et tampons",
  emails: "Emails — réception IMAP",
  workflows: "Workflows",
  services: "Services",
  demarches: "Démarches administratives",
  classification: "Classification (tags)",
  quartiers: "Quartiers",
  modeles: "Modèles de documents",
  portail: "Portail citoyen — formulaires",
  ia: "Consommation IA",
};

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>("menu");
  const { organizationId } = useOrganization();
  const { profile, membership } = useAuth();
  const isSuperAdmin = profile?.is_superadmin === true;
  const isOrgAdmin = membership?.role === "admin" || membership?.role === "administrateur";
  const isAllowed = isSuperAdmin || isOrgAdmin;

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
        {activeSection === "general" && organizationId && (
          <GeneralSettings orgId={organizationId} />
        )}
        {activeSection === "utilisateurs" && <UsersPage />}
        {activeSection === "emails" && organizationId && (
          <ImapSettings orgId={organizationId} />
        )}
        {activeSection === "workflows" && <Workflows />}
        {activeSection === "classification" && <ClassificationSettings />}
        {activeSection === "quartiers" && <QuartiersSettings />}
        {activeSection === "services" && <ServicesSettings />}
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
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
          <p className="text-muted-foreground">Configuration générale de l'application</p>
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
      </div>
    </div>
  );
}
