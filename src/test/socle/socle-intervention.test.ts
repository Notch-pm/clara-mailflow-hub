import { describe, expect, it } from "vitest";
import { parseFormSchema, type SocleFormSchema } from "@/lib/socle-form";
import {
  fitStreetParts,
  interventionBlock,
  interventionFields,
  optionValueFor,
  type AddressPart,
} from "@/lib/socle-intervention";

// Le bloc « Lieu d'intervention » est une SECTION ORDINAIRE du form_schema : le
// contrat n'a pas de type dédié. On le reconnaît par ses clés machine, puis par
// le titre de la section et les libellés — et jamais pour décider autre chose
// qu'un affichage.

function schemaOf(content: unknown[]): SocleFormSchema {
  return parseFormSchema({ version: 1, content });
}

const BLOC_SOCLE = [
  {
    id: "s-lieu",
    kind: "section",
    title: "Lieu d'intervention",
    fields: [
      { id: "f1", key: "intervention_numero", label: "Numéro", type: "text" },
      {
        id: "f2",
        key: "intervention_btq",
        label: "BTQ",
        type: "select",
        options: [
          { value: "bis", label: "Bis" },
          { value: "ter", label: "Ter" },
        ],
      },
      { id: "f3", key: "intervention_voie", label: "Voie", type: "text", required: true },
      { id: "f4", key: "intervention_code_postal", label: "Code postal", type: "text" },
      { id: "f5", key: "intervention_ville", label: "Ville", type: "text" },
      { id: "f6", key: "intervention_complement", label: "Complément d'adresse", type: "text" },
    ],
  },
];

describe("reconnaissance du bloc d'adresse", () => {
  it("reconnaît le bloc par ses clés machine", () => {
    const found = interventionFields(schemaOf(BLOC_SOCLE))!;
    expect(found.get("numero")?.field.id).toBe("f1");
    expect(found.get("voie")?.field.id).toBe("f3");
    expect(found.get("ville")?.field.id).toBe("f5");
    expect(found.get("complement")?.field.id).toBe("f6");
  });

  it("retombe sur les libellés quand les clés ont été renommées dans le référentiel", () => {
    const found = interventionFields(
      schemaOf([
        {
          id: "s",
          kind: "section",
          title: "Lieu d'intervention",
          fields: [
            { id: "a", key: "champ_1", label: "Numéro", type: "text" },
            { id: "b", key: "champ_2", label: "Rue", type: "text" },
            { id: "c", key: "champ_3", label: "Commune", type: "text" },
          ],
        },
      ]),
    )!;
    expect(found.get("numero")?.field.id).toBe("a");
    expect(found.get("voie")?.field.id).toBe("b");
    expect(found.get("ville")?.field.id).toBe("c");
  });

  it("ne voit pas d'adresse là où il n'y en a pas", () => {
    expect(
      interventionFields(
        schemaOf([{ id: "x", key: "urgence", label: "Urgence", type: "text" }]),
      ),
    ).toBeNull();
  });

  it("renonce à l'assistance si le bloc déborde de sa section", () => {
    // Un champ du bloc posé hors de la section serait masqué sans être
    // remplacé : on perdrait une question que la démarche pose.
    const schema = schemaOf([
      ...BLOC_SOCLE,
      { id: "f7", key: "intervention_batiment", label: "Bâtiment", type: "text" },
    ]);
    expect(interventionFields(schema)).not.toBeNull();
    expect(interventionBlock(schema)).toBeNull();
  });

  it("liste les champs que le bloc rend, pour ne pas les répéter", () => {
    const block = interventionBlock(schemaOf(BLOC_SOCLE))!;
    expect(block.section.title).toBe("Lieu d'intervention");
    expect([...block.ids].sort()).toEqual(["f1", "f2", "f3", "f4", "f5", "f6"]);
  });
});

describe("répartition d'une ligne sur les champs que le bloc porte", () => {
  const allParts = (p: AddressPart) => ["numero", "btq", "voie"].includes(p);
  const btqOptions = (text: string) => (["bis", "ter"].includes(text.toLowerCase()) ? text.toLowerCase() : null);

  it("place numéro, BTQ et voie quand les trois champs existent", () => {
    expect(fitStreetParts({ numero: "10", btq: "bis", voie: "Avenue de Frémeur" }, allParts, btqOptions))
      .toEqual({ numero: "10", btq: "bis", voie: "Avenue de Frémeur" });
  });

  it("verse dans la voie ce qu'aucun champ ne peut porter", () => {
    // BTQ « B » que la liste fermée du référentiel ne connaît pas : il rejoint
    // la voie plutôt que d'être perdu ou refusé au dépôt.
    expect(fitStreetParts({ numero: "12", btq: "B", voie: "rue des Lilas" }, allParts, btqOptions))
      .toEqual({ numero: "12", btq: "", voie: "B rue des Lilas" });

    // Démarche sans champ « numéro » : l'adresse reste entière dans la voie.
    const sansNumero = (p: AddressPart) => p === "voie";
    expect(fitStreetParts({ numero: "12", btq: "bis", voie: "rue des Lilas" }, sansNumero, btqOptions))
      .toEqual({ numero: "", btq: "", voie: "12 bis rue des Lilas" });
  });
});

describe("valeur d'option pour un texte libre", () => {
  const btq = {
    id: "f2",
    key: "intervention_btq",
    label: "BTQ",
    type: "select" as const,
    options: [{ value: "bis", label: "Bis" }],
    maxFiles: 1,
    acceptedFormats: [],
  };

  it("rapproche sans tenir compte de la casse ni des accents", () => {
    expect(optionValueFor(btq as never, "BIS")).toBe("bis");
    expect(optionValueFor(btq as never, "Bis")).toBe("bis");
  });

  it("rend null quand la liste ne sait pas dire ce texte", () => {
    expect(optionValueFor(btq as never, "B")).toBeNull();
  });

  it("laisse passer le texte d'un champ libre", () => {
    const libre = { ...btq, type: "text" as const };
    expect(optionValueFor(libre as never, "B")).toBe("B");
  });
});
