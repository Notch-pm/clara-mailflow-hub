import { useState } from "react";
import { FileText, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { EmailTemplate } from "@/lib/email-templates";

interface Props {
  /** Modèles proposés dans l'organisation émettrice (déjà filtrés). */
  templates: EmailTemplate[];
  /** L'éditeur contient déjà du texte : on demande avant de le remplacer. */
  hasContent: boolean;
  disabled?: boolean;
  onApply: (template: EmailTemplate) => void;
}

/**
 * « Partir d'un modèle » : choisir un modèle de courriel du référentiel, dont l'objet et le
 * texte (variables fusionnées) remplacent ceux de l'éditeur. Rien ne part : l'agent relit,
 * complète et suit le circuit habituel (visa, signature, envoi).
 */
export function EmailTemplatePicker({ templates, hasContent, disabled, onApply }: Props) {
  const [pending, setPending] = useState<EmailTemplate | null>(null);
  // Le select revient à vide après chaque choix : on peut reprendre le même modèle.
  const [selectKey, setSelectKey] = useState(0);

  function pick(id: string) {
    const template = templates.find((t) => t.id === id);
    setSelectKey((k) => k + 1);
    if (!template) return;
    if (hasContent) setPending(template);
    else onApply(template);
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="shrink-0 text-sm font-medium text-muted-foreground">Modèle</span>
      <Select key={selectKey} onValueChange={pick} disabled={disabled}>
        <SelectTrigger className="h-9 w-full text-sm sm:w-[320px]" aria-label="Partir d'un modèle de courriel">
          <FileText className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <SelectValue placeholder="Partir d'un modèle…" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Modèles de courriels</SelectLabel>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remplacer le texte en cours ?</AlertDialogTitle>
            <AlertDialogDescription>
              L'objet et le texte du modèle « {pending?.name} » remplaceront ceux que vous avez
              saisis.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) onApply(pending);
                setPending(null);
              }}
            >
              Remplacer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Les variables restées vides après fusion : à compléter à la main avant l'envoi. */
export function MissingVariablesNotice({
  templateName,
  missing,
  onDismiss,
}: {
  templateName: string;
  missing: string[];
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs"
    >
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      <p className="flex-1">
        Modèle « {templateName} » : sans valeur pour ce courrier, laissées vides —{" "}
        {missing.map((k) => `{{${k}}}`).join(", ")}. Relisez et complétez le texte à la main.
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0"
        aria-label="Masquer l'avertissement"
        onClick={onDismiss}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
