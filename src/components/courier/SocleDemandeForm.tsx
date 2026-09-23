// Rendu d'une demande de démarche du référentiel — identité du demandeur
// (`requester_config`) et formulaire (`form_schema`).
//
// Le rendu suit CELUI D'IRIS (dépôt `iris`, `ProcedureFormFields.tsx`), avec
// les briques de Clara : c'est la même demande, saisie ici et instruite
// là-bas ; un agent qui passe d'un produit à l'autre doit retrouver le même
// formulaire. D'où les sections en cartes titrées, la grille à deux colonnes,
// les choix courts en pastilles, le repère « conditionnel », et surtout
// l'adresse saisie d'un seul tenant avec sa carte de contrôle.
//
// Ce qui reste propre à Clara : une pièce jointe se CHOISIT parmi les documents
// du courrier (`PiecesJointesField`), elle ne se téléverse pas.

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  locationAddressText,
  requesterFieldsFor,
  type Audience,
  type FormValues,
  type RequesterConfig,
  type SocleField,
  type SocleFieldOption,
  type SocleFormSchema,
  type SocleSection,
} from "@/lib/socle-form";
import { interventionBlock } from "@/lib/socle-intervention";
import { AddressField } from "@/components/address/AddressField";
import PiecesJointesField from "./PiecesJointesField";
import InterventionAddress from "./InterventionAddress";
import type { CourierDocument } from "@/types/courier";

// ── Briques communes ────────────────────────────────────────────────────────

/** Repère d'un champ (ou d'une section) que les réponses font apparaître. */
function ConditionalBadge() {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9.5px] font-bold uppercase leading-none tracking-wide text-muted-foreground">
      conditionnel
    </span>
  );
}

/**
 * Un champ : son libellé, son contrôle, et l'aide DESSOUS. L'aide sous le
 * champ plutôt qu'au-dessus — elle se lit au moment de répondre, pas avant.
 */
function Field({
  label,
  htmlFor,
  required,
  conditional,
  hint,
  fullWidth,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  conditional?: boolean;
  hint?: string;
  fullWidth?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", fullWidth && "sm:col-span-2")}>
      <Label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[13px] font-semibold">
        <span>{label || "(champ sans libellé)"}</span>
        {required && <span className="font-bold text-destructive">*</span>}
        {conditional && <ConditionalBadge />}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Choix exclusif en pastilles (Oui/Non, listes courtes) — rien de présélectionné. */
function Segmented({
  options,
  value,
  onChange,
  label,
}: {
  options: SocleFieldOption[];
  value: string | null;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const checked = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
              checked
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {o.label || o.value}
          </button>
        );
      })}
    </div>
  );
}

// ── Demandeur (requester_config) ────────────────────────────────────────────

const CIVILITE_OPTIONS: SocleFieldOption[] = [
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
    <div className="space-y-3.5">
      {audiences.length > 1 && (
        <Field label="Le demandeur est" htmlFor="socle-audience">
          <Segmented
            label="Le demandeur est"
            options={audiences.map((a) => ({ value: a.key, label: a.label }))}
            value={audience}
            onChange={(v) => onAudienceChange(v as Audience)}
          />
        </Field>
      )}

      <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
        {fields.map((field) => {
          const val = values[field.key] ?? "";
          const id = `socle-req-${field.key}`;

          // L'adresse du demandeur : une seule clé dans le contrat du Socle,
          // donc une seule ligne — assistée et située, comme dans Iris.
          if (field.key === "adresse") {
            return (
              <AddressField
                key={field.key}
                id={id}
                label={field.label}
                required={field.required}
                singleLine
                hint="Commencez à taper : les adresses du référentiel national sont proposées."
                value={{ line: val, postcode: "", city: "" }}
                onChange={(next, suggestion) =>
                  onChange(field.key, suggestion ? suggestion.label : next.line)
                }
              />
            );
          }

          if (field.key === "civilite") {
            return (
              <Field key={field.key} label={field.label} htmlFor={id} required={field.required}>
                <Segmented
                  label={field.label}
                  options={CIVILITE_OPTIONS}
                  value={val || null}
                  onChange={(v) => onChange(field.key, v)}
                />
              </Field>
            );
          }

          const type =
            field.key === "courriel"
              ? "email"
              : field.key === "tel_portable" || field.key === "tel_fixe"
                ? "tel"
                : "text";
          return (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={id}
              required={field.required}
              fullWidth={REQUESTER_FULL_WIDTH.has(field.key)}
            >
              <Input
                id={id}
                type={type}
                value={val}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            </Field>
          );
        })}
      </div>
    </div>
  );
}

// ── Formulaire (form_schema) ────────────────────────────────────────────────

/** Un champ long, un choix multiple, une pièce ou un lieu occupe toute la largeur. */
function spansFullWidth(field: SocleField): boolean {
  return (
    field.type === "textarea" ||
    field.type === "attachment" ||
    field.type === "checkboxes" ||
    field.type === "location"
  );
}

interface FieldProps {
  values: FormValues;
  onChange: (fieldId: string, value: unknown) => void;
  attachments: Record<string, string[]>;
  onToggleAttachment: (fieldId: string, docId: string) => void;
  courierDocs: CourierDocument[];
  orgId: string;
  courierId: string;
  onNewDoc: (fieldId: string, doc: CourierDocument) => void;
}

function SocleFieldInput({ field, ...props }: { field: SocleField } & FieldProps) {
  const { values, onChange } = props;
  const required = isFieldRequired(field, values);
  const value = values[field.id];
  const inputId = `socle-form-${field.id}`;
  const conditional = Boolean(
    field.visibleIf || (field.type === "attachment" && field.requiredIf),
  );

  // ── Pièce jointe : sélection parmi les documents du courrier ──
  if (field.type === "attachment") {
    const formatsHint =
      field.acceptedFormats.length > 0
        ? `Formats attendus : ${field.acceptedFormats.map((f) => f.toUpperCase()).join(", ")}`
        : null;
    const filesHint = field.maxFiles > 1 ? `${field.maxFiles} documents maximum` : "1 document maximum";
    return (
      <div className="sm:col-span-2">
        <PiecesJointesField
          label={field.label}
          required={required}
          helpText={[field.help, formatsHint, filesHint].filter(Boolean).join(" · ")}
          courierDocs={props.courierDocs}
          selectedIds={props.attachments[field.id] ?? []}
          onToggle={(id) => props.onToggleAttachment(field.id, id)}
          orgId={props.orgId}
          courierId={props.courierId}
          onNewDoc={(doc) => props.onNewDoc(field.id, doc)}
          maxFiles={field.maxFiles}
        />
      </div>
    );
  }

  // ── Lieu d'intervention (type `location`) : une ligne assistée par la BAN ──
  // Ce qui s'écrit est la forme du contrat, comme dans Iris (`LocationFieldControl`) :
  // une proposition retenue → son libellé et SON point ; une saisie libre →
  // l'adresse tapée, sans point. Le point géocodé que la carte montre sous une
  // saisie libre n'est jamais écrit, et l'agent ne déplace pas de point : cet
  // ajustement est un savoir de l'usager, sur place, sur le portail.
  if (field.type === "location") {
    return (
      <AddressField
        id={inputId}
        label={field.label}
        required={required}
        singleLine
        hint={field.help}
        value={{ line: locationAddressText(value), postcode: "", city: "" }}
        onChange={(next, suggestion) => {
          if (suggestion) {
            onChange(field.id, {
              address: suggestion.label,
              lat: suggestion.lat,
              lon: suggestion.lon,
              precision: suggestion.precision,
              adjusted: false,
            });
            return;
          }
          onChange(
            field.id,
            next.line === ""
              ? undefined
              : { address: next.line, lat: null, lon: null, precision: null, adjusted: false },
          );
        }}
      />
    );
  }

  const common = {
    label: field.label,
    htmlFor: inputId,
    required,
    conditional,
    hint: field.help,
    fullWidth: spansFullWidth(field),
  };

  if (field.type === "boolean") {
    return (
      <Field {...common}>
        <Segmented
          label={field.label}
          options={[
            { value: "true", label: "Oui" },
            { value: "false", label: "Non" },
          ]}
          value={value === true ? "true" : value === false ? "false" : null}
          onChange={(v) => onChange(field.id, v === "true")}
        />
      </Field>
    );
  }

  if (field.type === "radio") {
    // Au-delà de quatre choix, les pastilles deviennent un mur : on revient à
    // une liste, qui se parcourt.
    return (
      <Field {...common} fullWidth={field.options.length > 4}>
        {field.options.length <= 4 ? (
          <Segmented
            label={field.label}
            options={field.options}
            value={typeof value === "string" ? value : null}
            onChange={(v) => onChange(field.id, v)}
          />
        ) : (
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={field.label}>
            {field.options.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={inputId}
                  className="accent-primary"
                  checked={value === o.value}
                  onChange={() => onChange(field.id, o.value)}
                />
                {o.label || o.value}
              </label>
            ))}
          </div>
        )}
      </Field>
    );
  }

  if (field.type === "checkboxes") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Field {...common}>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={field.label}>
          {field.options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={checked}
                onClick={() =>
                  onChange(
                    field.id,
                    checked ? selected.filter((v) => v !== o.value) : [...selected, o.value],
                  )
                }
                className={cn(
                  "h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
                  checked
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {o.label || o.value}
              </button>
            );
          })}
        </div>
      </Field>
    );
  }

  if (field.type === "select") {
    return (
      <Field {...common}>
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => onChange(field.id, v)}
        >
          <SelectTrigger id={inputId} className="h-10">
            <SelectValue placeholder={field.placeholder || "Sélectionner…"} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label || o.value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  if (field.type === "textarea") {
    return (
      <Field {...common}>
        <Textarea
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(field.id, e.target.value)}
          rows={3}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          className="resize-none"
        />
      </Field>
    );
  }

  // text / number / date / email / phone
  const htmlType =
    field.type === "number"
      ? "number"
      : field.type === "date"
        ? "date"
        : field.type === "email"
          ? "email"
          : field.type === "phone"
            ? "tel"
            : "text";
  return (
    <Field {...common}>
      <Input
        id={inputId}
        type={htmlType}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(field.id, e.target.value)}
        maxLength={field.type === "text" ? field.maxLength : undefined}
        placeholder={field.placeholder}
      />
    </Field>
  );
}

/** Une grille de champs — ceux que les réponses masquent ne sont pas rendus. */
function FieldGrid({
  fields,
  hidden,
  ...props
}: { fields: SocleField[]; hidden?: Set<string> } & FieldProps) {
  const shown = fields.filter((f) => !hidden?.has(f.id));
  if (shown.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
      {shown.map((field) =>
        evaluateCondition(field.visibleIf, props.values) ? (
          <SocleFieldInput key={field.id} field={field} {...props} />
        ) : null,
      )}
    </div>
  );
}

/**
 * Rendu du formulaire d'une démarche : champs racine et sections dans l'ordre
 * du schéma, conditions `visibleIf` évaluées en direct sur les valeurs saisies.
 *
 * Le lieu d'intervention a deux formes, lues toutes deux comme dans Iris : le
 * champ `location` (Socle 1.29.0), rendu par `SocleFieldInput` ; et l'ancien
 * bloc — une section de sept champs `intervention_*` — reconnu et rendu en UN
 * champ d'adresse assisté (avec carte), sans rien changer à ce qui part : on
 * écrit dans les champs que la démarche pose.
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
} & FieldProps) {
  if (schema.content.length === 0) return null;

  const props: FieldProps = {
    values,
    onChange,
    attachments,
    onToggleAttachment,
    courierDocs,
    orgId,
    courierId,
    onNewDoc,
  };
  const address = interventionBlock(schema);

  // Les champs racine consécutifs partagent une même grille ; chaque section
  // forme son propre groupe titré (l'ordre du schéma est préservé).
  const blocks: Array<
    { kind: "fields"; key: string; fields: SocleField[] } | { kind: "section"; key: string; section: SocleSection }
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
    <div className="flex flex-col gap-4">
      {blocks.map((block) => {
        if (block.kind === "fields") {
          return <FieldGrid key={block.key} fields={block.fields} {...props} />;
        }
        const section = block.section;
        if (!evaluateCondition(section.visibleIf, values)) return null;
        const isAddressSection = address?.section === section;
        return (
          <fieldset
            key={block.key}
            className="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-4"
          >
            <legend className="px-1 text-[13px] font-bold">
              <span className="flex items-center gap-1.5">
                {section.title || "Section"}
                {section.visibleIf && <ConditionalBadge />}
              </span>
            </legend>
            {section.description && (
              <p className="-mt-1 text-[11px] text-muted-foreground">{section.description}</p>
            )}
            {isAddressSection && (
              <InterventionAddress fields={address.fields} values={values} onChange={onChange} />
            )}
            <FieldGrid
              fields={section.fields}
              hidden={isAddressSection ? address.ids : undefined}
              {...props}
            />
          </fieldset>
        );
      })}
    </div>
  );
}
