import { GitBranch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Workflows() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <GitBranch className="h-6 w-6 text-success" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground">Visualisation et gestion des processus de traitement</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Workflows configurés</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Aucun workflow pour le moment. Connectez la base de données pour commencer.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
