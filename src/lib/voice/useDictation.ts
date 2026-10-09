/**
 * La dictée d'un courrier : micro → WAV 16 kHz mono → transcription.
 *
 * Pas de détection de fin de parole : c'est une dictée LIBRE, l'utilisateur
 * arrête lui-même (ou la borne de `MAX_DICTATION_SECONDS` le fait pour lui).
 * Le format est dans `supabase/functions/_shared/dictation.ts`, partagé avec
 * le serveur qui le recontrôle.
 *
 * ⚠️ RIEN N'EST GARDÉ. L'enregistrement vit en mémoire le temps de l'envoyer,
 * puis est oublié ; ni `localStorage`, ni journal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  downsample,
  encodeWav,
  MAX_DICTATION_SECONDS,
} from "../../../supabase/functions/_shared/dictation";
import { transcribeDictation } from "@/services/dictationService";
import { dictationSupported, openMicrophone, rms, type Microphone } from "./microphone";

export type DictationPhase = "idle" | "recording" | "transcribing";

export interface UseDictation {
  phase: DictationPhase;
  /** Secondes écoulées depuis le début de l'enregistrement. */
  elapsed: number;
  /** Niveau du micro (0…1) pour l'indicateur. */
  level: number;
  /**
   * Le micro est réellement ouvert. Faux pendant `recording` tant que le
   * navigateur attend l'autorisation : l'écran ne doit pas dire « je vous
   * écoute » à quelqu'un qui n'a pas encore répondu à la demande d'accès.
   */
  listening: boolean;
  /** Dernier échec, en français, ou `null`. */
  error: string | null;
  /** Le navigateur sait-il enregistrer ? Sinon, ne pas proposer le bouton. */
  supported: boolean;
  /** À appeler DANS le clic : Safari n'ouvre l'audio que sur un geste. */
  start: () => void;
  /** Termine et transcrit. */
  stop: () => void;
  /** Abandonne sans rien envoyer. */
  cancel: () => void;
}

export { MAX_DICTATION_SECONDS };

export function useDictation(onTranscript: (text: string) => void): UseDictation {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = dictationSupported();

  const contextRef = useRef<AudioContext | null>(null);
  const microphoneRef = useRef<Microphone | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const samplesRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  // Incrémenté à chaque arrêt : une ouverture de micro ou une réponse tardive ne touche plus rien.
  const generationRef = useRef(0);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const stopRef = useRef<() => void>(() => {});

  const release = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    microphoneRef.current?.close();
    microphoneRef.current = null;
    setLevel(0);
    setListening(false);
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    release();
    chunksRef.current = [];
    samplesRef.current = 0;
    setPhase("idle");
    setElapsed(0);
  }, [release]);

  const start = useCallback(() => {
    if (!supported) return;
    const generation = ++generationRef.current;
    setError(null);
    setElapsed(0);
    chunksRef.current = [];
    samplesRef.current = 0;
    // ⚠️ DANS LE GESTE : Safari ne démarre un contexte audio que sur un clic.
    if (contextRef.current === null) contextRef.current = new AudioContext();
    const context = contextRef.current;
    void context.resume().catch(() => {});
    setPhase("recording");

    void openMicrophone(context).then((opening) => {
      if (generation !== generationRef.current) {
        if ("microphone" in opening) opening.microphone.close();
        return;
      }
      // `in` plutôt que `!opening.ok` : sans `strictNullChecks`, TypeScript ne
      // rétrécit pas une union sur un discriminant booléen.
      if ("denied" in opening) {
        setPhase("idle");
        setError(
          opening.denied
            ? "L'accès au micro a été refusé. Autorisez-le dans les réglages du navigateur, puis recommencez."
            : "Aucun micro n'est disponible sur cet appareil.",
        );
        return;
      }
      const microphone = opening.microphone;
      microphoneRef.current = microphone;
      setListening(true);
      const startedAt = Date.now();
      let lastLevelAt = 0;
      microphone.onFrame = (frame) => {
        // Réduit à 16 kHz trame par trame : quatre minutes à 48 kHz en
        // flottants pèseraient trois fois plus en mémoire.
        const reduced = downsample(frame, microphone.sampleRate);
        chunksRef.current.push(reduced);
        samplesRef.current += reduced.length;
        const now = Date.now();
        if (now - lastLevelAt > 100) {
          lastLevelAt = now;
          setLevel(Math.min(1, rms(frame) * 4));
        }
      };
      timerRef.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        setElapsed(seconds);
        // La borne : on arrête de soi-même plutôt que de se faire refuser.
        if (seconds >= MAX_DICTATION_SECONDS) stopRef.current();
      }, 250);
    });
  }, [supported]);

  const stop = useCallback(() => {
    const generation = ++generationRef.current;
    release();
    const chunks = chunksRef.current;
    const total = samplesRef.current;
    chunksRef.current = [];
    samplesRef.current = 0;
    if (total === 0) {
      setPhase("idle");
      return;
    }
    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const wav = new Blob([encodeWav(samples)], { type: "audio/wav" });
    setPhase("transcribing");
    transcribeDictation(wav)
      .then((text) => {
        if (generation !== generationRef.current) return;
        setPhase("idle");
        onTranscriptRef.current(text);
      })
      .catch((e: unknown) => {
        if (generation !== generationRef.current) return;
        setPhase("idle");
        setError(e instanceof Error ? e.message : "Transcription impossible.");
      });
  }, [release]);
  stopRef.current = stop;

  // Quitter l'écran éteint le micro et ferme le contexte audio.
  useEffect(
    () => () => {
      generationRef.current += 1;
      release();
      void contextRef.current?.close().catch(() => {});
      contextRef.current = null;
    },
    [release],
  );

  return { phase, elapsed, level, listening, error, supported, start, stop, cancel };
}
