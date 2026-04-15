import { Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CourriersSortants() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Send className="h-6 w-6 text-warning" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Courriers sortants</h1>
          <p className="text-muted-foreground">Gestion et suivi des courriers envoyés</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Liste des courriers sortants</CardTitle>
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
