import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailOpen, Plus, Search, Filter } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getCouriers, createCourier } from "@/services/courierService";
import type { CourierChannel } from "@/types/courier";

const createCourierSchema = z.object({
  subject: z.string().min(1, "L'objet est obligatoire").max(500),
  channel: z.enum(["paper", "email", "portal"] as const, { required_error: "Le canal est obligatoire" }),
  received_at: z.string().min(1, "La date de réception est obligatoire"),
});

type CreateCourierForm = z.infer<typeof createCourierSchema>;

const channelLabels: Record<CourierChannel, string> = {
  paper: "Papier",
  email: "Email",
  portal: "Portail",
};

export default function CourriersEntrants() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<CreateCourierForm>({
    resolver: zodResolver(createCourierSchema),
    defaultValues: { subject: "", channel: undefined, received_at: new Date().toISOString().slice(0, 16) },
  });

  const { data: couriers, isLoading } = useQuery({
    queryKey: ["couriers", "inbound", organizationId, search],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await getCouriers(organizationId, {
        direction: "inbound",
        search: search || undefined,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  const createMutation = useMutation({
    mutationFn: async (values: CreateCourierForm) => {
      if (!organizationId) throw new Error("Organisation non sélectionnée");
      const { error } = await createCourier({
        organization_id: organizationId,
        direction: "inbound",
        channel: values.channel,
        subject: values.subject,
        received_at: values.received_at,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["couriers"] });
      toast.success("Courrier créé avec succès");
      form.reset();
      setDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MailOpen className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Courriers entrants</h1>
            <p className="text-muted-foreground">Gestion et suivi des courriers reçus</p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" /> Nouveau courrier
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un courrier entrant</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="subject" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Objet</FormLabel>
                    <FormControl><Input placeholder="Objet du courrier" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="channel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Canal</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Sélectionner un canal" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="paper">Papier</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="portal">Portail</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="received_at" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date de réception</FormLabel>
                    <FormControl><Input type="datetime-local" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Création..." : "Créer le courrier"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par objet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {!organizationId ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Veuillez sélectionner une organisation pour voir les courriers.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
        </Card>
      ) : !couriers?.length ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucun courrier entrant. Cliquez sur "Nouveau courrier" pour commencer.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chrono</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Reçu le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {couriers.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/courrier/${c.id}`)}
                >
                  <TableCell className="font-mono text-xs">{c.chrono ?? "—"}</TableCell>
                  <TableCell className="font-medium max-w-[300px] truncate">{c.subject ?? "Sans objet"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{channelLabels[c.channel as CourierChannel] ?? c.channel}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{c.assigned_service ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {c.received_at ? new Date(c.received_at).toLocaleDateString("fr-FR") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
