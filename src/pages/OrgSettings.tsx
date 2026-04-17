import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users as UsersIcon, Mail, Plug, Tags, Briefcase, ClipboardList, LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import UsersPage from "./UsersPage";
import SmtpSettings from "@/components/SmtpSettings";
import ImapSettings from "@/components/ImapSettings";
import OrgIntegrations from "@/components/OrgIntegrations";
import ClassificationSettings from "./ClassificationSettings";
import ServicesSettings from "./ServicesSettings";
import ProceduresSettings from "./ProceduresSettings";

type Section = "menu" | "utilisateurs" | "smtp" | "integrations" | "classification" | "services" | "demarches";

const settingSections: { key: Section; title: string; description: string; icon: LucideIcon }[] = [
  { key: "utilisateurs", title: "Utilisateurs", description: "Gestion des utilisateurs et rôles", icon: UsersIcon },
  { key: "smtp", title: "Emails (SMTP / IMAP)", description: "Envoi de notifications et réception automatique des courriers", icon: Mail },
  { key: "integrations", title: "Intégrations", description: "Connexions aux partenaires externes (Arpège…)", icon: Plug },
  { key: "services", title: "Services", description: "Services de l'organisation et workflows associés", icon: Briefcase },
  { key: "demarches", title: "Démarches", description: "Liste des démarches administratives (sync Arpège possible)", icon: ClipboardList },
  { key: "classification", title: "Classification", description: "Tags de classement des courriers", icon: Tags },
];

const sectionLabels: Record<string, string> = {
  utilisateurs: "Utilisateurs et rôles",
  smtp: "Emails — SMTP (envoi) & IMAP (réception)",
  integrations: "Intégrations externes",
  services: "Services",
  demarches: "Démarches administratives",
  classification: "Classification (tags)",
};

export default function OrgSettings() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>("menu");

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
          <Button variant="ghost" size="icon" onClick={() => setActiveSection("menu")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{org?.name} — Paramètres</h1>
            <p className="text-muted-foreground">{sectionLabels[activeSection]}</p>
          </div>
        </div>
        {activeSection === "utilisateurs" && <UsersPage organizationId={orgId!} />}
        {activeSection === "smtp" && <SmtpSettings orgId={orgId!} />}
        {activeSection === "integrations" && <OrgIntegrations orgId={orgId!} />}
        {activeSection === "classification" && (
          <ClassificationSettings organizationId={orgId!} isAdminOverride />
        )}
        {activeSection === "services" && (
          <ServicesSettings organizationId={orgId!} isAdminOverride />
        )}
        {activeSection === "demarches" && (
          <ProceduresSettings organizationId={orgId!} isAdminOverride />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/superadmin/organisations")}>
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
      </div>
    </div>
  );
}
