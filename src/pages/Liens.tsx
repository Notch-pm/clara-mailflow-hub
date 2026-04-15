import { Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Liens() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link2 className="h-6 w-6 text-secondary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Liens externes</h1>
          <p className="text-muted-foreground">Liaison des courriers avec des tickets et systèmes externes</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tickets liés</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Aucun lien pour le moment. Connectez la base de données pour commencer.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
