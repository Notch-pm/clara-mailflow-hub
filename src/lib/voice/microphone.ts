/**
 * Le micro de la dictée — la plomberie du navigateur. Porté de Nora
 * (`src/features/assistant/voice/devices.ts`), sans le haut-parleur : la dictée
 * ne parle pas.
 *
 * Non testé (aucun micro en CI) : le format est dans
 * `supabase/functions/_shared/dictation.ts`, testé.
 *
 * ⚠️ RIEN N'EST GARDÉ NI ENVOYÉ D'ICI. Le micro rend des trames au fil
 * principal ; c'est `useDictation` qui, la dictée finie, en fait UN fichier WAV
 * et l'envoie — puis l'oublie.
 */
import { RECORDER_PROCESSOR, RECORDER_WORKLET_SOURCE } from "./recorderWorklet";

export interface Microphone {
  /** Fréquence native du contexte — les trames sont à cette fréquence. */
  sampleRate: number;
  /** Reçoit chaque trame de ~20 ms. */
  onFrame: ((frame: Float32Array) => void) | null;
  close(): void;
}

export type MicrophoneOpening =
  | { ok: true; microphone: Microphone }
  /** `denied` : l'utilisateur (ou le site) a refusé ; sinon pas de micro, ou navigateur trop ancien. */
  | { ok: false; denied: boolean };

/**
 * Le navigateur sait-il enregistrer ? Sinon, le bouton n'est pas proposé.
 * ⚠️ `getUserMedia` n'existe qu'en contexte sécurisé (HTTPS ou localhost).
 */
export function dictationSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof window.AudioContext === "function" &&
    typeof window.AudioWorkletNode === "function"
  );
}

/** Contextes où le processeur est déjà chargé : l'enregistrer deux fois est une erreur. */
const workletLoaded = new WeakSet<AudioContext>();

/**
 * Ouvre le micro. ⚠️ Le contexte doit avoir été créé DANS le geste de
 * l'utilisateur (un clic) : c'est ce qui permet à Safari de le démarrer.
 */
export async function openMicrophone(context: AudioContext): Promise<MicrophoneOpening> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Annulation d'écho et réduction de bruit : précieuses dans un bureau
      // d'accueil, une rue, une permanence d'élu.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    return { ok: false, denied: name === "NotAllowedError" || name === "SecurityError" };
  }
  try {
    if (context.state === "suspended") await context.resume();
    if (!workletLoaded.has(context)) {
      const url = URL.createObjectURL(new Blob([RECORDER_WORKLET_SOURCE], { type: "application/javascript" }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      workletLoaded.add(context);
    }
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, RECORDER_PROCESSOR);
    const microphone: Microphone = {
      sampleRate: context.sampleRate,
      onFrame: null,
      close() {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        // Couper les pistes ÉTEINT le témoin du micro du navigateur.
        stream.getTracks().forEach((track) => track.stop());
      },
    };
    node.port.onmessage = (event: MessageEvent<Float32Array>) => microphone.onFrame?.(event.data);
    source.connect(node);
    return { ok: true, microphone };
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    return { ok: false, denied: false };
  }
}

/** Énergie d'une trame (0…1), pour l'indicateur de niveau. */
export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}
