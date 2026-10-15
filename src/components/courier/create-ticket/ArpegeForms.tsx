import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ArpegeConfigField, ArpegeFormComponent } from "@/services/procedureService";
import {
  ARPEGE_DEMANDEUR_CODES,
  flattenComponents,
  getOptions,
  groupByLabel,
  isRequired,
  type IdentiteValue,
} from "@/lib/arpege-business-form";
import type { CourierDocument } from "@/types/courier";
import PiecesJointesField from "../PiecesJointesField";

const CIVILITE_OPTIONS = [
  { value: "M", label: "M." },
  { value: "MME", label: "Mme" },
  { value: "MLLE", label: "Mlle" },
];

const DEMANDEUR_FULL_WIDTH = new Set(["PRENOMS", "EMAIL"]);
const FULL_WIDTH_TYPES = new Set(["Identite", "Pieces_jointes"]);

// ── Demandeur form (2-column grid) ──────────────────────────────────────────

const DEMANDEUR_INPUT_TYPE: Record<string, string> = {
  DATE_NAISSANCE: "date",
  EMAIL: "email",
  TEL_FIXE: "tel",
  TEL_MOBILE: "tel",
};

export function ArpegeForm({
  fields,
  values,
  onChange,
}: {
  fields: ArpegeConfigField[];
  values: Record<string, string>;
  onChange: (code: string, value: string) => void;
}) {
  const visible = fields.filter((f) => ARPEGE_DEMANDEUR_CODES.includes(f.Code));

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {visible.map((field) => {
        const val = values[field.Code] ?? "";
        const fullWidth = DEMANDEUR_FULL_WIDTH.has(field.Code);
        const id = `arpege-${field.Code}`;

        const input =
          field.Code === "CIVILITE" ? (
            <Select value={val} onValueChange={(v) => onChange(field.Code, v)}>
              <SelectTrigger id={id} className="h-8 text-sm">
                <SelectValue placeholder="Sélectionner…" />
              </SelectTrigger>
              <SelectContent>
                {CIVILITE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input id={id} type={DEMANDEUR_INPUT_TYPE[field.Code]} className="h-8 text-sm"
              value={val} onChange={(e) => onChange(field.Code, e.target.value)} />
          );

        return (
          <div key={field.Code} className={cn("space-y-1", fullWidth && "col-span-2")}>
            <Label htmlFor={id} className="text-xs text-muted-foreground">
              {field.Intitule}
              {field.Obligatoire && <span className="text-destructive ml-0.5">*</span>}
            </Label>
            {input}
          </div>
        );
      })}
    </div>
  );
}

// ── Business form (FormComponents, 2-column grid) ───────────────────────────

interface BusinessFormProps {
  components: ArpegeFormComponent[];
  values: Record<string, unknown>;
  onChange: (dataId: string, value: unknown) => void;
  courierDocs: CourierDocument[];
  piecesJointes: Record<string, string[]>;
  onTogglePieceJointe: (dataId: string, docId: string) => void;
  onNewDoc: (dataId: string, doc: CourierDocument) => void;
  orgId: string;
  courierId: string;
}

export function ArpegeBusinessForm({
  components,
  values,
  onChange,
  courierDocs,
  piecesJointes,
  onTogglePieceJointe,
  onNewDoc,
  orgId,
  courierId,
}: BusinessFormProps) {
  const flat = flattenComponents(components);
  if (flat.length === 0) return null;
  const groups = groupByLabel(flat);

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

              const options =
                c.Type === "Combo_autre" || c.Type === "RadiobuttonList" ? getOptions(c) : [];
              const current = (values[c.DataId] as string) ?? "";

              if (options.length > 0) {
                return (
                  <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                    {labelEl}{helpEl}
                    <Select value={current} onValueChange={(v) => onChange(c.DataId, v)}>
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

              const inputType = c.Type === "Date" ? "date" : c.Type === "Chiffre" ? "number" : undefined;
              return (
                <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                  {labelEl}{helpEl}
                  <Input id={`biz-${c.DataId}`} type={inputType} className="h-8 text-sm"
                    value={current}
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
