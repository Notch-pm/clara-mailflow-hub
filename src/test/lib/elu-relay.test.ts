import { describe, expect, it } from "vitest";
import { relaySubject } from "@/lib/elu-relay";

/** L'élu ne saisit pas d'objet : les listes en ont besoin d'un, lisible. */
describe("relaySubject", () => {
  it("reprend la première ligne non vide, espaces normalisés", () => {
    expect(relaySubject("\n\n  Nid-de-poule   rue des Lilas \nDétails : devant le 12")).toBe(
      "Nid-de-poule rue des Lilas",
    );
  });

  it("coupe une ligne trop longue à un mot entier, avec points de suspension", () => {
    const long = "Demande de rendez-vous avec le maire au sujet de la fermeture de la classe de CP de l'école Jules Ferry";
    const subject = relaySubject(long);
    expect(subject.endsWith("…")).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(91);
    expect(long.startsWith(subject.slice(0, -1))).toBe(true);
    expect(subject.slice(0, -1).endsWith(" ")).toBe(false);
  });

  it("une requête vide donne un objet générique, jamais une chaîne vide", () => {
    expect(relaySubject("   \n  ")).toBe("Demande relayée par un élu");
  });
});
