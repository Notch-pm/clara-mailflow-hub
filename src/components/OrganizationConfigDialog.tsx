import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  listOrgMemberIds,
  listOrgsWithConfig,
  listOrgSignatoryIds,
  listOrgViseurIds,
  setImapBoxOrganization,
  setOrgMembers,
  setOrgSignatories,
  setOrgViseurs,
  updateOrgConfig,
  type SocleOrgWithConfig,
} from "@/services/socleOrgConfigService";
import { listSignatories, type Signatory } from "@/services/signatoryService";
import { getOrgMembers } from "@/services/userService";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Building2, Home, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { inheritedSlaTargets } from "@/lib/courier-sla";

const NONE = "__none__";

// Configuration Clara d'une (sous-)organisation Socle : workflows, boîte IMAP,
// membres, signataires, viseurs. Le libellé et les coordonnées viennent du Socle (lecture
// seule). Le nœud RACINE porte en plus les paramètres globaux du tenant
// (fichier domiciliaire, différenciation IMAP, conservation/purge) — stockés
// sur `organizations`, seule l'UI a déménagé depuis l'ex-« Configuration générale ».

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  org: SocleOrgWithConfig | null;
  /** Tenant Clara. */
  orgId: string;
}

export default function OrganizationConfigDialog({ open, onOpenChange, org, orgId }: Props) {
  const queryClient = useQueryClient();
  const isRoot = org?.socle_parent_id === null;

  const [workflowId, setWorkflowId] = useState<string>(NONE);
  const [replyWorkflowId, setReplyWorkflowId] = useState<string>(NONE);
  const [imapSettingsId, setImapSettingsId] = useState<string>(NONE);
  const [signatoryIds, setSignatoryIds] = useState<string[]>([]);
  const [viseurIds, setViseurIds] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [slaAck, setSlaAck] = useState("");
  const [slaResolution, setSlaResolution] = useState("");

  // Toutes les organisations du tenant : sert à dire ce qu'un délai laissé vide
  // hérite du parent. Même clé et même fonction que les listes (cache partagé).
  const { data: allOrgs = [] } = useQuery({
    queryKey: ["socle-orgs-config", orgId],
    queryFn: () => listOrgsWithConfig(orgId),
    enabled: open && !!orgId,
  });

  // ── Référentiels ──
  const { data: workflows = [] } = useQuery({
    queryKey: ["workflows-for-org-config", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, type")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; type: string | null }[];
    },
    enabled: open && !!orgId,
  });
  const inboundWorkflows = workflows.filter((w) => w.type !== "reply");
  const replyWorkflows = workflows.filter((w) => w.type === "reply");

  const { data: imapBoxes = [] } = useQuery({
    queryKey: ["imap-settings", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("imap_settings")
        .select("id, label, username, socle_organization_id")
        .eq("organization_id", orgId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        label: string;
        username: string;
        socle_organization_id: string | null;
      }[];
    },
    enabled: open && !!orgId,
  });

  const { data: signatories = [] } = useQuery({
    queryKey: ["signatories", orgId],
    queryFn: () => listSignatories(orgId),
    enabled: open && !!orgId,
  });

  const { data: orgMembers = [] } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => getOrgMembers(orgId),
    enabled: open && !!orgId,
  });

  const { data: existingSignatoryIds } = useQuery({
    queryKey: ["socle-org-signatories", org?.id],
    queryFn: () => listOrgSignatoryIds(org!.id),
    enabled: open && !!org?.id,
  });

  const { data: existingViseurIds } = useQuery({
    queryKey: ["socle-org-viseurs", org?.id],
    queryFn: () => listOrgViseurIds(org!.id),
    enabled: open && !!org?.id,
  });

  const { data: existingMemberIds } = useQuery({
    queryKey: ["socle-org-members", org?.id],
    queryFn: () => listOrgMemberIds(org!.id),
    enabled: open && !!org?.id,
  });

  useEffect(() => {
    if (!open || !org) return;
    setWorkflowId(org.workflow_id ?? NONE);
    setReplyWorkflowId(org.reply_workflow_id ?? NONE);
    setImapSettingsId(org.imap_configs?.[0]?.id ?? NONE);
    setSignatoryIds([]);
    setViseurIds([]);
    setMemberIds([]);
    setSlaAck(org.sla_ack_business_days != null ? String(org.sla_ack_business_days) : "");
    setSlaResolution(
      org.sla_resolution_business_days != null ? String(org.sla_resolution_business_days) : "",
    );
  }, [open, org?.id]);

  useEffect(() => {
    if (existingSignatoryIds) setSignatoryIds(existingSignatoryIds);
  }, [existingSignatoryIds]);
  useEffect(() => {
    if (existingViseurIds) setViseurIds(existingViseurIds);
  }, [existingViseurIds]);
  useEffect(() => {
    if (existingMemberIds) setMemberIds(existingMemberIds);
  }, [existingMemberIds]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!org) return;
      await updateOrgConfig(org.id, {
        workflow_id: workflowId !== NONE ? workflowId : null,
        reply_workflow_id: replyWorkflowId !== NONE ? replyWorkflowId : null,
        sla_ack_business_days: parseBusinessDays(slaAck, 365, "L'accusé de réception"),
        sla_resolution_business_days: parseBusinessDays(slaResolution, 3650, "La résolution"),
      });

      // Boîte IMAP : détache l'ancienne si elle change, rattache la nouvelle.
      const previousBoxId = org.imap_configs?.[0]?.id ?? null;
      const nextBoxId = imapSettingsId !== NONE ? imapSettingsId : null;
      if (previousBoxId !== nextBoxId) {
        if (previousBoxId) await setImapBoxOrganization(previousBoxId, null);
        if (nextBoxId) await setImapBoxOrganization(nextBoxId, org.id);
      }

      await Promise.all([
        setOrgMembers(orgId, org.id, memberIds),
        setOrgSignatories(orgId, org.id, signatoryIds),
        setOrgViseurs(orgId, org.id, viseurIds),
      ]);
    },
    onSuccess: () => {
      toast.success("Configuration de l'organisation enregistrée");
      queryClient.invalidateQueries({ queryKey: ["socle-organizations", orgId] });
      queryClient.invalidateQueries({ queryKey: ["socle-orgs-config", orgId] });
      queryClient.invalidateQueries({ queryKey: ["imap-settings", orgId] });
      queryClient.invalidateQueries({ queryKey: ["socle-org-members", org?.id] });
      queryClient.invalidateQueries({ queryKey: ["socle-org-signatories", org?.id] });
      queryClient.invalidateQueries({ queryKey: ["socle-org-viseurs", org?.id] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  function toggleId(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  if (!org) return null;

  const activeMembers = orgMembers.filter((m) => m.membership_active !== false);
  const viseurCandidates = activeMembers.filter((m) => m.is_viseur);
  const inherited = inheritedSlaTargets(allOrgs, org);
  const inheritedHint = (days: number | null) =>
    isRoot ? "Aucun objectif" : days ? `Hérité : ${days} j` : "Hérité : aucun";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-primary" />
            {org.name}
          </DialogTitle>
          <DialogDescription>
            Libellé et coordonnées sont gérés dans le référentiel. Configurez ici le traitement
            des courriers de cette organisation.
          </DialogDescription>
        </DialogHeader>

        {(org.phone || org.email || org.address) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground rounded-lg border p-3">
            {org.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" /> {org.phone}
              </span>
            )}
            {org.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="size-3" /> {org.email}
              </span>
            )}
            {org.address && <span className="truncate">{org.address.split("\n")[0]}</span>}
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Workflow courrier reçu</Label>
            <Select value={workflowId} onValueChange={setWorkflowId}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir un workflow" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Aucun —</SelectItem>
                {inboundWorkflows.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Workflow réponse</Label>
            <Select value={replyWorkflowId} onValueChange={setReplyWorkflowId}>
              <SelectTrigger>
                <SelectValue placeholder="Aucun" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Aucun —</SelectItem>
                {replyWorkflows.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">Délais de traitement des courriers reçus</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isRoot
                  ? "Délais de la collectivité, en jours ouvrés (hors week-ends et jours fériés). Les organisations les reprennent, sauf si elles fixent les leurs."
                  : "En jours ouvrés (hors week-ends et jours fériés). Laissez vide pour reprendre le délai de l'organisation parente."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sla-ack" className="text-xs text-muted-foreground">
                  Accusé de réception
                </Label>
                <Input
                  id="sla-ack"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  step={1}
                  value={slaAck}
                  onChange={(e) => setSlaAck(e.target.value)}
                  placeholder={inheritedHint(inherited.ackDays)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sla-resolution" className="text-xs text-muted-foreground">
                  Résolution
                </Label>
                <Input
                  id="sla-resolution"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={3650}
                  step={1}
                  value={slaResolution}
                  onChange={(e) => setSlaResolution(e.target.value)}
                  placeholder={inheritedHint(inherited.resolutionDays)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              L'accusé de réception est tenu par la première réponse envoyée ; la résolution, par le
              passage du courrier dans un état traité ou archivé.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Boîte IMAP</Label>
            <Select value={imapSettingsId} onValueChange={setImapSettingsId}>
              <SelectTrigger>
                <SelectValue placeholder="Aucune" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— Aucune —</SelectItem>
                {imapBoxes.map((b) => {
                  const linkedElsewhere =
                    b.socle_organization_id && b.socle_organization_id !== org.id;
                  return (
                    <SelectItem key={b.id} value={b.id}>
                      {b.label || b.username}
                      {linkedElsewhere ? " (déjà rattachée ailleurs)" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Les courriers reçus sur cette boîte seront assignés à cette organisation.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Signataires associés</Label>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setSignatoryIds(signatories.map((s: Signatory) => s.id))}
                >
                  Tout
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={() => setSignatoryIds([])}
                >
                  Aucun
                </button>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1">
              {signatories.length === 0 ? (
                <p className="text-xs text-muted-foreground p-1">Aucun signataire configuré.</p>
              ) : (
                signatories.map((s: Signatory) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm p-1 rounded hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={signatoryIds.includes(s.id)}
                      onCheckedChange={() => setSignatoryIds((prev) => toggleId(prev, s.id))}
                    />
                    {s.first_name} {s.last_name}
                    {s.title ? <span className="text-muted-foreground text-xs">— {s.title}</span> : null}
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Viseurs associés</Label>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setViseurIds(viseurCandidates.map((m) => m.id))}
                >
                  Tout
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={() => setViseurIds([])}
                >
                  Aucun
                </button>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1">
              {viseurCandidates.length === 0 ? (
                <p className="text-xs text-muted-foreground p-1">
                  Aucun viseur : activez l'attribut « Viseur » sur la fiche d'un utilisateur.
                </p>
              ) : (
                viseurCandidates.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm p-1 rounded hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={viseurIds.includes(m.id)}
                      onCheckedChange={() => setViseurIds((prev) => toggleId(prev, m.id))}
                    />
                    {[m.first_name, m.last_name].filter(Boolean).join(" ") || m.email}
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Peuvent viser les réponses de cette organisation aux étapes de visa.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Membres associés</Label>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setMemberIds(activeMembers.map((m) => m.id))}
                >
                  Tout
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={() => setMemberIds([])}
                >
                  Aucun
                </button>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1">
              {activeMembers.length === 0 ? (
                <p className="text-xs text-muted-foreground p-1">Aucun membre actif.</p>
              ) : (
                activeMembers.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm p-1 rounded hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={memberIds.includes(m.id)}
                      onCheckedChange={() => setMemberIds((prev) => toggleId(prev, m.id))}
                    />
                    {[m.first_name, m.last_name].filter(Boolean).join(" ") || m.email}
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Les membres ne voient que les courriers de leurs organisations (et les non-assignés).
            </p>
          </div>

          {isRoot && (
            <>
              <Separator />
              <RootOrgSettings orgId={orgId} />
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Délai saisi → entier de jours ouvrés, `null` si vide (hérite du parent). */
function parseBusinessDays(value: string, max: number, label: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new Error(`${label} : un nombre entier de jours ouvrés entre 1 et ${max}.`);
  }
  return n;
}

// ── Paramètres globaux du tenant, portés par l'organisation principale ──
// (ex-« Configuration générale » : stockage inchangé sur organizations)

function RootOrgSettings({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [courierRetention, setCourierRetention] = useState("");

  const { data: org } = useQuery({
    queryKey: ["org-general", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, multiple_imap, courier_retention_days")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data as unknown as {
        id: string;
        multiple_imap: boolean;
        courier_retention_days: number | null;
      };
    },
    enabled: !!orgId,
  });

  useEffect(() => {
    if (!org) return;
    setCourierRetention(org.courier_retention_days != null ? String(org.courier_retention_days) : "");
  }, [org]);

  const toggleMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await supabase
        .from("organizations")
        .update({ multiple_imap: value })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-general", orgId] });
      toast.success("Configuration enregistrée");
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  const retentionMutation = useMutation({
    mutationFn: async () => {
      const parse = (v: string) => {
        const t = v.trim();
        if (!t) return null;
        const n = Number.parseInt(t, 10);
        if (!Number.isFinite(n) || n <= 0) throw new Error("Les durées doivent être des entiers positifs.");
        return n;
      };
      const { error } = await supabase
        .from("organizations")
        .update({
          courier_retention_days: parse(courierRetention),
        })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-general", orgId] });
      toast.success("Durées de conservation enregistrées");
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Paramètres de l'organisation principale</p>

      <div className="flex items-center justify-between rounded-lg border p-3 gap-3">
        <div>
          <Label className="text-sm font-medium">
            Différencier les adresses mail de réception par organisation
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Permet de configurer une boîte IMAP différente par organisation pour la réception des emails.
          </p>
        </div>
        <Switch
          checked={org?.multiple_imap ?? false}
          disabled={toggleMutation.isPending}
          onCheckedChange={(val) => toggleMutation.mutate(val)}
        />
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <Label className="text-sm font-medium">Conservation et purge</Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="root-courier-retention" className="text-xs text-muted-foreground">
              Courriers (jours)
            </Label>
            <Input
              id="root-courier-retention"
              type="number"
              min={1}
              step={1}
              value={courierRetention}
              onChange={(e) => setCourierRetention(e.target.value)}
              placeholder="Ex. 365"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={retentionMutation.isPending}
            onClick={() => retentionMutation.mutate()}
          >
            {retentionMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Enregistrer les durées
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Laissez vide pour désactiver la purge.</p>
      </div>
    </div>
  );
}
