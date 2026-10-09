import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, FileText, Loader2, Mic, Paperclip, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluUsagerPicker } from "@/components/elu/EluUsagerPicker";
import DictationRecorder from "@/components/courier/DictationRecorder";
import { useDictationEnabled } from "@/hooks/useDictationEnabled";
import { extractCourierInfo, type SuggestedSender } from "@/services/courierAnalysisService";
import { useOrganization } from "@/contexts/OrganizationContext";
import { cn } from "@/lib/utils";
import { createEluRelayedCourier } from "@/services/eluRelayService";
import type { SocleContact } from "@/services/socleContactService";
import { storage } from "@/services/storageService";

/** 10 Mo : le plafond par défaut de `storage-documents`, tant que celui de l'organisation n'est pas lu. */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

interface PendingFile {
  id: string;
  file: File;
  /** Aperçu d'une photo (URL locale, révoquée au retrait). */
  preview: string | null;
}

/** Titre de champ, avec la mention obligatoire / facultatif en toutes lettres. */
function FieldTitle({ htmlFor, children, required }: { htmlFor?: string; children: React.ReactNode; required?: boolean }) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <Tag htmlFor={htmlFor} className="flex items-baseline gap-2 text-[19px] font-bold text-foreground">
      {children}
      <span className="text-sm font-semibold text-muted-foreground">{required ? "obligatoire" : "facultatif"}</span>
    </Tag>
  );
}

/**
 * Un élu relaie la demande d'un usager (permanence, marché, rencontre) : canal
 * « Relayé élu ». Quatre champs seulement — l'usager, sa requête, des pièces,
 * un commentaire interne. Le reste (objet, organisation, tags) revient au
 * service courrier, dans la boîte aux lettres, aidé par l'analyse.
 *
 * À la validation, on affiche la fiche du courrier créé, en `replace` : le
 * retour ne doit pas rouvrir un formulaire déjà envoyé.
 */
export default function EluNouveauCourrier() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [usager, setUsager] = useState<SocleContact | null>(null);
  const [request, setRequest] = useState("");
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [submitted, setSubmitted] = useState(false);
  // Dictée : la transcription (relue), et l'usager qu'elle nomme sans fiche
  // reconnue d'office — la recherche et la création partent de lui.
  const dictationEnabled = useDictationEnabled(organizationId);
  const [dictating, setDictating] = useState(false);
  const [dictation, setDictation] = useState("");
  const [usagerSuggestion, setUsagerSuggestion] = useState<SuggestedSender | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: maxFileSize = DEFAULT_MAX_FILE_SIZE } = useQuery({
    queryKey: ["max-file-size", organizationId],
    queryFn: () => storage.getMaxFileSize(organizationId!),
    enabled: !!organizationId,
    staleTime: Infinity,
  });

  // Les aperçus sont des URL locales : libérées quand l'écran se ferme.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(
    () => () => {
      for (const f of filesRef.current) if (f.preview) URL.revokeObjectURL(f.preview);
    },
    [],
  );

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted: PendingFile[] = [];
    for (const file of Array.from(list)) {
      // Refusé ici plutôt qu'au dépôt : l'élu le sait avant d'envoyer, et
      // peut reprendre une photo moins lourde.
      if (file.size > maxFileSize) {
        toast.error(`${file.name} dépasse ${formatSize(maxFileSize)}.`);
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      });
    }
    setFiles((prev) => [...prev, ...accepted]);
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const gone = prev.find((f) => f.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((f) => f.id !== id);
    });
  }

  const errors = useMemo(
    () => ({
      usager: usager ? null : "Choisissez ou créez l'usager.",
      request: request.trim() ? null : "Décrivez la requête de l'usager.",
    }),
    [usager, request],
  );
  const hasErrors = !!errors.usager || !!errors.request;

  /**
   * La dictée remplit ce qu'elle peut : la requête (si elle est vide) et
   * l'usager — sélectionné s'il est reconnu sans ambiguïté, sinon proposé à la
   * recherche. Rien n'est envoyé : l'élu relit, complète et valide.
   */
  const fill = useMutation({
    mutationFn: () => extractCourierInfo({ pastedText: dictation, source: "dictation" }),
    onSuccess: (result) => {
      const filled: string[] = [];
      if (!request.trim()) {
        setRequest(dictation.trim());
        filled.push("requête");
      }
      const s = result.sender;
      const named = !!(s.first_name || s.last_name || s.email || s.phone);
      const match = result.sender_match ?? null;
      if (!usager && match?.status === "matched" && match.contact) {
        setUsager(match.contact as SocleContact);
        setUsagerSuggestion(null);
        filled.push("usager reconnu");
      } else if (!usager && named) {
        setUsagerSuggestion(s);
        filled.push("usager à confirmer");
      }
      setDictating(false);
      if (filled.length) toast.success(`Dictée : ${filled.join(", ")}`);
      else toast.info("Dictée : rien à remplir — la requête et l'usager sont déjà saisis.");
    },
    onError: (e: Error) => toast.error("Remplissage impossible", { description: e.message }),
  });

  const create = useMutation({
    mutationFn: () =>
      createEluRelayedCourier({
        organizationId: organizationId!,
        contact: usager!,
        request,
        files: files.map((f) => f.file),
        internalComment: comment,
      }),
    onSuccess: (res) => {
      for (const f of res.failedFiles) toast.error(`${f.name} n'a pas pu être joint : ${f.error}`);
      if (res.commentFailed) toast.error("Le commentaire interne n'a pas pu être enregistré.");
      toast.success("Courrier transmis au service courrier");
      for (const key of ["mailbox-couriers", "mailbox-unassigned", "mailroom-couriers", "elu-recent-couriers"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      navigate(`/elu/courrier/${res.courierId}`, { replace: true });
    },
    onError: (e: Error) => toast.error(e.message || "Le courrier n'a pas pu être créé."),
  });

  function submit() {
    setSubmitted(true);
    if (hasErrors || !organizationId) return;
    create.mutate();
  }

  return (
    <>
      <EluScreen>
        <EluScreenHeader
          title="Nouveau courrier"
          subtitle="Relayez la demande d'un usager. Le service courrier l'orientera."
          withBack
        />

        {dictationEnabled &&
          (dictating ? (
            <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-airbnb-sm" aria-label="Dictée">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[19px] font-bold text-foreground">Dicter la demande</span>
                <button
                  type="button"
                  onClick={() => setDictating(false)}
                  aria-label="Fermer la dictée"
                  className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <DictationRecorder value={dictation} onChange={setDictation} variant="touch" disabled={fill.isPending} />
              {dictation.trim() && (
                <button
                  type="button"
                  onClick={() => fill.mutate()}
                  disabled={fill.isPending}
                  className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[17px] font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-50"
                >
                  {fill.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                  )}
                  {fill.isPending ? "Remplissage…" : "Remplir le formulaire"}
                </button>
              )}
            </section>
          ) : (
            <button
              type="button"
              onClick={() => setDictating(true)}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-primary bg-primary/5 text-[17px] font-semibold text-primary"
            >
              <Mic className="h-5 w-5" aria-hidden="true" />
              Dicter la demande
            </button>
          ))}

        <section className="flex flex-col gap-2.5">
          <FieldTitle required>Usager</FieldTitle>
          {!usager && usagerSuggestion && (
            <p className="text-[15px] text-muted-foreground">
              Usager mentionné :{" "}
              <span className="font-semibold text-foreground">
                {[
                  usagerSuggestion.civility === "madame" ? "Mme" : usagerSuggestion.civility === "monsieur" ? "M." : null,
                  usagerSuggestion.first_name,
                  usagerSuggestion.last_name,
                ]
                  .filter(Boolean)
                  .join(" ") ||
                  usagerSuggestion.email ||
                  usagerSuggestion.phone}
              </span>{" "}
              — choisissez sa fiche ou créez-la.
            </p>
          )}
          {organizationId && (
            <EluUsagerPicker
              organizationId={organizationId}
              value={usager}
              onChange={setUsager}
              invalid={submitted && !!errors.usager}
              suggestion={usagerSuggestion}
            />
          )}
          {submitted && errors.usager && (
            <p role="alert" className="text-[15px] text-destructive">
              {errors.usager}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <FieldTitle htmlFor="elu-relay-request" required>
            Requête de l'usager
          </FieldTitle>
          <textarea
            id="elu-relay-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={7}
            placeholder="Ce que l'usager demande, avec les détails utiles (lieu, dates, personnes concernées)."
            aria-invalid={submitted && !!errors.request}
            className={cn(
              "w-full rounded-xl border bg-card px-4 py-3.5 text-[17px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              submitted && errors.request && "border-destructive",
            )}
          />
          {submitted && errors.request && (
            <p role="alert" className="text-[15px] text-destructive">
              {errors.request}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <FieldTitle>Documents joints</FieldTitle>
          {/* Deux entrées distinctes : `capture` ouvre directement l'appareil
              photo ; sans lui, le téléphone propose fichiers et galerie. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl border bg-card text-[17px] font-semibold text-foreground shadow-airbnb-sm"
            >
              <Camera className="h-5 w-5 text-primary" aria-hidden="true" />
              Photo
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl border bg-card text-[17px] font-semibold text-foreground shadow-airbnb-sm"
            >
              <Paperclip className="h-5 w-5 text-primary" aria-hidden="true" />
              Fichier
            </button>
          </div>
          {files.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Documents à joindre">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-xl border bg-card p-2.5 pl-3">
                  {f.preview ? (
                    <img src={f.preview} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-muted">
                      <FileText className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base text-foreground">{f.file.name}</span>
                    <span className="text-sm text-muted-foreground">{formatSize(f.file.size)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    aria-label={`Retirer ${f.file.name}`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <FieldTitle htmlFor="elu-relay-comment">Commentaire interne</FieldTitle>
          <textarea
            id="elu-relay-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Visible des agents seulement, jamais de l'usager."
            className="w-full rounded-xl border bg-card px-4 py-3.5 text-[17px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </section>
      </EluScreen>

      {/* Même pied que l'écran de signature : `sticky`, pas `fixed` (barre
          d'URL de Safari iOS). */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-6px_20px_-8px_rgb(0_0_0/0.12)]">
        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="flex min-h-[60px] w-full items-center justify-center rounded-xl bg-primary text-[19px] font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-50"
        >
          {create.isPending
            ? files.length > 0
              ? "Envoi des documents…"
              : "Envoi…"
            : "Envoyer le courrier"}
        </button>
        {submitted && hasErrors && (
          <p role="status" className="text-center text-[13px] text-muted-foreground">
            Il manque l'usager ou sa requête.
          </p>
        )}
      </div>
    </>
  );
}
