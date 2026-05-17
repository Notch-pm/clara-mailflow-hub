import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Check, ChevronsUpDown, X, User, FileText, Upload, File as FileIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  listProcedures,
  type ArpegeConfigField,
  type ArpegeFormComponent,
} from "@/services/procedureService";
import {
  createTicket,
  createArpegeTicket,
  updateTicket,
  type ActionTicketWithProcedure,
} from "@/services/actionTicketService";
import { logEvent } from "@/services/courierEventService";
import { getDocuments } from "@/services/courierDocumentService";
import { storage } from "@/services/storageService";
import { getOrgMembers } from "@/services/userService";
import { UserAvatar } from "@/components/UserAvatar";
import type { CourierDocument } from "@/types/courier";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courierId: string;
  organizationId: string;
  initialDescription?: string;
  initialProcedureId?: string;
  initialArpegeValues?: Record<string, string>;
  ticket?: ActionTicketWithProcedure | null;
}

const CIVILITE_OPTIONS = [
  { value: "M", label: "M." },
  { value: "MME", label: "Mme" },
  { value: "MLLE", label: "Mlle" },
];

const FIELD_CODES_DISPLAYED = [
  "CIVILITE", "NOM_USUEL", "NOM_NAISSANCE", "PRENOMS",
  "DATE_NAISSANCE", "EMAIL", "TEL_FIXE", "TEL_MOBILE",
];

const DEMANDEUR_FULL_WIDTH = new Set(["PRENOMS", "EMAIL"]);

// ── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-2 pb-1">
      <div className="mt-0.5 rounded-md bg-muted p-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight">{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Demandeur form (2-column grid) ──────────────────────────────────────────

function ArpegeForm({
  fields,
  values,
  onChange,
}: {
  fields: ArpegeConfigField[];
  values: Record<string, string>;
  onChange: (code: string, value: string) => void;
}) {
  const visible = fields.filter((f) => FIELD_CODES_DISPLAYED.includes(f.Code));

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {visible.map((field) => {
        const val = values[field.Code] ?? "";
        const fullWidth = DEMANDEUR_FULL_WIDTH.has(field.Code);

        const labelEl = (
          <Label htmlFor={`arpege-${field.Code}`} className="text-xs text-muted-foreground">
            {field.Intitule}
            {field.Obligatoire && <span className="text-destructive ml-0.5">*</span>}
          </Label>
        );

        let input: React.ReactNode;

        if (field.Code === "CIVILITE") {
          input = (
            <Select value={val} onValueChange={(v) => onChange(field.Code, v)}>
              <SelectTrigger id={`arpege-${field.Code}`} className="h-8 text-sm">
                <SelectValue placeholder="Sélectionner…" />
              </SelectTrigger>
              <SelectContent>
                {CIVILITE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        } else if (field.Code === "DATE_NAISSANCE") {
          input = <Input id={`arpege-${field.Code}`} type="date" className="h-8 text-sm"
            value={val} onChange={(e) => onChange(field.Code, e.target.value)} />;
        } else if (field.Code === "EMAIL") {
          input = <Input id={`arpege-${field.Code}`} type="email" className="h-8 text-sm"
            value={val} onChange={(e) => onChange(field.Code, e.target.value)} />;
        } else if (field.Code === "TEL_FIXE" || field.Code === "TEL_MOBILE") {
          input = <Input id={`arpege-${field.Code}`} type="tel" className="h-8 text-sm"
            value={val} onChange={(e) => onChange(field.Code, e.target.value)} />;
        } else {
          input = <Input id={`arpege-${field.Code}`} className="h-8 text-sm"
            value={val} onChange={(e) => onChange(field.Code, e.target.value)} />;
        }

        return (
          <div key={field.Code} className={cn("space-y-1", fullWidth && "col-span-2")}>
            {labelEl}
            {input}
          </div>
        );
      })}
    </div>
  );
}

// ── Pieces jointes field ────────────────────────────────────────────────────

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function PiecesJointesField({
  dataId,
  label,
  required,
  helpText,
  courierDocs,
  selectedIds,
  onToggle,
  orgId,
  courierId,
  onNewDoc,
}: {
  dataId: string;
  label: string;
  required: boolean;
  helpText?: string;
  courierDocs: CourierDocument[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  orgId: string;
  courierId: string;
  onNewDoc: (doc: CourierDocument) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const doc = await storage.upload(orgId, courierId, file, "attachment");
        onNewDoc(doc);
      }
    } catch {
      toast.error("Erreur lors de l'upload du fichier");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <Label className="text-xs text-muted-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        {helpText && <p className="text-[10px] text-muted-foreground/70">{helpText}</p>}
      </div>

      <div className={cn(
        "rounded-md border",
        courierDocs.length === 0 && "border-dashed",
      )}>
        {courierDocs.length === 0 ? (
          <div className="p-3 text-center text-xs text-muted-foreground">
            Aucun document disponible — utilisez le bouton ci-dessous pour en ajouter.
          </div>
        ) : (
          <div className="divide-y max-h-44 overflow-y-auto">
            {courierDocs.map((doc) => {
              const checked = selectedIds.includes(doc.id);
              const name = doc.file_name ?? doc.storage_key.split("/").pop() ?? "fichier";
              return (
                <label
                  key={doc.id}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors text-sm",
                    checked ? "bg-primary/5" : "hover:bg-muted/40",
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-primary"
                    checked={checked}
                    onChange={() => onToggle(doc.id)}
                  />
                  <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{name}</span>
                  {doc.file_size && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatSize(doc.file_size)}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading
          ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Upload en cours…</>
          : <><Upload className="h-3.5 w-3.5 mr-1.5" />Ajouter un fichier depuis l'ordinateur</>
        }
      </Button>
    </div>
  );
}

// ── Business form (FormComponents, 2-column grid) ───────────────────────────

interface FlatComponent {
  component: ArpegeFormComponent;
  groupLabel?: string;
}

function flattenComponents(
  components: ArpegeFormComponent[],
  groupLabel?: string,
): FlatComponent[] {
  const result: FlatComponent[] = [];
  // If this level contains a Pieces_jointes, sibling leaf fields are auxiliary
  // (e.g. a title/description Texte added by Arpège alongside the upload slot)
  // and should be skipped to avoid spurious text inputs.
  const levelHasPJ = components.some((c) => c.Type === "Pieces_jointes");

  for (const c of components) {
    if (c.Type === "Bloc") {
      result.push(...flattenComponents(c.Components ?? [], c.Libelle || groupLabel));
    } else if (c.Type === "Pieces_jointes") {
      result.push({ component: c, groupLabel });
    } else if (!levelHasPJ && c.Type !== "Label_long") {
      result.push({ component: c, groupLabel });
    }
  }
  return result;
}

function isRequired(c: ArpegeFormComponent): boolean {
  return !c.Libelle?.includes("(facultatif)");
}

function getOptions(c: ArpegeFormComponent): Array<{ code: string; label: string }> {
  if (!Array.isArray(c.Value) || c.Value.length === 0) return [];
  return (c.Value as Array<Record<string, string>>).map((v) => ({
    code: v.Code ?? v.code ?? String(v),
    label: v.Libelle ?? v.libelle ?? v.Label ?? v.Code ?? String(v),
  }));
}

const FULL_WIDTH_TYPES = new Set(["Identite", "Pieces_jointes"]);

type IdentiteValue = {
  CodeCivilite: string;
  NomUsage: string;
  NomNaissance: string;
  Prenoms: string;
};

function ArpegeBusinessForm({
  components,
  values,
  onChange,
  courierDocs,
  piecesJointes,
  onTogglePieceJointe,
  onNewDoc,
  orgId,
  courierId,
}: {
  components: ArpegeFormComponent[];
  values: Record<string, unknown>;
  onChange: (dataId: string, value: unknown) => void;
  courierDocs: CourierDocument[];
  piecesJointes: Record<string, string[]>;
  onTogglePieceJointe: (dataId: string, docId: string) => void;
  onNewDoc: (dataId: string, doc: CourierDocument) => void;
  orgId: string;
  courierId: string;
}) {
  const flat = flattenComponents(components);
  if (flat.length === 0) return null;

  const groups: Array<{ label?: string; items: FlatComponent[] }> = [];
  for (const item of flat) {
    const last = groups[groups.length - 1];
    if (!last || last.label !== item.groupLabel) {
      groups.push({ label: item.groupLabel, items: [item] });
    } else {
      last.items.push(item);
    }
  }

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => (
        <div key={gi} className="space-y-2">
          {group.label && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1">
              {group.label}
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {group.items.map(({ component: c }) => {
              const required = isRequired(c);
              const fullWidth = FULL_WIDTH_TYPES.has(c.Type);

              const labelEl = (
                <Label htmlFor={`biz-${c.DataId}`} className="text-xs text-muted-foreground">
                  {c.Libelle}
                  {required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
              );
              const helpEl = c.LibelleAide ? (
                <p className="text-[10px] text-muted-foreground/70 -mt-0.5">{c.LibelleAide}</p>
              ) : null;

              // ── Pieces jointes ──
              if (c.Type === "Pieces_jointes") {
                return (
                  <div key={c.DataId} className="col-span-2">
                    <PiecesJointesField
                      dataId={c.DataId}
                      label={c.Libelle}
                      required={required}
                      helpText={c.LibelleAide || undefined}
                      courierDocs={courierDocs}
                      selectedIds={piecesJointes[c.DataId] ?? []}
                      onToggle={(id) => onTogglePieceJointe(c.DataId, id)}
                      orgId={orgId}
                      courierId={courierId}
                      onNewDoc={(doc) => onNewDoc(c.DataId, doc)}
                    />
                  </div>
                );
              }

              // ── Identite ──
              if (c.Type === "Identite") {
                const identVal = (values[c.DataId] as IdentiteValue) ?? {
                  CodeCivilite: "", NomUsage: "", NomNaissance: "", Prenoms: "",
                };
                const update = (key: keyof IdentiteValue, v: string) =>
                  onChange(c.DataId, { ...identVal, [key]: v });
                return (
                  <div key={c.DataId} className={cn("space-y-1.5", fullWidth && "col-span-2")}>
                    {labelEl}
                    {helpEl}
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={identVal.CodeCivilite} onValueChange={(v) => update("CodeCivilite", v)}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Civilité" /></SelectTrigger>
                        <SelectContent>
                          {CIVILITE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input placeholder="Prénom(s)" className="h-8 text-sm" value={identVal.Prenoms}
                        onChange={(e) => update("Prenoms", e.target.value)} />
                      <Input placeholder="Nom d'usage" className="h-8 text-sm" value={identVal.NomUsage}
                        onChange={(e) => update("NomUsage", e.target.value)} />
                      <Input placeholder="Nom de naissance" className="h-8 text-sm" value={identVal.NomNaissance}
                        onChange={(e) => update("NomNaissance", e.target.value)} />
                    </div>
                  </div>
                );
              }

              if (c.Type === "Date") {
                return (
                  <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                    {labelEl}{helpEl}
                    <Input id={`biz-${c.DataId}`} type="date" className="h-8 text-sm"
                      value={(values[c.DataId] as string) ?? ""}
                      onChange={(e) => onChange(c.DataId, e.target.value)} />
                  </div>
                );
              }

              if (c.Type === "Chiffre") {
                return (
                  <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                    {labelEl}{helpEl}
                    <Input id={`biz-${c.DataId}`} type="number" className="h-8 text-sm"
                      value={(values[c.DataId] as string) ?? ""}
                      onChange={(e) => onChange(c.DataId, e.target.value)} />
                  </div>
                );
              }

              if (c.Type === "Combo_autre" || c.Type === "RadiobuttonList") {
                const options = getOptions(c);
                if (options.length > 0) {
                  return (
                    <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                      {labelEl}{helpEl}
                      <Select
                        value={(values[c.DataId] as string) ?? ""}
                        onValueChange={(v) => onChange(c.DataId, v)}
                      >
                        <SelectTrigger id={`biz-${c.DataId}`} className="h-8 text-sm">
                          <SelectValue placeholder="Sélectionner…" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((o) => (
                            <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
              }

              return (
                <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                  {labelEl}{helpEl}
                  <Input id={`biz-${c.DataId}`} className="h-8 text-sm"
                    value={(values[c.DataId] as string) ?? ""}
                    onChange={(e) => onChange(c.DataId, e.target.value)} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildFormValues(
  components: ArpegeFormComponent[],
  values: Record<string, unknown>,
): Array<{ id: string; valeur: unknown }> {
  return flattenComponents(components)
    .filter(({ component: c }) => c.Type !== "Pieces_jointes")
    .map(({ component: c }) => ({ id: c.DataId, valeur: values[c.DataId] ?? null }))
    .filter((e) => e.valeur !== null && e.valeur !== "");
}

function businessRequiredMet(
  components: ArpegeFormComponent[],
  values: Record<string, unknown>,
  piecesJointes: Record<string, string[]>,
): boolean {
  return flattenComponents(components)
    .filter(({ component: c }) => isRequired(c))
    .every(({ component: c }) => {
      if (c.Type === "Pieces_jointes") {
        return (piecesJointes[c.DataId]?.length ?? 0) > 0;
      }
      if (c.Type === "Identite") {
        const id = values[c.DataId] as IdentiteValue | undefined;
        return id && (id.NomUsage || id.NomNaissance) && id.Prenoms;
      }
      const v = values[c.DataId];
      return v !== undefined && v !== null && String(v).trim().length > 0;
    });
}

// ── Main dialog ─────────────────────────────────────────────────────────────

export default function CreateTicketDialog({
  open,
  onOpenChange,
  courierId,
  organizationId,
  initialDescription = "",
  initialProcedureId,
  initialArpegeValues,
  ticket = null,
}: Props) {
  const qc = useQueryClient();
  const isEdit = !!ticket;
  const [procedureId, setProcedureId] = useState<string>("");
  const [description, setDescription] = useState<string>(initialDescription);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [procedurePopoverOpen, setProcedurePopoverOpen] = useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);
  const [arpegeValues, setArpegeValues] = useState<Record<string, string>>({});
  const [businessValues, setBusinessValues] = useState<Record<string, unknown>>({});
  const [piecesJointes, setPiecesJointes] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (open) {
      if (isEdit && ticket) {
        setDescription(ticket.description ?? "");
        setProcedureId(ticket.procedure_id);
        setAssigneeId(ticket.assignee_id ?? null);
        setArpegeValues({});
      } else {
        setDescription(initialDescription);
        setProcedureId(initialProcedureId ?? "");
        setAssigneeId(null);
        setArpegeValues(initialArpegeValues ?? {});
      }
      setBusinessValues({});
      setPiecesJointes({});
    }
  }, [open, initialDescription, initialProcedureId, initialArpegeValues, isEdit, ticket]);

  const { data: procedures, isLoading: loadingProcedures } = useQuery({
    queryKey: ["procedures-displayed", organizationId],
    queryFn: () => listProcedures(organizationId),
    enabled: !!organizationId && open,
  });

  const displayedProcedures = (procedures ?? []).filter((p) => p.is_displayed);
  const selectedProcedure = displayedProcedures.find((p) => p.id === procedureId) ?? null;

  const isArpege = selectedProcedure?.external_source === "arpege" && !isEdit;
  const arpegeFields = selectedProcedure?.arpege_config_fields?.ConfigInfoUsagerObligs ?? [];
  const formComponents = selectedProcedure?.arpege_config_fields?.FormComponents ?? [];

  const hasPiecesJointesField = isArpege &&
    flattenComponents(formComponents).some(({ component: c }) => c.Type === "Pieces_jointes");

  const { data: courierDocs = [] } = useQuery({
    queryKey: ["courier-documents", courierId],
    queryFn: () => getDocuments(courierId),
    enabled: hasPiecesJointesField && open,
  });

  const { data: members, isLoading: loadingMembers } = useQuery({
    queryKey: ["org-members", organizationId],
    queryFn: () => getOrgMembers(organizationId),
    enabled: !!organizationId && open && !isArpege,
  });

  const activeMembers = (members ?? []).filter(
    (m) => m.is_active !== false && m.membership_active !== false,
  );
  const selectedAssignee = activeMembers.find((m) => m.id === assigneeId) ?? null;

  const fullName = (m: { first_name: string | null; last_name: string | null; email: string }) =>
    [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email;

  const handleArpegeChange = (code: string, value: string) =>
    setArpegeValues((prev) => ({ ...prev, [code]: value }));

  const handleBusinessChange = (dataId: string, value: unknown) =>
    setBusinessValues((prev) => ({ ...prev, [dataId]: value }));

  const togglePieceJointe = (dataId: string, docId: string) =>
    setPiecesJointes((prev) => {
      const current = prev[dataId] ?? [];
      return {
        ...prev,
        [dataId]: current.includes(docId)
          ? current.filter((id) => id !== docId)
          : [...current, docId],
      };
    });

  const handleNewDoc = (dataId: string, doc: CourierDocument) => {
    qc.setQueryData(["courier-documents", courierId], (old: CourierDocument[] | undefined) =>
      [doc, ...(old ?? [])],
    );
    togglePieceJointe(dataId, doc.id);
  };

  const arpegeObligatoryMet = arpegeFields
    .filter((f) => f.Obligatoire && FIELD_CODES_DISPLAYED.includes(f.Code))
    .every((f) => (arpegeValues[f.Code] ?? "").trim().length > 0);

  const bizObligatoryMet =
    formComponents.length === 0 ||
    businessRequiredMet(formComponents, businessValues, piecesJointes);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit && ticket) {
        await updateTicket(ticket.id, { description, assigneeId, procedureId });
        await logEvent(organizationId, courierId, "ticket_updated", {
          ticket_id: ticket.id,
          procedure_id: procedureId,
          assignee_id: assigneeId,
        });
        return ticket;
      }

      if (isArpege) {
        const formValues = buildFormValues(formComponents, businessValues);
        const created = await createArpegeTicket({
          organizationId,
          courierId,
          procedureId,
          demandeur: arpegeValues,
          formValues,
          pieceJointes: piecesJointes,
        });
        await logEvent(organizationId, courierId, "ticket_created", {
          ticket_id: created.id,
          procedure_id: procedureId,
          arpege_ref: created.arpege_demande_ref,
        });
        return created;
      }

      const created = await createTicket({
        organizationId,
        courierId,
        procedureId,
        description,
        assigneeId,
      });
      await logEvent(organizationId, courierId, "ticket_created", {
        ticket_id: created.id,
        procedure_id: procedureId,
        assignee_id: assigneeId,
        description: description?.slice(0, 200) || null,
      });
      return created;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Ticket modifié" : "Ticket créé");
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit =
    !!procedureId &&
    !saveMutation.isPending &&
    (!isArpege || (arpegeObligatoryMet && bizObligatoryMet));

  const hasBothForms = isArpege && arpegeFields.length > 0 && formComponents.length > 0;
  const hasArpegeOnly = isArpege && arpegeFields.length > 0 && formComponents.length === 0;
  const hasBusinessOnly = isArpege && arpegeFields.length === 0 && formComponents.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col max-h-[92vh]",
          isArpege ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <DialogHeader className="shrink-0 pb-2">
          <DialogTitle>
            {isEdit ? "Modifier le ticket d'action" : "Nouvelle demande"}
          </DialogTitle>
          {selectedProcedure && (
            <p className="text-sm text-muted-foreground">{selectedProcedure.name}</p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-5 py-1">

          {/* Démarche */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Démarche</Label>
            <Popover open={procedurePopoverOpen} onOpenChange={setProcedurePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={procedurePopoverOpen}
                  className="w-full justify-between h-9"
                  disabled={loadingProcedures || isEdit}
                >
                  <span className="truncate">
                    {selectedProcedure
                      ? selectedProcedure.name
                      : loadingProcedures ? "Chargement…" : "Sélectionnez une démarche"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder="Rechercher une démarche…" />
                  <CommandList>
                    <CommandEmpty>Aucune démarche trouvée</CommandEmpty>
                    <CommandGroup>
                      {displayedProcedures.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={p.name}
                          onSelect={() => {
                            setProcedureId(p.id);
                            setArpegeValues({});
                            setBusinessValues({});
                            setPiecesJointes({});
                            setProcedurePopoverOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", procedureId === p.id ? "opacity-100" : "opacity-0")} />
                          {p.name}
                          {p.external_source === "arpege" && (
                            <span className="ml-auto text-[10px] text-muted-foreground">Arpège</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Arpège forms — side by side when both present */}
          {hasBothForms && (
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <SectionHeader icon={User} title="Demandeur" subtitle="Identité de la personne concernée" />
                <ArpegeForm fields={arpegeFields} values={arpegeValues} onChange={handleArpegeChange} />
              </div>
              <div className="space-y-3">
                <SectionHeader icon={FileText} title="Données métier" subtitle="Informations spécifiques à la démarche" />
                <ArpegeBusinessForm
                  components={formComponents}
                  values={businessValues}
                  onChange={handleBusinessChange}
                  courierDocs={courierDocs}
                  piecesJointes={piecesJointes}
                  onTogglePieceJointe={togglePieceJointe}
                  onNewDoc={handleNewDoc}
                  orgId={organizationId}
                  courierId={courierId}
                />
              </div>
            </div>
          )}

          {hasArpegeOnly && (
            <div className="space-y-3">
              <SectionHeader icon={User} title="Demandeur" subtitle="Identité de la personne concernée" />
              <ArpegeForm fields={arpegeFields} values={arpegeValues} onChange={handleArpegeChange} />
            </div>
          )}

          {hasBusinessOnly && (
            <div className="space-y-3">
              <SectionHeader icon={FileText} title="Données métier" subtitle="Informations spécifiques à la démarche" />
              <ArpegeBusinessForm
                components={formComponents}
                values={businessValues}
                onChange={handleBusinessChange}
                courierDocs={courierDocs}
                piecesJointes={piecesJointes}
                onTogglePieceJointe={togglePieceJointe}
                onNewDoc={handleNewDoc}
                orgId={organizationId}
                courierId={courierId}
              />
            </div>
          )}

          {/* Champs communs — masqués pour Arpège (non transmissibles) */}
          {!isArpege && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Affecté à</Label>
                <div className="flex items-center gap-1.5">
                  <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={assigneePopoverOpen}
                        className="flex-1 justify-between h-9 min-w-0"
                        disabled={loadingMembers}
                      >
                        <span className="flex items-center gap-2 truncate">
                          {selectedAssignee ? (
                            <>
                              <UserAvatar
                                firstName={selectedAssignee.first_name}
                                lastName={selectedAssignee.last_name}
                                email={selectedAssignee.email}
                                avatarUrl={selectedAssignee.avatar_url}
                                className="h-5 w-5 shrink-0"
                              />
                              <span className="truncate">{fullName(selectedAssignee)}</span>
                            </>
                          ) : loadingMembers ? "Chargement…" : (
                            <span className="text-muted-foreground">Non affecté</span>
                          )}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0">
                      <Command>
                        <CommandInput placeholder="Rechercher…" />
                        <CommandList>
                          <CommandEmpty>Aucun utilisateur trouvé</CommandEmpty>
                          <CommandGroup>
                            {activeMembers.map((m) => (
                              <CommandItem
                                key={m.id}
                                value={`${fullName(m)} ${m.email}`}
                                onSelect={() => { setAssigneeId(m.id); setAssigneePopoverOpen(false); }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", assigneeId === m.id ? "opacity-100" : "opacity-0")} />
                                <UserAvatar
                                  firstName={m.first_name}
                                  lastName={m.last_name}
                                  email={m.email}
                                  avatarUrl={m.avatar_url}
                                  className="h-6 w-6 mr-2"
                                />
                                <span className="flex-1 truncate">{fullName(m)}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedAssignee && (
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                      onClick={() => setAssigneeId(null)} title="Retirer">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Descriptif</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Décrivez l'action à mener…"
                  className="resize-none text-sm"
                  rows={4}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            Annuler
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!canSubmit}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? "Enregistrer" : isArpege ? "Créer la demande Arpège" : "Créer le ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
