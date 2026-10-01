import { useNavigate } from "react-router-dom";
import { ChevronDown, Files, Info, PencilLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Bouton « Ajouter du courrier » des barres d'outils (courrier entrant, boîte aux lettres) :
 * saisie manuelle ou import en masse, avec le rappel que l'email et la numérisation arrivent seuls.
 */
export default function AddCourierMenu({ onNewCourier }: { onNewCourier: () => void }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-9 gap-1.5 font-bold">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Ajouter du courrier</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-1.5">
        <DropdownMenuItem className="items-start gap-3 py-2.5" onSelect={onNewCourier}>
          <PencilLine className="mt-0.5 h-4 w-4 text-primary" />
          <span className="flex flex-col">
            <span className="font-bold">Saisir un courrier</span>
            <span className="text-[13px] text-muted-foreground">Créer manuellement un courrier reçu</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className="items-start gap-3 py-2.5" onSelect={() => navigate("/import-en-masse")}>
          <Files className="mt-0.5 h-4 w-4 text-primary" />
          <span className="flex flex-col">
            <span className="font-bold">Importer plusieurs courriers</span>
            <span className="text-[13px] text-muted-foreground">Saisie en masse à partir de fichiers</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="flex gap-2 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Les courriers reçus par email et par numérisation arrivent automatiquement.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
