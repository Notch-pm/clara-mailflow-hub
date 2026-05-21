import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Search, UserCog, UserX, UserCheck, Pencil, KeyRound, Loader2 } from "lucide-react";
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
import { getOrgMembers, createOrgMember, deactivateOrgMember, reactivateOrgMember, sendPasswordReset } from "@/services/userService";
import { UserAvatar } from "@/components/UserAvatar";
import { EditUserDialog } from "@/components/EditUserDialog";
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

  const reactivateMutation = useMutation({
    mutationFn: async (member: OrgMember) => {
      if (!organizationId) throw new Error("Organisation non sélectionnée");
      await reactivateOrgMember(organizationId, member.id, member.membership_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
      toast.success("Utilisateur réactivé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (member: OrgMember) => {
      await sendPasswordReset(member.id);
    },
    onSuccess: () => {
      toast.success("E-mail de réinitialisation envoyé");
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
                <p className="text-xs text-muted-foreground">
                  La photo de profil pourra être ajoutée après création depuis le bouton "Modifier".
                </p>
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
                <TableHead className="w-[60px]"></TableHead>
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
                  <TableCell>
                    <UserAvatar
                      firstName={m.first_name}
                      lastName={m.last_name}
                      email={m.email}
                      avatarUrl={m.avatar_url}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {[m.first_name, m.last_name].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm">{m.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant={roleBadgeVariant[m.role] ?? "outline"}>{m.role}</Badge>
                      {m.is_signataire && (
                        <Badge variant="outline" className="border-primary/40 text-primary">
                          Signataire
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.is_active !== false ? "default" : "secondary"}>
                      {m.is_active !== false ? "Actif" : "Inactif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditMember(m)} title="Modifier" aria-label="Modifier l'utilisateur">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => resetPasswordMutation.mutate(m)}
                        disabled={resetPasswordMutation.isPending}
                        title="Envoyer un e-mail de réinitialisation"
                        aria-label="Envoyer un e-mail de réinitialisation"
                      >
                        {resetPasswordMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <KeyRound className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {m.is_active !== false ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Désactiver" aria-label="Désactiver l'utilisateur">
                              <UserX className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Désactiver cet utilisateur ?</AlertDialogTitle>
                              <AlertDialogDescription>
                                L'utilisateur {m.email} ne pourra plus se connecter. Cette action est réversible.
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
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-green-600 hover:text-green-700"
                          onClick={() => reactivateMutation.mutate(m)}
                          disabled={reactivateMutation.isPending}
                          title="Réactiver"
                          aria-label="Réactiver l'utilisateur"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <EditUserDialog
        member={editMember}
        organizationId={organizationId ?? ""}
        onClose={() => setEditMember(null)}
      />
    </div>
  );
}
