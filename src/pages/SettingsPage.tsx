import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, ArrowLeft, GitBranch, Settings, Tags, Briefcase, LucideIcon } from "lucide-react";
import UsersPage from "./UsersPage";
import Workflows from "./Workflows";
import ClassificationSettings from "./ClassificationSettings";
import ServicesSettings from "./ServicesSettings";

type Section = "menu" | "utilisateurs" | "workflows" | "classification" | "services";

const settingSections: { key: Section; title: string; description: string; icon: LucideIcon }[] = [
  { key: "utilisateurs", title: "Utilisateurs", description: "Gestion des membres et rôles", icon: Users },
  { key: "workflows", title: "Workflows", description: "Processus de traitement du courrier", icon: GitBranch },
  { key: "services", title: "Services", description: "Services de l'organisation et workflows associés", icon: Briefcase },
  { key: "classification", title: "Classification", description: "Tags de classement des courriers", icon: Tags },
];

const sectionLabels: Record<string, string> = {
  utilisateurs: "Utilisateurs et rôles",
  workflows: "Workflows",
  services: "Services",
  classification: "Classification (tags)",
};

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>("menu");

  if (activeSection !== "menu") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setActiveSection("menu")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
            <p className="text-muted-foreground">{sectionLabels[activeSection]}</p>
          </div>
        </div>
        {activeSection === "utilisateurs" && <UsersPage />}
        {activeSection === "workflows" && <Workflows />}
        {activeSection === "classification" && <ClassificationSettings />}
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
