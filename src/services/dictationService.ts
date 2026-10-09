/**
 * Dictée vocale d'un nouveau courrier — accès serveur.
 *
 * L'enregistrement (WAV 16 kHz mono, `src/lib/voice/`) part vers l'edge
 * function `transcribe-dictation`, qui le relaie au guichet IA et rend le
 * texte. Rien n'est conservé, ni ici ni côté serveur.
 */
import { supabase } from "@/integrations/supabase/client";
import { edgeError } from "@/lib/edge-error";

/**
 * La collectivité a-t-elle ouvert la voix ? Miroir du référentiel
 * (`organizations.ai_voice_enabled`, recopié par la synchronisation). Ce n'est
 * qu'un affichage : le serveur relit le drapeau avant chaque transcription.
 */
export async function isDictationEnabled(organizationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("organizations")
    .select("ai_voice_enabled")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data?.ai_voice_enabled === true;
}

/** Une transcription qui n'a rien entendu — pas une panne. */
export class NothingHeardError extends Error {
  constructor() {
    super("Je n'ai rien entendu. Vérifiez le micro et recommencez.");
  }
}

/** Transcrit une dictée. Lève `NothingHeardError` sur un silence. */
export async function transcribeDictation(wav: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", wav, "dictee.wav");
  const { data, error } = await supabase.functions.invoke("transcribe-dictation", { body: form });
  if (error) throw await edgeError(error, "Transcription impossible");
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text) throw new NothingHeardError();
  return text;
}
