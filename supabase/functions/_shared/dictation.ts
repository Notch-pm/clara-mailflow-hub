/**
 * La DICTÉE d'un courrier — le format de l'enregistrement, écrit une fois ici,
 * lu par le serveur (`transcribe-dictation`) comme par l'écran
 * (`src/lib/voice/`), par chemin relatif (convention Clara, comme
 * `consents/catalog.ts`) : les deux doivent produire et accepter la même chose.
 *
 * Porté du mode dialogue de Nora (`_shared/domain/voice.ts`), allégé : ici, pas
 * de dialogue ni de voix de synthèse — l'agent ou l'élu parle d'une traite, le
 * guichet IA du Socle (`ai-api` 1.4.0, `/v1/transcriptions`) rend le texte, et
 * l'extraction habituelle (`extract-courier-info`) remplit le formulaire.
 *
 * ⚠️ RIEN N'EST GARDÉ, NULLE PART. L'enregistrement vit en mémoire le temps de
 * l'envoyer ; ni Clara ni le Socle ne stockent l'audio ou le texte.
 *
 * Module PUR (aucune API Deno ni navigateur) : testé par Vitest
 * (`src/test/socle/dictation.test.ts`).
 */

/**
 * Durée maximale d'une dictée. Le guichet accepte 300 s et 10 Mo ; 240 s de WAV
 * à 16 kHz font ≈ 7,7 Mo — la marge couvre l'enveloppe multipart et un
 * navigateur qui coupe un tampon trop tard. Une demande dite de vive voix tient
 * largement en quatre minutes.
 */
export const MAX_DICTATION_SECONDS = 240;

/**
 * Le format unique que le navigateur envoie : WAV PCM 16 bits, 16 kHz, mono —
 * celui que le Socle conseille. Un seul format pour tous les navigateurs
 * (Safari iOS n'enregistre pas en Opus), dont la durée se lit dans l'en-tête :
 * c'est ce qui permet de refuser un enregistrement trop long sans le décoder.
 * ≈ 32 Ko par seconde.
 */
export const DICTATION_SAMPLE_RATE = 16_000;
export const DICTATION_MIME_TYPE = "audio/wav";
/** En-tête canonique + la durée maximale de PCM 16 bits mono. */
export const MAX_DICTATION_BYTES = 44 + MAX_DICTATION_SECONDS * DICTATION_SAMPLE_RATE * 2;
/** Langue de la dictée : Clara ne sert que des collectivités françaises. */
export const DICTATION_LANGUAGE = "fr";

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Durée des données réellement présentes, en secondes. */
  seconds: number;
}

/**
 * Lit l'en-tête d'un WAV PCM. `null` pour tout ce qui n'en est pas un — le
 * serveur refuse alors l'enregistrement, sans l'envoyer à personne.
 */
export function readWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; byteRate: number; bitsPerSample: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 24 <= bytes.length) {
      format = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        byteRate: view.getUint32(offset + 16, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    }
    if (id === "data") {
      if (format === null || format.audioFormat !== 1 || format.byteRate === 0) return null;
      const available = Math.min(size, bytes.length - offset - 8);
      return {
        sampleRate: format.sampleRate,
        channels: format.channels,
        bitsPerSample: format.bitsPerSample,
        seconds: available / format.byteRate,
      };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** Le format attendu, exactement — ce que l'écran de Clara produit. */
export function isExpectedDictation(info: WavInfo | null): info is WavInfo {
  return (
    info !== null &&
    info.sampleRate === DICTATION_SAMPLE_RATE &&
    info.channels === 1 &&
    info.bitsPerSample === 16 &&
    info.seconds > 0 &&
    // Une demi-seconde de tolérance : le navigateur coupe à la borne, à un
    // tampon près.
    info.seconds <= MAX_DICTATION_SECONDS + 0.5
  );
}

/**
 * Écrit un WAV PCM 16 bits mono à partir d'échantillons flottants (−1…1) —
 * côté navigateur. Le pendant exact de `readWav`, testé avec lui.
 */
export function encodeWav(samples: Float32Array, sampleRate = DICTATION_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/**
 * Ramène des échantillons à `DICTATION_SAMPLE_RATE` — côté navigateur.
 *
 * ⚠️ On ne demande PAS au navigateur un `AudioContext` à 16 kHz : Firefox
 * refuse de brancher le micro (à sa fréquence propre, 44,1 ou 48 kHz) sur un
 * contexte d'une autre fréquence. On capte à la fréquence native, et on réduit
 * ici : chaque échantillon de sortie est la MOYENNE de ceux qu'il recouvre —
 * un filtre passe-bas grossier, suffisant pour la voix.
 */
export function downsample(input: Float32Array, fromRate: number, toRate = DICTATION_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input.slice();
  if (fromRate < toRate || fromRate <= 0) throw new Error("downsample : fréquence d'entrée inattendue.");
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}
