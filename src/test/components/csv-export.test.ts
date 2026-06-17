import { describe, it, expect } from "vitest";
import { buildCsv, escapeCsvValue } from "@/components/data-table/csv-export";

describe("csv-export", () => {
  describe("escapeCsvValue", () => {
    it("retourne la valeur telle quelle si elle ne contient aucun caractère spécial", () => {
      expect(escapeCsvValue("Dupont", ";")).toBe("Dupont");
    });

    it("retourne une chaîne vide pour null/undefined", () => {
      expect(escapeCsvValue(null, ";")).toBe("");
      expect(escapeCsvValue(undefined, ";")).toBe("");
    });

    it("convertit les valeurs non-string en string", () => {
      expect(escapeCsvValue(42, ";")).toBe("42");
      expect(escapeCsvValue(true, ";")).toBe("true");
    });

    it("entoure de guillemets une valeur contenant le délimiteur", () => {
      expect(escapeCsvValue("Dupont; Jean", ";")).toBe('"Dupont; Jean"');
    });

    it("entoure de guillemets et double les guillemets internes", () => {
      expect(escapeCsvValue('Le "Grand" Café', ";")).toBe('"Le ""Grand"" Café"');
    });

    it("entoure de guillemets une valeur contenant un retour à la ligne", () => {
      expect(escapeCsvValue("ligne1\nligne2", ";")).toBe('"ligne1\nligne2"');
    });

    it("n'échappe pas une virgule si le délimiteur est le point-virgule", () => {
      expect(escapeCsvValue("Dupont, Jean", ";")).toBe("Dupont, Jean");
    });
  });

  describe("buildCsv", () => {
    interface Row {
      name: string;
      email: string | null;
    }

    const columns = [
      { header: "Nom", accessor: (r: Row) => r.name },
      { header: "Email", accessor: (r: Row) => r.email },
    ];

    it("génère la ligne d'en-tête suivie d'une ligne par enregistrement", () => {
      const rows: Row[] = [
        { name: "Dupont", email: "dupont@example.com" },
        { name: "Martin", email: null },
      ];
      const csv = buildCsv(rows, columns);
      expect(csv).toBe("Nom;Email\r\nDupont;dupont@example.com\r\nMartin;");
    });

    it("respecte l'ordre des colonnes fournies", () => {
      const reordered = [columns[1], columns[0]];
      const csv = buildCsv([{ name: "Dupont", email: "dupont@example.com" }], reordered);
      expect(csv).toBe("Email;Nom\r\ndupont@example.com;Dupont");
    });

    it("génère seulement l'en-tête si la liste de lignes est vide", () => {
      expect(buildCsv([], columns)).toBe("Nom;Email");
    });

    it("échappe les valeurs contenant le délimiteur dans les lignes générées", () => {
      const csv = buildCsv([{ name: "Dupont; Jean", email: "x@y.com" }], columns);
      expect(csv).toBe('Nom;Email\r\n"Dupont; Jean";x@y.com');
    });
  });
});
