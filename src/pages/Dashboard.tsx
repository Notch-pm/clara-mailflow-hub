import { MailOpen, Send, Link2, GitBranch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";

const stats = [
  { label: "Courriers entrants", value: "—", icon: MailOpen, href: "/courriers-entrants", color: "text-primary" },
  { label: "Courriers sortants", value: "—", icon: Send, href: "/courriers-sortants", color: "text-warning" },
  { label: "Liens externes", value: "—", icon: Link2, href: "/liens", color: "text-secondary" },
  { label: "Workflows actifs", value: "—", icon: GitBranch, href: "/workflows", color: "text-success" },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-muted-foreground">Vue d'ensemble de votre gestion du courrier</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} to={stat.href}>
            <Card className="hover:shadow-airbnb transition-shadow cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Courriers récents</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connectez Lovable Cloud pour afficher les données en temps réel.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
