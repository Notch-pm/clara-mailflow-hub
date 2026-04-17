import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Building2, HeartHandshake, Plus, Search, Trash2, User, UserCircle2 } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  listUsagers,
  getUsager,
  createUsager,
  updateUsager,
  deleteUsager,
  listUsagerCouriers,
  type Usager,
  type UsagerCategory,
} from "@/services/usagerService";

const categoryLabels: Record<UsagerCategory, string> = {
  citoyen: "Citoyen",
  entreprise: "Entreprise",
  association: "Association",
};

const categoryIcons: Record<UsagerCategory, typeof User> = {
  citoyen: User,
  entreprise: Building2,
  association: HeartHandshake,
};

const schema = z
  .object({
    category: z.enum(["citoyen", "entreprise", "association"]),
    civilite: z.enum(["madame", "monsieur"]).optional().nullable(),
    first_name: z.string().trim().max(200).optional(),
    last_name: z.string().trim().min(1, "Nom obligatoire").max(200),
    email: z.string().trim().email("Email invalide").max(255).or(z.literal("")).optional(),
    phone: z.string().trim().max(50).optional(),
  })
  .refine(
    (v) =>
      v.category !== "citoyen" || (v.civilite === "madame" || v.civilite === "monsieur"),
    { message: "Civilité obligatoire pour un citoyen", path: ["civilite"] },
  )
  .refine(
    (v) => v.category !== "citoyen" || (v.first_name && v.first_name.trim().length > 0),
    { message: "Prénom obligatoire pour un citoyen", path: ["first_name"] },
  );

type FormValues = z.infer<typeof schema>;

function fullName(u: Pick<Usager, "first_name" | "last_name">) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || "—";
}

function UsagerFormDialog({
  open,
  onOpenChange,
  organizationId,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
  editing: Usager | null;
}) {
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      category: (editing?.category as UsagerCategory) ?? "citoyen",
      civilite: editing?.civilite ?? null,
      first_name: editing?.first_name ?? "",
      last_name: editing?.last_name ?? "",
      email: editing?.email ?? "",
      phone: editing?.phone ?? "",
    },
  });

  const category = form.watch("category");

  const mut = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload = {
        category: v.category,
        civilite: v.category === "citoyen" ? v.civilite ?? null : null,
        first_name: v.first_name || null,
        last_name: v.last_name || null,
        email: v.email || null,
        phone: v.phone || null,
      };
      if (editing) return updateUsager(editing.id, payload);
      return createUsager(organizationId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["usagers"] });
      qc.invalidateQueries({ queryKey: ["usager"] });
      toast.success(editing ? "Usager mis à jour" : "Usager créé");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier l'usager" : "Nouvel usager"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nature *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="citoyen">Citoyen</SelectItem>
                      <SelectItem value="entreprise">Entreprise</SelectItem>
                      <SelectItem value="association">Association</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {category === "citoyen" && (
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="civilite"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Civilité *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value ?? undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="madame">Madame</SelectItem>
                          <SelectItem value="monsieur">Monsieur</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prénom *</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="last_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{category === "citoyen" ? "Nom *" : "Raison sociale *"}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Téléphone</FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" className="w-full" disabled={mut.isPending}>
              {mut.isPending ? "Enregistrement…" : editing ? "Enregistrer" : "Créer"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function UsagerDetail({ usagerId, organizationId, onBack }: { usagerId: string; organizationId: string; onBack: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: usager, isLoading } = useQuery({
    queryKey: ["usager", usagerId],
    queryFn: () => getUsager(usagerId),
    enabled: !!usagerId,
  });

  const { data: couriers = [] } = useQuery({
    queryKey: ["usager-couriers", usagerId],
    queryFn: () => listUsagerCouriers(usagerId),
    enabled: !!usagerId,
  });

  const delMut = useMutation({
    mutationFn: () => deleteUsager(usagerId),
    onSuccess: () => {
      toast.success("Usager supprimé");
      qc.invalidateQueries({ queryKey: ["usagers"] });
      onBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !usager) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
      </Card>
    );
  }

  const Icon = categoryIcons[usager.category];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <Icon className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{fullName(usager)}</h1>
            <p className="text-muted-foreground text-sm">
              <Badge variant="secondary" className="mr-2">{categoryLabels[usager.category]}</Badge>
              {usager.email ?? "—"} {usager.phone ? `· ${usager.phone}` : ""}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)}>Modifier</Button>
        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setConfirmDelete(true)} aria-label="Supprimer">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-sm font-semibold mb-3">Courriers liés ({couriers.length})</h2>
          {!couriers.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Aucun courrier lié à cet usager.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Chrono</TableHead>
                  <TableHead>Sens</TableHead>
                  <TableHead>Objet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {couriers.map((c: any) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/courrier/${c.id}`)}
                  >
                    <TableCell className="text-sm">
                      {(() => {
                        const d = c.received_at ?? c.sent_at ?? c.created_at;
                        return d ? new Date(d).toLocaleDateString("fr-FR") : "—";
                      })()}
                    </TableCell>
                    <TableCell className="text-sm">{c.chrono ?? "—"}</TableCell>
                    <TableCell className="text-sm capitalize">{c.direction}</TableCell>
                    <TableCell className="text-sm font-medium">{c.subject ?? "(sans objet)"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UsagerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        organizationId={organizationId}
        editing={usager}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet usager ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les courriers liés ne seront pas supprimés mais perdront le rattachement à cet usager.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => delMut.mutate()}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Usagers() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: usagers = [], isLoading } = useQuery({
    queryKey: ["usagers", organizationId, search],
    queryFn: () => listUsagers(organizationId!, search),
    enabled: !!organizationId,
  });

  if (params.id && organizationId) {
    return (
      <UsagerDetail
        usagerId={params.id}
        organizationId={organizationId}
        onBack={() => navigate("/usagers")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserCircle2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usagers</h1>
          <p className="text-muted-foreground">Personnes, entreprises et associations en relation avec votre organisation.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 justify-between flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {organizationId && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Nouvel usager
          </Button>
        )}
      </div>

      {!organizationId ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Sélectionnez une organisation.</CardContent></Card>
      ) : isLoading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent></Card>
      ) : !usagers.length ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Aucun usager pour le moment.</CardContent></Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Nature</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead>Prénom</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Téléphone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usagers.map((u) => {
                const Icon = categoryIcons[u.category];
                return (
                  <TableRow
                    key={u.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/usagers/${u.id}`)}
                  >
                    <TableCell><Icon className="h-4 w-4 text-muted-foreground" /></TableCell>
                    <TableCell>
                      <Badge variant="secondary">{categoryLabels[u.category]}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{u.last_name ?? "—"}</TableCell>
                    <TableCell>{u.category === "citoyen" ? (u.first_name ?? "—") : "—"}</TableCell>
                    <TableCell className="text-sm">{u.email ?? "—"}</TableCell>
                    <TableCell className="text-sm">{u.phone ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {organizationId && (
        <UsagerFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
          editing={null}
        />
      )}
    </div>
  );
}
