import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  AUDIENCES,
  evaluateCondition,
  isFieldRequired,
  isSection,
  requesterFieldsFor,
  type Audience,
  type FormValues,
  type RequesterConfig,
  type SocleField,
  type SocleFormSchema,
} from "@/lib/socle-form";
import PiecesJointesField from "./PiecesJointesField";
import type { CourierDocument } from "@/types/courier";

// ── Demandeur (requester_config) ────────────────────────────────────────────

const CIVILITE_OPTIONS = [
  { value: "madame", label: "Madame" },
  { value: "monsieur", label: "Monsieur" },
];

const REQUESTER_FULL_WIDTH = new Set(["adresse", "courriel", "raison_sociale"]);

export function SocleRequesterForm({
  config,
  audience,
  onAudienceChange,
  values,
  onChange,
}: {
  config: RequesterConfig;
  audience: Audience;
  onAudienceChange: (a: Audience) => void;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const audiences = AUDIENCES.filter((a) => config[a.key].enabled);
  const fields = requesterFieldsFor(config, audience);

  return (
    <div className="space-y-3">
      {audiences.length > 1 && (
        <div className="space-y-1">
          <Label htmlFor="socle-audience" className="text-xs text-muted-foreground">
            Le demandeur est
          </Label>
          <Select value={audience} onValueChange={(v) => onAudienceChange(v as Audience)}>
            <SelectTrigger id="socle-audience" className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {audiences.map((a) => (
                <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {fields.map((field) => {
          const val = values[field.key] ?? "";
          const fullWidth = REQUESTER_FULL_WIDTH.has(field.key);

          const labelEl = (
            <Label htmlFor={`socle-req-${field.key}`} className="text-xs text-muted-foreground">
              {field.label}
              {field.required && <span className="text-destructive ml-0.5">*</span>}
            </Label>
          );

          let input: React.ReactNode;
          if (field.key === "civilite") {
            input = (
              <Select value={val} onValueChange={(v) => onChange(field.key, v)}>
                <SelectTrigger id={`socle-req-${field.key}`} className="h-8 text-sm">
                  <SelectValue placeholder="Sélectionner…" />
                </SelectTrigger>
                <SelectContent>
                  {CIVILITE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          } else {
            const type =
              field.key === "courriel" ? "email"
              : field.key === "tel_portable" || field.key === "tel_fixe" ? "tel"
              : "text";
            input = (
              <Input id={`socle-req-${field.key}`} type={type} className="h-8 text-sm"
                value={val} onChange={(e) => onChange(field.key, e.target.value)} />
            );
          }

          return (
            <div key={field.key} className={cn("space-y-1", fullWidth && "col-span-2")}>
              {labelEl}
              {input}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Formulaire (form_schema) ────────────────────────────────────────────────

const HALF_WIDTH_TYPES = new Set(["text", "number", "date", "email", "phone", "select"]);

function SocleFieldInput({
  field,
  values,
  onChange,
  attachments,
  onToggleAttachment,
  courierDocs,
  orgId,
  courierId,
  onNewDoc,
}: {
  field: SocleField;
  values: FormValues;
  onChange: (fieldId: string, value: unknown) => void;
  attachments: Record<string, string[]>;
  onToggleAttachment: (fieldId: string, docId: string) => void;
  courierDocs: CourierDocument[];
  orgId: string;
  courierId: string;
  onNewDoc: (fieldId: string, doc: CourierDocument) => void;
}) {
  const required = isFieldRequired(field, values);
  const value = values[field.id];
  const fullWidth = !HALF_WIDTH_TYPES.has(field.type);
  const inputId = `socle-form-${field.id}`;

  const labelEl = (
    <Label htmlFor={inputId} className="text-xs text-muted-foreground">
      {field.label || "(champ sans libellé)"}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </Label>
  );
  const helpEl = field.help ? (
    <p className="text-[10px] text-muted-foreground/70 -mt-0.5">{field.help}</p>
  ) : null;

  // ── Pièce jointe : sélection parmi les documents du courrier ──
  if (field.type === "attachment") {
    const formatsHint = field.acceptedFormats.length > 0
      ? `Formats attendus : ${field.acceptedFormats.map((f) => f.toUpperCase()).join(", ")}`
      : null;
    const filesHint = field.maxFiles > 1
      ? `${field.maxFiles} documents maximum`
      : "1 document maximum";
    return (
      <div className="col-span-2">
        <PiecesJointesField
          label={field.label}
          required={required}
          helpText={[field.help, formatsHint, filesHint].filter(Boolean).join(" · ")}
          courierDocs={courierDocs}
          selectedIds={attachments[field.id] ?? []}
          onToggle={(id) => onToggleAttachment(field.id, id)}
          orgId={orgId}
          courierId={courierId}
          onNewDoc={(doc) => onNewDoc(field.id, doc)}
          maxFiles={field.maxFiles}
        />
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="col-span-2 space-y-1">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            id={inputId}
            checked={value === true}
            onCheckedChange={(checked) => onChange(field.id, checked === true)}
          />
          <span>
            {field.label || "(champ sans libellé)"}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </span>
        </label>
        {helpEl}
      </div>
    );
  }

  if (field.type === "radio") {
    return (
      <div className="col-span-2 space-y-1.5">
        {labelEl}
        {helpEl}
        <RadioGroup
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => onChange(field.id, v)}
          className="gap-1.5"
        >
          {field.options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <RadioGroupItem value={o.value} id={`${inputId}-${o.value}`} />
              {o.label || o.value}
            </label>
          ))}
        </RadioGroup>
      </div>
    );
  }

  if (field.type === "checkboxes") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="col-span-2 space-y-1.5">
        {labelEl}
        {helpEl}
        <div className="flex flex-col gap-1.5">
          {field.options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={selected.includes(o.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    field.id,
                    checked === true
                      ? [...selected, o.value]
                      : selected.filter((v) => v !== o.value),
                  )
                }
              />
              {o.label || o.value}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className="space-y-1">
        {labelEl}
        {helpEl}
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => onChange(field.id, v)}
        >
          <SelectTrigger id={inputId} className="h-8 text-sm">
            <SelectValue placeholder={field.placeholder || "Sélectionner…"} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label || o.value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div className="col-span-2 space-y-1">
        {labelEl}
        {helpEl}
        <Textarea
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(field.id, e.target.value)}
          rows={3}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          className="resize-none text-sm"
        />
      </div>
    );
  }

  // text / number / date / email / phone
  const htmlType =
    field.type === "number" ? "number"
    : field.type === "date" ? "date"
    : field.type === "email" ? "email"
    : field.type === "phone" ? "tel"
    : "text";
  return (
    <div className={cn("space-y-1", fullWidth && "col-span-2")}>
      {labelEl}
      {helpEl}
      <Input
        id={inputId}
        type={htmlType}
        className="h-8 text-sm"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(field.id, e.target.value)}
        maxLength={field.type === "text" ? field.maxLength : undefined}
        placeholder={field.placeholder}
      />
    </div>
  );
}

/**
 * Rendu du formulaire d'une démarche Socle : champs racine et sections dans
 * l'ordre du schéma, conditions `visibleIf` évaluées en direct sur les valeurs
 * saisies (un champ ou une section masqués par condition ne sont pas rendus).
 */
export function SocleFormFields({
  schema,
  values,
  onChange,
  attachments,
  onToggleAttachment,
  courierDocs,
  orgId,
  courierId,
  onNewDoc,
}: {
  schema: SocleFormSchema;
  values: FormValues;
  onChange: (fieldId: string, value: unknown) => void;
  attachments: Record<string, string[]>;
  onToggleAttachment: (fieldId: string, docId: string) => void;
  courierDocs: CourierDocument[];
  orgId: string;
  courierId: string;
  onNewDoc: (fieldId: string, doc: CourierDocument) => void;
}) {
  if (schema.content.length === 0) return null;

  const fieldProps = {
    values, onChange, attachments, onToggleAttachment,
    courierDocs, orgId, courierId, onNewDoc,
  };

  const renderField = (field: SocleField) =>
    evaluateCondition(field.visibleIf, values) ? (
      <SocleFieldInput key={field.id} field={field} {...fieldProps} />
    ) : null;

  // Blocs successifs : les champs racine consécutifs partagent une même grille,
  // chaque section a la sienne (préserve l'ordre du schéma).
  const blocks: Array<
    | { kind: "fields"; key: string; fields: SocleField[] }
    | { kind: "section"; key: string; section: Extract<typeof schema.content[number], { kind: "section" }> }
  > = [];
  for (const node of schema.content) {
    if (isSection(node)) {
      blocks.push({ kind: "section", key: node.id, section: node });
    } else {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "fields") last.fields.push(node);
      else blocks.push({ kind: "fields", key: node.id, fields: [node] });
    }
  }

  return (
    <div className="space-y-4">
      {blocks.map((block) => {
        if (block.kind === "fields") {
          return (
            <div key={block.key} className="grid grid-cols-2 gap-x-4 gap-y-3">
              {block.fields.map(renderField)}
            </div>
          );
        }
        const section = block.section;
        if (!evaluateCondition(section.visibleIf, values)) return null;
        return (
          <div key={block.key} className="space-y-2">
            <div className="border-b pb-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title || "Section"}
              </p>
              {section.description && (
                <p className="text-[10px] text-muted-foreground/70">{section.description}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {section.fields.map(renderField)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
