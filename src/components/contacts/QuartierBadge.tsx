import { Badge } from "@/components/ui/badge";
import { readableTextColor } from "@/lib/tag-color";
import type { SocleContactQuartier } from "@/services/socleContactService";

/**
 * Quartier de rattachement d'un contact, tel que résolu par le référentiel.
 *
 * Le rattachement est calculé en amont (géocodage de l'adresse puis
 * point-dans-polygone) : Clara ne fait que l'afficher, il n'est ni saisi ni
 * modifiable ici. Une adresse hors du découpage — ou non géolocalisable —
 * n'a pas de quartier, d'où le rendu neutre plutôt qu'une pastille vide.
 */
export function QuartierBadge({ quartier }: { quartier: SocleContactQuartier | null | undefined }) {
  if (!quartier) return <span className="text-sm text-muted-foreground">—</span>;
  // Couleur libre venue du référentiel : hors palette de tokens, donc appliquée
  // en style inline, avec un texte dont le contraste est calculé (même motif
  // que les tags de courrier).
  const style = quartier.color
    ? { backgroundColor: quartier.color, color: readableTextColor(quartier.color), borderColor: "transparent" }
    : undefined;
  return (
    <Badge variant={quartier.color ? "default" : "outline"} style={style}>
      {quartier.name}
    </Badge>
  );
}
