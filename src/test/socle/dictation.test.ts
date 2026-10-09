import { describe, expect, it } from "vitest";
import {
  DICTATION_SAMPLE_RATE,
  downsample,
  encodeWav,
  isExpectedDictation,
  MAX_DICTATION_BYTES,
  MAX_DICTATION_SECONDS,
  readWav,
} from "../../../supabase/functions/_shared/dictation";
import {
  buildTranscriptionForm,
  FEATURE_DICTATION,
} from "../../../supabase/functions/_shared/socleAiLogic";
import { RECORDER_PROCESSOR, RECORDER_WORKLET_SOURCE } from "@/lib/voice/recorderWorklet";

/** Un WAV PCM arbitraire, pour les cas que l'écran ne produit pas. */
function wav({ sampleRate = 16_000, channels = 1, bits = 16, seconds = 1 } = {}): Uint8Array {
  const byteRate = sampleRate * channels * (bits / 8);
  const dataBytes = Math.round(byteRate * seconds);
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) bytes[o + i] = t.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

describe("le format de la dictée", () => {
  it("encodeWav et readWav sont l'aller-retour l'un de l'autre", () => {
    const samples = new Float32Array(DICTATION_SAMPLE_RATE * 2).fill(0.25);
    const info = readWav(encodeWav(samples));
    expect(info).toEqual({ sampleRate: 16_000, channels: 1, bitsPerSample: 16, seconds: 2 });
    expect(isExpectedDictation(info)).toBe(true);
  });

  it("refuse ce qui n'est pas un WAV PCM", () => {
    expect(readWav(new Uint8Array(10))).toBeNull();
    expect(readWav(new TextEncoder().encode("x".repeat(100)))).toBeNull();
  });

  it("refuse le stéréo, une autre fréquence, un autre échantillonnage", () => {
    expect(isExpectedDictation(readWav(wav({ channels: 2 })))).toBe(false);
    expect(isExpectedDictation(readWav(wav({ sampleRate: 48_000 })))).toBe(false);
    expect(isExpectedDictation(readWav(wav({ bits: 8 })))).toBe(false);
  });

  it("refuse au-delà de la durée maximale, avec une demi-seconde de tolérance", () => {
    expect(isExpectedDictation(readWav(wav({ seconds: MAX_DICTATION_SECONDS + 0.4 })))).toBe(true);
    expect(isExpectedDictation(readWav(wav({ seconds: MAX_DICTATION_SECONDS + 1 })))).toBe(false);
  });

  it("refuse un enregistrement vide", () => {
    expect(isExpectedDictation(readWav(wav({ seconds: 0 })))).toBe(false);
  });

  it("⚠️ la borne tient sous les 10 Mo et les 300 s du guichet", () => {
    expect(MAX_DICTATION_SECONDS).toBeLessThan(300);
    expect(MAX_DICTATION_BYTES + 64 * 1024).toBeLessThan(10 * 1024 * 1024);
  });

  it("downsample ramène 48 kHz à 16 kHz en moyennant", () => {
    const input = Float32Array.from({ length: 960 }, (_, i) => (i % 3 === 0 ? 0.3 : 0));
    const out = downsample(input, 48_000);
    expect(out.length).toBe(320);
    expect(out[0]).toBeCloseTo(0.1);
    expect(() => downsample(input, 8_000)).toThrow();
  });
});

describe("le corps multipart de /v1/transcriptions", () => {
  const ctx = {
    socleOrgId: "00000000-0000-0000-0000-000000000001",
    feature: FEATURE_DICTATION,
    actorId: "00000000-0000-0000-0000-000000000002",
    reference: null,
  };

  it("porte le fichier, la durée, la langue, la fonctionnalité et l'agent — rien d'autre", () => {
    const audio = encodeWav(new Float32Array(16_000));
    const form = buildTranscriptionForm({ ctx, audio, durationMs: 1000.4, language: "fr" });
    expect([...form.keys()].sort()).toEqual(["actor_id", "duration_ms", "feature", "file", "language"]);
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/wav");
    expect(file.size).toBe(audio.length);
    expect(form.get("duration_ms")).toBe("1000");
    expect(form.get("feature")).toBe("dictee-courrier");
  });

  it("⚠️ la référence s'écrit à plat, jamais en objet ; l'absence d'agent ne s'écrit pas", () => {
    const form = buildTranscriptionForm({
      ctx: { ...ctx, actorId: null, reference: { kind: "courier", id: "00000000-0000-0000-0000-000000000003" } },
      audio: new Uint8Array(44),
      durationMs: 0,
    });
    expect(form.get("reference_kind")).toBe("courier");
    expect(form.get("reference_id")).toBe("00000000-0000-0000-0000-000000000003");
    expect(form.has("reference")).toBe(false);
    expect(form.has("actor_id")).toBe(false);
    expect(form.has("language")).toBe(false);
    // Le guichet exige au moins 1 ms.
    expect(form.get("duration_ms")).toBe("1");
  });

  it("n'envoie que la vue, pas le tampon entier qui la porte", () => {
    const big = new Uint8Array(1000);
    const form = buildTranscriptionForm({ ctx, audio: big.subarray(100, 200), durationMs: 1 });
    expect((form.get("file") as File).size).toBe(100);
  });
});

/**
 * Le processeur est du TEXTE, exécuté par le navigateur dans un worklet : ni le
 * typage ni le build ne le vérifient. On l'exécute dans un worklet simulé.
 */
function loadWorklet(sampleRate: number) {
  const posted: Float32Array[] = [];
  let registered: { name: string; Processor: new () => { process(inputs: Float32Array[][]): boolean } } | null = null;
  class AudioWorkletProcessor {
    port = { postMessage: (frame: Float32Array) => posted.push(frame) };
  }
  new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor", RECORDER_WORKLET_SOURCE)(
    AudioWorkletProcessor,
    sampleRate,
    (name: string, Processor: never) => (registered = { name, Processor }),
  );
  return { posted, registered: registered! };
}

describe("le processeur du micro", () => {
  it("s'enregistre sous le nom attendu", () => {
    expect(loadWorklet(48_000).registered.name).toBe(RECORDER_PROCESSOR);
  });

  it("regroupe les blocs de 128 échantillons en trames de 20 ms, sans en perdre un", () => {
    const { posted, registered } = loadWorklet(48_000);
    const processor = new registered.Processor();
    for (let block = 0; block < 30; block++) {
      const samples = Float32Array.from({ length: 128 }, (_, i) => block * 128 + i);
      expect(processor.process([[samples]])).toBe(true);
    }
    expect(posted.map((frame) => frame.length)).toEqual([960, 960, 960, 960]);
    expect(posted[1][0]).toBe(960);
    expect(posted[3][959]).toBe(3839);
  });

  it("ignore un bloc sans canal (micro pas encore branché)", () => {
    const { posted, registered } = loadWorklet(44_100);
    const processor = new registered.Processor();
    expect(processor.process([[]])).toBe(true);
    expect(processor.process([])).toBe(true);
    expect(posted).toEqual([]);
  });
});
