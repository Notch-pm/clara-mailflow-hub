import { MailOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CourriersEntrants() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <MailOpen className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Courriers entrants</h1>
          <p className="text-muted-foreground">Gestion et suivi des courriers reçus</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Liste des courriers entrants</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Aucun courrier pour le moment. Connectez la base de données pour commencer.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
