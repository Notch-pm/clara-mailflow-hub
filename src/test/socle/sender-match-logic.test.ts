import { describe, it, expect } from "vitest";
import {
  buildSenderMatchPayload,
  cleanCivility,
  isSameSender,
  normalizePhone,
  resolveSenderMatch,
  type MatchCandidate,
  type MatchableContact,
} from "../../../supabase/functions/_shared/senderMatchLogic";

function contact(over: Partial<MatchableContact> = {}): MatchableContact {
  return {
    id: "c1",
    first_name: "Madeleine",
    last_name: "Lefèvre",
    usage_name: null,
    display_name: "Lefèvre Madeleine",
    email: "m.lefevre@example.fr",
    mobile_phone: "06 12 34 56 78",
    landline_phone: null,
    ...over,
  };
}

function candidate(reasons: string[], score: number, over: Partial<MatchableContact> = {}): MatchCandidate {
  return { contact: contact(over), reasons, score };
}

const alain = { id: "alain", first_name: "Alain", display_name: "Lefevre Alain", email: "alain@example.fr" };

describe("buildSenderMatchPayload", () => {
  it("interroge sur nom ET prénom, jamais le nom de famille seul", () => {
    expect(buildSenderMatchPayload({ first_name: "Madeleine", last_name: "Lefevre" })).toEqual({
      contact_type: "personne",
      limit: 5,
      first_name: "Madeleine",
      last_name: "Lefevre",
    });
  });

  it("ajoute email et téléphone quand ils sont exploitables", () => {
    const p = buildSenderMatchPayload({ last_name: "Lefevre", email: " M.Lefevre@Example.fr ", phone: "06 12 34 56 78" });
    expect(p).toMatchObject({ email: "m.lefevre@example.fr", phones: ["06 12 34 56 78"] });
  });

  it("renonce quand rien ne rapproche (un prénom seul ferait répondre 400 au Socle)", () => {
    expect(buildSenderMatchPayload({ first_name: "Madeleine" })).toBeNull();
    expect(buildSenderMatchPayload({ phone: "12" })).toBeNull();
    expect(buildSenderMatchPayload({})).toBeNull();
  });
});

describe("resolveSenderMatch", () => {
  const madeleine = { first_name: "Madeleine", last_name: "Lefevre" };

  it("Madeleine Lefevre ne se voit pas proposer Alain Lefevre", () => {
    // Le Socle ne renvoie pas un homonyme de nom de famille au prénom différent ;
    // et même s'il le renvoyait sans motif fort, il ne serait pas sélectionné.
    expect(resolveSenderMatch(madeleine, []).status).toBe("none");
    expect(resolveSenderMatch(madeleine, null).status).toBe("none");
  });

  it("sélectionne sur nom+prénom identiques, accents ignorés", () => {
    const r = resolveSenderMatch(madeleine, [candidate(["name_exact"], 60)]);
    expect(r.status).toBe("matched");
    expect(r.contact?.id).toBe("c1");
    expect(r.conflicts).toEqual([]);
  });

  it("sélectionne sur l'email et sur le téléphone", () => {
    expect(resolveSenderMatch({ ...madeleine, email: "m.lefevre@example.fr" }, [candidate(["email", "name_exact"], 160)]).status).toBe("matched");
    expect(resolveSenderMatch({ ...madeleine, phone: "+33 6 12 34 56 78" }, [candidate(["phone", "name_exact"], 140)]).status).toBe("matched");
  });

  it("alerte quand l'email du courrier diffère de celui de la fiche", () => {
    const r = resolveSenderMatch({ ...madeleine, email: "madeleine@autre.fr" }, [candidate(["name_exact"], 60)]);
    expect(r.status).toBe("matched");
    expect(r.conflicts).toEqual(["email"]);
  });

  it("alerte quand le téléphone diffère, mais pas pour un simple écart de format", () => {
    expect(resolveSenderMatch({ ...madeleine, phone: "01 44 55 66 77" }, [candidate(["name_exact"], 60)]).conflicts).toEqual(["phone"]);
    expect(resolveSenderMatch({ ...madeleine, phone: "+33612345678" }, [candidate(["name_exact"], 60)]).conflicts).toEqual([]);
  });

  it("alerte quand un téléphone partagé désigne quelqu'un d'autre", () => {
    const r = resolveSenderMatch({ ...madeleine, phone: "06 12 34 56 78" }, [candidate(["phone"], 80, alain)]);
    expect(r.status).toBe("matched");
    expect(r.conflicts).toEqual(["name"]);
  });

  it("propose sans sélectionner un nom seulement proche", () => {
    const r = resolveSenderMatch({ first_name: "Madeleyne", last_name: "Lefevre" }, [candidate(["name_similar"], 30)]);
    expect(r.status).toBe("suggested");
    expect(r.contact?.id).toBe("c1");
  });

  it("préfère un motif fort à un nom proche mieux classé", () => {
    const r = resolveSenderMatch(madeleine, [
      candidate(["name_similar"], 90, { id: "proche" }),
      candidate(["name_exact"], 60, { id: "exact" }),
    ]);
    expect(r.contact?.id).toBe("exact");
  });
});

describe("isSameSender", () => {
  it("reconnaît la même personne par email, téléphone ou nom+prénom", () => {
    expect(isSameSender({ email: "A@x.fr" }, { email: "a@x.fr", last_name: "Autre" })).toBe(true);
    expect(isSameSender({ phone: "06 12 34 56 78" }, { phone: "+33612345678" })).toBe(true);
    expect(isSameSender({ first_name: "Madeleine", last_name: "Lefèvre" }, { first_name: "madeleine", last_name: "LEFEVRE" })).toBe(true);
  });

  it("distingue deux homonymes de nom de famille", () => {
    expect(isSameSender({ first_name: "Madeleine", last_name: "Lefevre" }, { first_name: "Alain", last_name: "Lefevre" })).toBe(false);
  });
});

describe("normalisations", () => {
  it("ramène l'indicatif français au 0 national", () => {
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("0612345678");
    expect(normalizePhone("0033612345678")).toBe("0612345678");
  });

  it("valide la civilité extraite", () => {
    expect(cleanCivility("Madame")).toBe("madame");
    expect(cleanCivility("M.")).toBe("monsieur");
    expect(cleanCivility("")).toBeNull();
    expect(cleanCivility("docteur")).toBeNull();
  });
});
