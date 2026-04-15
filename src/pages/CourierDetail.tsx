import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Users, Clock, Link2, Pencil } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getCourierById, updateCourier } from "@/services/courierService";

const updateSchema = z.object({
  subject: z.string().max(500).optional(),
  assigned_service: z.string().max(200).optional(),
  workflow_state_id: z.string().uuid().optional().or(z.literal("")),
});

const channelLabels: Record<string, string> = { paper: "Papier", email: "Email", portal: "Portail" };
const roleLabels: Record<string, string> = { sender: "Expéditeur", recipient: "Destinataire", cc: "Copie" };

export default function CourierDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: courier, isLoading } = useQuery({
    queryKey: ["courier", id, organizationId],
    queryFn: async () => {
      if (!organizationId || !id) return null;
      const { data, error } = await getCourierById(organizationId, id);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && !!id,
  });

  const form = useForm<z.infer<typeof updateSchema>>({
    resolver: zodResolver(updateSchema),
    values: {
      subject: courier?.subject ?? "",
      assigned_service: courier?.assigned_service ?? "",
      workflow_state_id: courier?.workflow_state_id ?? "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: z.infer<typeof updateSchema>) => {
      if (!organizationId || !id) throw new Error("Contexte manquant");
      const { error } = await updateCourier(organizationId, id, {
        subject: values.subject || null,
        assigned_service: values.assigned_service || null,
        workflow_state_id: values.workflow_state_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courier", id] });
      toast.success("Courrier mis à jour");
      setEditOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!organizationId) {
    return <div className="p-8 text-center text-muted-foreground">Sélectionnez une organisation.</div>;
  }

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Chargement…</div>;
  }

  if (!courier) {
    return <div className="p-8 text-center text-muted-foreground">Courrier introuvable.</div>;
  }

  const participants = (courier as any).courier_participants ?? [];
  const documents = (courier as any).courier_documents ?? [];
  const events = (courier as any).courier_events ?? [];
  const links = (courier as any).courier_links ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{courier.subject ?? "Sans objet"}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">{courier.chrono ?? "—"}</span>
              <Badge variant="outline">{channelLabels[courier.channel] ?? courier.channel}</Badge>
              <Badge variant="secondary">{courier.direction === "inbound" ? "Entrant" : "Sortant"}</Badge>
            </div>
          </div>
        </div>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-1.5"><Pencil className="h-4 w-4" /> Modifier</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Modifier le courrier</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="subject" render={({ field }) => (
                  <FormItem><FormLabel>Objet</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="assigned_service" render={({ field }) => (
                  <FormItem><FormLabel>Service assigné</FormLabel><FormControl><Input placeholder="Ex: Direction Générale" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="workflow_state_id" render={({ field }) => (
                  <FormItem><FormLabel>État workflow (UUID)</FormLabel><FormControl><Input placeholder="UUID de l'état" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="info" className="space-y-4">
        <TabsList>
          <TabsTrigger value="info" className="gap-1.5"><FileText className="h-4 w-4" />Informations</TabsTrigger>
          <TabsTrigger value="participants" className="gap-1.5"><Users className="h-4 w-4" />Participants ({participants.length})</TabsTrigger>
          <TabsTrigger value="events" className="gap-1.5"><Clock className="h-4 w-4" />Historique ({events.length})</TabsTrigger>
          <TabsTrigger value="links" className="gap-1.5"><Link2 className="h-4 w-4" />Liens ({links.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <Card>
            <CardHeader><CardTitle>Informations générales</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div><dt className="text-muted-foreground">Direction</dt><dd>{courier.direction === "inbound" ? "Entrant" : courier.direction === "outbound" ? "Sortant" : "Interne"}</dd></div>
                <div><dt className="text-muted-foreground">Canal</dt><dd>{channelLabels[courier.channel] ?? courier.channel}</dd></div>
                <div><dt className="text-muted-foreground">Service assigné</dt><dd>{courier.assigned_service ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground">Reçu le</dt><dd>{courier.received_at ? new Date(courier.received_at).toLocaleString("fr-FR") : "—"}</dd></div>
                <div><dt className="text-muted-foreground">Envoyé le</dt><dd>{courier.sent_at ? new Date(courier.sent_at).toLocaleString("fr-FR") : "—"}</dd></div>
                <div><dt className="text-muted-foreground">Créé le</dt><dd>{new Date(courier.created_at).toLocaleString("fr-FR")}</dd></div>
              </dl>
              {documents.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium mb-2">Documents ({documents.length})</h3>
                  <ul className="space-y-1 text-sm">
                    {documents.map((d: any) => (
                      <li key={d.id} className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        {d.file_name ?? d.storage_key}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="participants">
          <Card>
            <CardContent className="pt-6">
              {!participants.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">Aucun participant.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rôle</TableHead>
                      <TableHead>Nom</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Organisation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {participants.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell><Badge variant="outline">{roleLabels[p.role] ?? p.role}</Badge></TableCell>
                        <TableCell>{p.name ?? "—"}</TableCell>
                        <TableCell>{p.email ?? "—"}</TableCell>
                        <TableCell>{p.organization ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events">
          <Card>
            <CardContent className="pt-6">
              {!events.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">Aucun événement.</p>
              ) : (
                <div className="space-y-3">
                  {events.map((e: any) => (
                    <div key={e.id} className="flex items-start gap-3 text-sm border-l-2 border-primary/30 pl-3">
                      <div>
                        <span className="font-medium">{e.event_type}</span>
                        <p className="text-muted-foreground text-xs">{new Date(e.created_at).toLocaleString("fr-FR")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="links">
          <Card>
            <CardContent className="pt-6">
              {!links.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">Aucun lien externe.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>ID externe</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Sync</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {links.map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.external_type}</TableCell>
                        <TableCell className="font-mono text-xs">{l.external_id}</TableCell>
                        <TableCell>{l.external_status ?? "—"}</TableCell>
                        <TableCell><Badge variant={l.sync_status === "synced" ? "default" : "secondary"}>{l.sync_status ?? "—"}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
