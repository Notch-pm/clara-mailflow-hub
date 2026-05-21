import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Upload, Trash2, Pencil, Loader2, ImageIcon, User, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getOrgMembers } from "@/services/userService";
import {
  listSignatories,
  createExternalSignatory,
  updateSignatory,
  deleteSignatory,
  uploadSignatureImage,
  removeSignatureImage,
  getOrCreateSignatoryForUser,
  getSignatureUrl,
  type Signatory,
} from "@/services/signatoryService";
import type { OrgMember } from "@/types/user";

interface Row {
  key: string;
  kind: "user" | "external";
  signatory: Signatory | null;
  member: OrgMember | null;
  first_name: string;
  last_name: string;
  title: string | null;
  signature_storage_key: string | null;
}

const externalSchema = z.object({
  first_name: z.string().min(1, "Prénom obligatoire").max(100),
  last_name: z.string().min(1, "Nom obligatoire").max(100),
  title: z.string().max(150, "150 caractères maximum").optional().or(z.literal("")),
});

const editSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  title: z.string().max(150).optional().or(z.literal("")),
});

function SignaturePreview({ storageKey }: { storageKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSignatureUrl(storageKey).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [storageKey]);
  if (!url) {
    return (
      <div className="h-12 w-28 rounded border bg-muted flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="Signature"
      className="h-12 w-28 object-contain rounded border bg-white"
    />
  );
}

export default function SignaturesSettings() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const { data: members } = useQuery({
    queryKey: ["org-members", organizationId],
    queryFn: () => (organizationId ? getOrgMembers(organizationId) : []),
    enabled: !!organizationId,
  });

  const { data: signatories, isLoading } = useQuery({
    queryKey: ["signatories", organizationId],
    queryFn: () => (organizationId ? listSignatories(organizationId) : []),
    enabled: !!organizationId,
  });

  const rows: Row[] = useMemo(() => {
    if (!members || !signatories) return [];
    const sigByUser = new Map<string, Signatory>();
    const externals: Signatory[] = [];
    for (const s of signatories) {
      if (s.user_id) sigByUser.set(s.user_id, s);
      else externals.push(s);
    }
    const userRows: Row[] = members
      .filter((m) => m.is_signataire)
      .map((m) => {
        const s = sigByUser.get(m.id) ?? null;
        return {
          key: `u-${m.id}`,
          kind: "user" as const,
          signatory: s,
          member: m,
          first_name: m.first_name ?? "",
          last_name: m.last_name ?? "",
          title: s?.title ?? m.signataire_title ?? null,
          signature_storage_key: s?.signature_storage_key ?? null,
        };
      });
    const externalRows: Row[] = externals.map((s) => ({
      key: `e-${s.id}`,
      kind: "external",
      signatory: s,
      member: null,
      first_name: s.first_name,
      last_name: s.last_name,
      title: s.title,
      signature_storage_key: s.signature_storage_key,
    }));
    return [...userRows, ...externalRows].sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`),
    );
  }, [members, signatories]);

  const createForm = useForm<z.infer<typeof externalSchema>>({
    resolver: zodResolver(externalSchema),
    defaultValues: { first_name: "", last_name: "", title: "" },
  });

  const editForm = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: editing
      ? { first_name: editing.first_name, last_name: editing.last_name, title: editing.title ?? "" }
      : { first_name: "", last_name: "", title: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (v: z.infer<typeof externalSchema>) => {
      if (!organizationId) throw new Error("Organisation non sélectionnée");
      await createExternalSignatory(organizationId, {
        first_name: v.first_name,
        last_name: v.last_name,
        title: v.title?.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signatories"] });
      toast.success("Signataire ajouté");
      createForm.reset();
      setCreateOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editMutation = useMutation({
    mutationFn: async (v: z.infer<typeof editSchema>) => {
      if (!editing?.signatory) throw new Error("Aucun signataire");
      await updateSignatory(editing.signatory.id, {
        first_name: v.first_name,
        last_name: v.last_name,
        title: v.title?.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signatories"] });
      toast.success("Modifié");
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => deleteSignatory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signatories"] });
      toast.success("Signataire supprimé");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ row, file }: { row: Row; file: File }) => {
      if (!organizationId) throw new Error("Organisation non sélectionnée");
      let signatoryId = row.signatory?.id;
      if (!signatoryId) {
        if (row.kind !== "user" || !row.member) throw new Error("Signataire introuvable");
        const created = await getOrCreateSignatoryForUser(organizationId, {
          id: row.member.id,
          first_name: row.member.first_name,
          last_name: row.member.last_name,
          signataire_title: row.member.signataire_title,
        });
        signatoryId = created.id;
      }
      await uploadSignatureImage(organizationId, signatoryId, file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signatories"] });
      toast.success("Signature mise à jour");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeSigMutation = useMutation({
    mutationFn: async (signatoryId: string) => removeSignatureImage(signatoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signatories"] });
      toast.success("Signature supprimée");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleFile(row: Row, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("L'image ne doit pas dépasser 5 Mo");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Format d'image non supporté");
      return;
    }
    uploadMutation.mutate({ row, file });
    e.target.value = "";
  }

  if (!organizationId) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">Sélectionnez une organisation.</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Signataires de l'organisation et signatures manuscrites associées.
          Les utilisateurs marqués comme signataires apparaissent automatiquement.
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5"><UserPlus className="h-4 w-4" /> Signataire externe</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Ajouter un signataire externe</DialogTitle></DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={createForm.control} name="first_name" render={({ field }) => (
                    <FormItem><FormLabel>Prénom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={createForm.control} name="last_name" render={({ field }) => (
                    <FormItem><FormLabel>Nom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={createForm.control} name="title" render={({ field }) => (
                  <FormItem><FormLabel>Titre (optionnel)</FormLabel><FormControl><Input placeholder="ex. Maire, Directeur général…" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <p className="text-xs text-muted-foreground">
                  La signature manuscrite pourra être ajoutée juste après création.
                </p>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Ajout…" : "Ajouter le signataire"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent></Card>
      ) : !rows.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">
          Aucun signataire. Activez la capacité « signataire » sur un utilisateur ou ajoutez un signataire externe.
        </CardContent></Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Titre</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Signature manuscrite</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">
                    {[row.first_name, row.last_name].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.title || "—"}
                  </TableCell>
                  <TableCell>
                    {row.kind === "user" ? (
                      <Badge variant="secondary" className="gap-1"><User className="h-3 w-3" /> Utilisateur</Badge>
                    ) : (
                      <Badge variant="outline">Externe</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.signature_storage_key ? (
                      <SignaturePreview storageKey={row.signature_storage_key} />
                    ) : (
                      <div className="h-12 w-28 rounded border border-dashed flex items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-4 w-4" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <input
                        ref={(el) => (fileInputRefs.current[row.key] = el)}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleFile(row, e)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={row.signature_storage_key ? "Remplacer la signature" : "Ajouter une signature"}
                        aria-label={row.signature_storage_key ? "Remplacer la signature" : "Ajouter une signature"}
                        onClick={() => fileInputRefs.current[row.key]?.click()}
                        disabled={uploadMutation.isPending}
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </Button>
                      {row.signature_storage_key && row.signatory && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title="Supprimer la signature"
                          aria-label="Supprimer la signature"
                          onClick={() => removeSigMutation.mutate(row.signatory!.id)}
                        >
                          <ImageIcon className="h-3.5 w-3.5 line-through" />
                        </Button>
                      )}
                      {row.kind === "external" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Modifier"
                            aria-label="Modifier le signataire"
                            onClick={() => setEditing(row)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Supprimer le signataire"
                                aria-label="Supprimer le signataire"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Supprimer ce signataire ?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  La signature associée sera également supprimée. Action irréversible.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Annuler</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => row.signatory && deleteMutation.mutate(row.signatory.id)}
                                >
                                  Supprimer
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Modifier le signataire</DialogTitle></DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((v) => editMutation.mutate(v))} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="first_name" render={({ field }) => (
                  <FormItem><FormLabel>Prénom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={editForm.control} name="last_name" render={({ field }) => (
                  <FormItem><FormLabel>Nom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={editForm.control} name="title" render={({ field }) => (
                <FormItem><FormLabel>Titre</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={editMutation.isPending}>
                {editMutation.isPending ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
