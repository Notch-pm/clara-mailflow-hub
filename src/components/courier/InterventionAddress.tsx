// Le bloc « Lieu d'intervention » d'une démarche, saisi comme une adresse et
// non comme sept champs séparés.
//
// Rien du contrat ne change : on écrit dans EXACTEMENT les champs que la
// démarche pose (`onChange(field.id, …)`, comme n'importe quel champ du
// formulaire), et la reconnaissance du bloc est celle d'Iris
// (`interventionFields`). Si la démarche n'a pas de champ pour une partie de
// l'adresse, cette partie n'est pas inventée : elle rejoint la voie
// (`fitStreetParts`).

import { useState } from "react";
import { AddressField } from "@/components/address/AddressField";
import { splitStreetLine, streetLine, toInterventionParts } from "@/lib/adresse";
import {
  displayFieldValue,
  fitStreetParts,
  optionValueFor,
  type AddressPart,
  type FlatField,
} from "@/lib/socle-intervention";
import type { FormValues } from "@/lib/socle-form";

/** Précisions d'accès du bloc : dépliées par « Plus de champs », jamais géocodées. */
const EXTRA_PARTS: AddressPart[] = ["batiment", "appartement", "complement"];

const EXTRA_LABELS: Record<string, string> = {
  batiment: "Bâtiment",
  appartement: "Appartement",
  complement: "Complément d'adresse",
};

interface Props {
  fields: Map<AddressPart, FlatField>;
  values: FormValues;
  onChange: (fieldId: string, value: unknown) => void;
}

export default function InterventionAddress({ fields, values, onChange }: Props) {
  // ⚠️ La ligne affichée ne peut PAS être recomposée depuis les champs séparés
  // pendant la frappe : le découpage normalise les espaces, si bien qu'un
  // « 12 » suivi d'une espace redevient « 12 » et que la lettre suivante se
  // recolle (« 12b » → numéro 12, BTQ « b »…) — la saisie donnait
  // « 12 Bisruedeslilasarles » chez Iris, vécu en navigateur.
  //
  // Tant que l'agent tape, c'est SA ligne qui s'affiche ; les champs du bloc
  // sont alimentés à côté. Retenir une proposition rend la main aux champs
  // (`null`), qui portent alors le libellé canonique du référentiel.
  const [typed, setTyped] = useState<string | null>(null);

  const entryOf = (part: AddressPart) => fields.get(part) ?? null;
  const has = (part: AddressPart) => fields.has(part);

  /** Valeur lisible (libellé d'option pour un select, comme à la relecture). */
  const shown = (part: AddressPart): string => {
    const entry = entryOf(part);
    return entry ? displayFieldValue(entry.field, values[entry.field.id]).trim() : "";
  };
  const set = (part: AddressPart, value: string) => {
    const entry = entryOf(part);
    if (entry) onChange(entry.field.id, value);
  };

  const btqField = entryOf("btq")?.field ?? null;
  const applyStreet = (parts: { numero: string; btq: string; voie: string }) => {
    const fitted = fitStreetParts(parts, has, (text) =>
      btqField ? optionValueFor(btqField, text) : null,
    );
    set("numero", fitted.numero);
    set("btq", fitted.btq);
    set("voie", fitted.voie);
  };

  const composed = streetLine({ numero: shown("numero"), btq: shown("btq"), voie: shown("voie") });
  const line = typed ?? composed;
  const extras = EXTRA_PARTS.filter(has).map((part) => {
    const entry = entryOf(part)!;
    return {
      key: part,
      label: entry.field.label.trim() || EXTRA_LABELS[part],
      value: shown(part),
      maxLength: "maxLength" in entry.field ? entry.field.maxLength : undefined,
    };
  });

  // L'obligation portée par la ligne unique est celle de la voie (souvent le
  // seul champ obligatoire du bloc), à défaut celle de la commune.
  const requiredEntry = entryOf("voie") ?? entryOf("ville");

  return (
    <AddressField
      id="socle-lieu-intervention"
      label="Adresse du lieu d'intervention"
      required={requiredEntry?.field.required ?? false}
      hint="Commencez à taper : les adresses du référentiel national sont proposées."
      value={{ line, postcode: shown("code_postal"), city: shown("ville") }}
      onChange={(next, suggestion) => {
        if (suggestion) {
          const parts = toInterventionParts(suggestion);
          setTyped(null);
          applyStreet(parts);
          set("code_postal", parts.code_postal);
          set("ville", parts.ville);
          return;
        }
        setTyped(next.line);
        applyStreet(splitStreetLine(next.line));
        set("code_postal", next.postcode);
        set("ville", next.city);
      }}
      extras={extras}
      onExtraChange={(key, value) => set(key as AddressPart, value)}
    />
  );
}
