import { describe, expect, it } from "vitest";
import {
  generateTaskToken,
  hashTaskToken,
  isValidTaskEmail,
  isWellFormedTaskToken,
  normalizeCompletionNote,
  taskMailSubject,
  TASK_COMPLETION_NOTE_MAX,
} from "../../../supabase/functions/_shared/actionTask";
import { taskAssigneeLabel } from "@/lib/action-task";
import { describeCourierEvent } from "@/lib/courier-history";
import { buildTicketsBlock } from "../../../supabase/functions/draft-reply/logic";
import { notificationPath, pushMessage } from "../../../supabase/functions/_shared/push/message";

// Tâches : action interne affectée, close depuis un lien à jeton reçu par mail.

describe("jeton du lien de tâche", () => {
  it("32 octets en base64url : 43 caractères, sans bourrage, tous différents", () => {
    const tokens = Array.from({ length: 50 }, generateTaskToken);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isWellFormedTaskToken(t)).toBe(true);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("refuse ce qui ne peut pas être un jeton, avant toute requête", () => {
    expect(isWellFormedTaskToken("")).toBe(false);
    expect(isWellFormedTaskToken("abc")).toBe(false);
    expect(isWellFormedTaskToken("a".repeat(42) + "=")).toBe(false);
    expect(isWellFormedTaskToken(null)).toBe(false);
    expect(isWellFormedTaskToken({})).toBe(false);
  });

  it("seul un hash SHA-256 hexadécimal est stocké, stable pour un même jeton", async () => {
    const t = generateTaskToken();
    const h = await hashTaskToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashTaskToken(t)).toBe(h);
    expect(h).not.toContain(t);
    expect(await hashTaskToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("saisie d'une tâche", () => {
  it("valide l'adresse de l'agent affecté", () => {
    expect(isValidTaskEmail("agent@mairie.fr")).toBe(true);
    expect(isValidTaskEmail("  agent@mairie.fr ")).toBe(true);
    expect(isValidTaskEmail("agent@mairie")).toBe(false);
    expect(isValidTaskEmail("agent mairie.fr")).toBe(false);
    expect(isValidTaskEmail("")).toBe(false);
    expect(isValidTaskEmail(null)).toBe(false);
  });

  it("note de clôture : vide → null, bornée à la limite", () => {
    expect(normalizeCompletionNote("   ")).toBeNull();
    expect(normalizeCompletionNote(42)).toBeNull();
    expect(normalizeCompletionNote(" fait ")).toBe("fait");
    expect(normalizeCompletionNote("x".repeat(5000))).toHaveLength(TASK_COMPLETION_NOTE_MAX);
  });

  it("libellé de l'affecté : nom, sinon adresse", () => {
    expect(taskAssigneeLabel({ assignee_name: "Léa Martin", assignee_email: "lea@m.fr" })).toBe("Léa Martin");
    expect(taskAssigneeLabel({ assignee_name: " ", assignee_email: "lea@m.fr" })).toBe("lea@m.fr");
    expect(taskAssigneeLabel({ assignee_name: null, assignee_email: null })).toBe("—");
  });

  it("objet du mail : l'intitulé de la tâche, jamais l'objet du courrier", () => {
    expect(taskMailSubject("notify", "Vérifier le trottoir")).toBe("Tâche à réaliser : Vérifier le trottoir");
    expect(taskMailSubject("remind", "Vérifier le trottoir")).toBe("Relance — tâche : Vérifier le trottoir");
  });
});

describe("historique du courrier", () => {
  it("raconte la clôture depuis le lien du mail", () => {
    const e = describeCourierEvent("task_completed", {
      title: "Vérifier le trottoir",
      via: "lien",
      assignee_name: "Léa Martin",
      note: "Réparé",
    });
    expect(e.title).toBe("Tâche terminée");
    expect(e.detail).toBe("« Vérifier le trottoir » · par Léa Martin, depuis le lien du mail · « Réparé »");
  });

  it("création et relance nomment l'affecté", () => {
    expect(describeCourierEvent("task_created", { title: "T", assignee_name: "Léa" })).toEqual({
      title: "Tâche créée",
      detail: "« T » → Léa",
    });
    expect(describeCourierEvent("task_reminded", { title: "T" }).title).toBe("Tâche relancée");
    expect(describeCourierEvent("task_reopened", { title: "T" }).title).toBe("Tâche rouverte");
  });
});

describe("contexte IA du brouillon de réponse", () => {
  it("une tâche se dit interne, avec son avancement, sans référence", () => {
    const block = buildTicketsBlock([
      { kind: "tache", title: "Vérifier le trottoir", description: "Rue des Lilas", status: "open" },
      { kind: "tache", title: "Élaguer", status: "done" },
    ]);
    expect(block).toContain("- Tâche interne : Vérifier le trottoir : Rue des Lilas [en cours]");
    expect(block).toContain("- Tâche interne : Élaguer [réalisée]");
    expect(block).not.toContain("référence");
  });
});

describe("notifications des tâches", () => {
  it("ouvrent l'onglet Actions liées du courrier", () => {
    expect(notificationPath("task_assigned", "c1")).toBe("/courrier/c1?tab=actions");
    expect(notificationPath("task_completed", "c1")).toBe("/courrier/c1?tab=actions");
  });

  it("titre de la carte push et préfixe retiré du corps", () => {
    const m = pushMessage({
      type: "task_assigned",
      title: "Tâche affectée : Vérifier le trottoir",
      resourceId: "c1",
      organizationName: "Ville",
      appUrl: "https://clara.edilumen.fr",
    });
    expect(m.title).toBe("Tâche affectée · Ville");
    expect(m.body).toBe("Vérifier le trottoir");
  });
});
