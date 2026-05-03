import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Loader2, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { getOrgHtmlTemplate, saveOrgHtmlTemplate, removeOrgHtmlTemplate } from "@/services/templateService";
import TemplateEditor from "@/components/template/TemplateEditor";

interface Props {
  orgId: string;
}

export default function ModeleSettings({ orgId }: Props) {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data: templateData, isLoading } = useQuery({
    queryKey: ["org-html-template", orgId],
    queryFn: () => getOrgHtmlTemplate(orgId),
    enabled: !!orgId,
  });

  const hasTemplate = !!templateData?.html;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["org-html-template", orgId] });
  };

  const save = useMutation({
    mutationFn: ({ html, design }: { html: string; design: object }) =>
      saveOrgHtmlTemplate(orgId, html, design),
    onSuccess: () => {
      invalidate();
      setEditorOpen(false);
      toast.success("Modèle enregistré");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => removeOrgHtmlTemplate(orgId),
    onSuccess: () => {
      invalidate();
      setConfirmRemove(false);
      toast.success("Modèle supprimé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Modèle de document</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Créez ou modifiez le modèle visuel utilisé lors de l'export PDF des réponses courrier.
          Positionnez les variables <code className="text-xs">{"{{contenu}}"}</code>,{" "}
          <code className="text-xs">{"{{date}}"}</code>, etc. dans le modèle.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : hasTemplate ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <LayoutTemplate className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm font-medium">Modèle HTML configuré</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditorOpen(true)}
                >
                  <Pencil className="h-4 w-4 mr-1.5" />
                  Modifier
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={remove.isPending}
                  className="text-destructive border-destructive/40 hover:bg-destructive/5"
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground italic">Aucun modèle configuré</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditorOpen(true)}
              >
                <LayoutTemplate className="h-4 w-4 mr-1.5" />
                Créer un modèle
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 overflow-hidden">
          <TemplateEditor
            initialDesign={templateData?.design}
            isSaving={save.isPending}
            onSave={(html, design) => save.mutate({ html, design })}
            onClose={() => setEditorOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le modèle ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le modèle sera supprimé définitivement. Les exports PDF utiliseront la mise en page standard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
