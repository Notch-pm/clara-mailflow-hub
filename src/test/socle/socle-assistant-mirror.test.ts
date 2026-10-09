import { describe, expect, it } from "vitest";
import {
  assistantMirror,
  assistantWarning,
  planAssistantUpdate,
} from "../../../supabase/functions/sync-socle-referentiel/assistant";

describe("miroir de l'assistant IA (dictée vocale)", () => {
  it("la voix s'ouvre sur un true explicite, sous un assistant ouvert", () => {
    expect(assistantMirror({ enabled: true, deposit_enabled: false, voice_enabled: true })).toEqual({
      ai_voice_enabled: true,
    });
  });

  it("⚠️ au doute, fermé : absent, null, forme inattendue, assistant fermé", () => {
    expect(assistantMirror(null).ai_voice_enabled).toBe(false);
    expect(assistantMirror(undefined).ai_voice_enabled).toBe(false);
    expect(assistantMirror({}).ai_voice_enabled).toBe(false);
    expect(assistantMirror({ enabled: true, voice_enabled: "true" as never }).ai_voice_enabled).toBe(false);
    // Le Socle applique déjà le commutateur ; un Socle antérieur pourrait ne pas le faire.
    expect(assistantMirror({ enabled: false, voice_enabled: true }).ai_voice_enabled).toBe(false);
  });

  it("n'écrit que ce qui change", () => {
    const open = { enabled: true, voice_enabled: true };
    expect(planAssistantUpdate({ ai_voice_enabled: true }, open)).toBeNull();
    expect(planAssistantUpdate({ ai_voice_enabled: false }, open)).toEqual({ ai_voice_enabled: true });
    expect(planAssistantUpdate({ ai_voice_enabled: true }, { enabled: false })).toEqual({ ai_voice_enabled: false });
    // Colonne absente de la ligne lue : vaut fermé.
    expect(planAssistantUpdate({}, { enabled: false })).toBeNull();
  });

  it("l'avertissement dit quoi faire", () => {
    expect(assistantWarning("ACCM", 404)).toContain("1.39.0");
    expect(assistantWarning("ACCM", 403)).toContain("« read »");
    expect(assistantWarning("ACCM", 500)).toContain("réponse 500");
  });
});
