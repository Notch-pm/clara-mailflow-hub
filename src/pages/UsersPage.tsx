import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Users, Plus, Search, UserCog, UserX, UserCheck, Pencil, KeyRound, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getOrgMembers, createOrgMember, updateOrgMember, deactivateOrgMember, reactivateOrgMember, sendPasswordReset } from "@/services/userService";
import type { OrgMember } from "@/types/user";

const ROLES = [
  { value: "administrateur", label: "Administrateur" },
  { value: "gestionnaire", label: "Gestionnaire" },
  { value: "consultant", label: "Consultant" },
] as const;

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  administrateur: "default",
  gestionnaire: "secondary",
  consultant: "outline",
};

const createSchema = z.object({
  email: z.string().email("Email invalide").max(255),
  first_name: z.string().min(1, "Prénom obligatoire").max(100),
  last_name: z.string().min(1, "Nom obligatoire").max(100),
  role: z.enum(["administrateur", "gestionnaire", "consultant"], { required_error: "Rôle obligatoire" }),
});

const editSchema = z.object({
  first_name: z.string().min(1, "Prénom obligatoire").max(100),
  last_name: z.string().min(1, "Nom obligatoire").max(100),
  role: z.enum(["administrateur", "gestionnaire", "consultant"], { required_error: "Rôle obligatoire" }),
});

interface UsersPageProps {
  organizationId?: string;
}

export default function UsersPage({ organizationId: propOrgId }: UsersPageProps = {}) {
  const { organizationId: ctxOrgId } = useOrganization();
  const organizationId = propOrgId || ctxOrgId;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editMember, setEditMember] = useState<OrgMember | null>(null);

  const createForm = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: "", first_name: "", last_name: "", role: undefined },
  });

  const editForm = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: editMember
      ? { first_name: editMember.first_name ?? "", last_name: editMember.last_name ?? "", role: editMember.role as any }
      : { first_name: "", last_name: "", role: "consultant" as const },
  });

  const { data: members, isLoading } = useQuery({
    queryKey: ["org-members", organizationId],
    queryFn: () => {
      if (!organizationId) return [];
      return getOrgMembers(organizationId);
    },
    enabled: !!organizationId,
  });

  const filteredMembers = members?.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.email.toLowerCase().includes(q) ||
      (m.first_name?.toLowerCase().includes(q)) ||
      (m.last_name?.toLowerCase().includes(q))
    );
  });

  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof createSchema>) => {
      if (!organizationId) throw new Error("Organisation non sélectionnée");
      await createOrgMember(organizationId, { email: values.email, first_name: values.first_name, last_name: values.last_name }, values.role);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
      toast.success("Utilisateur créé");
      createForm.reset();
      setCreateOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (values: z.infer<typeof editSchema>) => {
      if (!organizationId || !editMember) throw new Error("Contexte manquant");
      await updateOrgMember(organizationId, editMember.id, editMember.membership_id, values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
      toast.success("Utilisateur mis à jour");
      setEditMember(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (member: OrgMember) => {
      if (!organizationId) throw new Error("Organisation non sélectionnée");
      await deactivateOrgMember(organizationId, member.id, member.membership_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
      toast.success("Utilisateur désactivé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCog className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Utilisateurs</h1>
            <p className="text-muted-foreground">Gestion des membres de l'organisation</p>
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5"><Plus className="h-4 w-4" /> Nouvel utilisateur</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Créer un utilisateur</DialogTitle></DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <FormField control={createForm.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="nom@exemple.com" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={createForm.control} name="first_name" render={({ field }) => (
                    <FormItem><FormLabel>Prénom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={createForm.control} name="last_name" render={({ field }) => (
                    <FormItem><FormLabel>Nom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={createForm.control} name="role" render={({ field }) => (
                  <FormItem><FormLabel>Rôle</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Sélectionner un rôle" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Création..." : "Créer l'utilisateur"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {!organizationId ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Sélectionnez une organisation.</CardContent></Card>
      ) : isLoading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent></Card>
      ) : !filteredMembers?.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Aucun utilisateur. Cliquez sur "Nouvel utilisateur".</CardContent></Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMembers.map((m) => (
                <TableRow key={m.membership_id}>
                  <TableCell className="font-medium">
                    {[m.first_name, m.last_name].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm">{m.email}</TableCell>
                  <TableCell>
                    <Badge variant={roleBadgeVariant[m.role] ?? "outline"}>{m.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.is_active !== false ? "default" : "secondary"}>
                      {m.is_active !== false ? "Actif" : "Inactif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditMember(m)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                            <UserX className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Désactiver cet utilisateur ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              L'utilisateur {m.email} sera désactivé (soft delete). Cette action est réversible.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deactivateMutation.mutate(m)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Désactiver
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editMember} onOpenChange={(open) => !open && setEditMember(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Modifier l'utilisateur</DialogTitle></DialogHeader>
          {editMember && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{editMember.email}</p>
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={editForm.control} name="first_name" render={({ field }) => (
                      <FormItem><FormLabel>Prénom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={editForm.control} name="last_name" render={({ field }) => (
                      <FormItem><FormLabel>Nom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={editForm.control} name="role" render={({ field }) => (
                    <FormItem><FormLabel>Rôle</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                  </Button>
                </form>
              </Form>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
