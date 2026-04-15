import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, FileText, Trash2, FileUp, Paperclip, FileOutput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { getDocuments, addDocument, removeDocument } from "@/services/courierDocumentService";
import type { CourierDocument } from "@/types/courier";

const DOC_TYPES = [
  { value: "original", label: "Original" },
  { value: "response", label: "Réponse" },
  { value: "attachment", label: "Pièce jointe" },
] as const;

const docTypeIcon: Record<string, React.ReactNode> = {
  original: <FileText className="h-4 w-4" />,
  response: <FileOutput className="h-4 w-4" />,
  attachment: <Paperclip className="h-4 w-4" />,
};

const docTypeBadge: Record<string, "default" | "secondary" | "outline"> = {
  original: "default",
  response: "secondary",
  attachment: "outline",
};

const docTypeLabel: Record<string, string> = {
  original: "Original",
  response: "Réponse",
  attachment: "Pièce jointe",
};

const documentSchema = z.object({
  storage_key: z.string().min(1, "Clé de stockage obligatoire").max(500),
  document_type: z.enum(["original", "response", "attachment"], { required_error: "Type obligatoire" }),
  file_name: z.string().max(255).optional(),
  mime_type: z.string().max(100).optional(),
  file_size: z.coerce.number().int().nonnegative().optional(),
});

type DocumentFormValues = z.infer<typeof documentSchema>;

interface DocumentManagerProps {
  courierId: string;
  organizationId: string;
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function DocumentManager({ courierId, organizationId }: DocumentManagerProps) {
  const queryClient = useQueryClient();
  const queryKey = ["courier-documents", courierId];
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(documentSchema),
    defaultValues: { storage_key: "", document_type: "attachment", file_name: "", mime_type: "", file_size: undefined },
  });

  const { data: documents = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getDocuments(courierId),
    enabled: !!courierId,
  });

  const resetAndClose = () => {
    setDialogOpen(false);
    form.reset({ storage_key: "", document_type: "attachment", file_name: "", mime_type: "", file_size: undefined });
  };

  const addMutation = useMutation({
    mutationFn: (values: DocumentFormValues) =>
      addDocument({
        courier_id: courierId,
        organization_id: organizationId,
        storage_key: values.storage_key,
        document_type: values.document_type,
        file_name: values.file_name || null,
        mime_type: values.mime_type || null,
        file_size: values.file_size ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      toast.success("Document ajouté");
      resetAndClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      toast.success("Document supprimé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {documents.length} document{documents.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <FileUp className="h-4 w-4" /> Ajouter
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Chargement…</p>
      ) : !documents.length ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-3">Aucun document.</p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Ajouter le premier document
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Clé de stockage</TableHead>
              <TableHead>Taille</TableHead>
              <TableHead className="w-[60px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <Badge variant={docTypeBadge[d.document_type] ?? "outline"} className="gap-1">
                    {docTypeIcon[d.document_type]}
                    {docTypeLabel[d.document_type] ?? d.document_type}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{d.file_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs max-w-[200px] truncate">{d.storage_key}</TableCell>
                <TableCell className="text-sm">{formatFileSize(d.file_size)}</TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          La référence au document « {d.file_name ?? d.storage_key} » sera supprimée. Le fichier externe n'est pas affecté.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(d.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Supprimer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add document dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && resetAndClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter un document</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => addMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="document_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type de document</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="storage_key" render={({ field }) => (
                <FormItem>
                  <FormLabel>Clé de stockage</FormLabel>
                  <FormControl><Input placeholder="ex: documents/2026/courrier-abc.pdf" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="file_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom du fichier</FormLabel>
                    <FormControl><Input placeholder="rapport.pdf" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="mime_type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type MIME</FormLabel>
                    <FormControl><Input placeholder="application/pdf" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="file_size" render={({ field }) => (
                <FormItem>
                  <FormLabel>Taille (octets)</FormLabel>
                  <FormControl><Input type="number" placeholder="1024" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={addMutation.isPending}>
                {addMutation.isPending ? "Ajout…" : "Ajouter le document"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
