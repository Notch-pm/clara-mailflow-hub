import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle2, AlertCircle, Paperclip, X, Upload } from "lucide-react";

type SenderCategory = "citoyen" | "entreprise" | "association";
type SenderCivilite = "madame" | "monsieur";

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portal-form`;

const MAX_FILES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx";

interface FormConfig {
  name: string;
  description: string | null;
  service_name: string | null;
}

type Status = "loading" | "ready" | "submitting" | "success" | "invalid" | "inactive" | "error";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function PortalFormPage() {
  const { token } = useParams<{ token: string }>();
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [senderCategory, setSenderCategory] = useState<SenderCategory>("citoyen");
  const [senderCivilite, setSenderCivilite] = useState<SenderCivilite | "">("");
  const [senderFirstName, setSenderFirstName] = useState("");
  const [senderLastName, setSenderLastName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) { setStatus("invalid"); return; }
    fetch(`${EDGE_URL}?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.status === 404) { setStatus("invalid"); return; }
        if (res.status === 410) { setStatus("inactive"); return; }
        if (!res.ok) { setStatus("error"); return; }
        setConfig(data as FormConfig);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [token]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!selected.length) return;

    const newErrors = { ...errors };
    delete newErrors.files;

    const combined = [...files, ...selected].slice(0, MAX_FILES);
    const oversized = selected.find((f) => f.size > MAX_FILE_SIZE);
    if (oversized) {
      setErrors({ ...newErrors, files: `${oversized.name} dépasse la limite de 5 Mo.` });
      return;
    }
    if (files.length + selected.length > MAX_FILES) {
      setErrors({ ...newErrors, files: `Maximum ${MAX_FILES} fichiers autorisés.` });
    } else {
      setErrors(newErrors);
    }
    setFiles(combined);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => { const e = { ...prev }; delete e.files; return e; });
  }

  function validate() {
    const errs: Record<string, string> = {};
    if (!subject.trim()) errs.subject = "Le sujet est obligatoire.";
    if (!body.trim()) errs.body = "Le message est obligatoire.";
    if (senderCategory === "citoyen") {
      if (!senderFirstName.trim()) errs.senderFirstName = "Le prénom est obligatoire.";
      if (!senderLastName.trim()) errs.senderLastName = "Le nom est obligatoire.";
    } else {
      if (!senderLastName.trim()) errs.senderLastName = "La raison sociale est obligatoire.";
    }
    if (!senderEmail.trim() && !senderPhone.trim()) {
      errs.senderContact = "Veuillez renseigner au moins un email ou un numéro de téléphone.";
    }
    if (senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
      errs.senderEmail = "Adresse email invalide.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setStatus("submitting");
    try {
      const fd = new FormData();
      fd.append("token", token!);
      fd.append("subject", subject.trim());
      fd.append("body", body.trim());
      fd.append("sender_category", senderCategory);
      if (senderCategory === "citoyen") {
        fd.append("sender_first_name", senderFirstName.trim());
        if (senderCivilite) fd.append("sender_civilite", senderCivilite);
      }
      fd.append("sender_last_name", senderLastName.trim());
      if (senderEmail.trim()) fd.append("sender_email", senderEmail.trim());
      if (senderPhone.trim()) fd.append("sender_phone", senderPhone.trim());
      for (const file of files) fd.append("files", file);

      // Pas de Content-Type — le navigateur le définit automatiquement avec le boundary
      const res = await fetch(EDGE_URL, { method: "POST", body: fd });

      if (res.status === 429) {
        setErrors({ general: "Trop de soumissions. Veuillez patienter quelques instants." });
        setStatus("ready");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrors({ general: (data as any)?.error ?? "Une erreur est survenue." });
        setStatus("ready");
        return;
      }
      setStatus("success");
    } catch {
      setErrors({ general: "Impossible de contacter le serveur. Vérifiez votre connexion." });
      setStatus("ready");
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (status === "invalid") {
    return <PageShell><StateBlock icon={<AlertCircle className="h-10 w-10 text-destructive" />} title="Formulaire introuvable">Ce lien est invalide ou a expiré.</StateBlock></PageShell>;
  }
  if (status === "inactive") {
    return <PageShell><StateBlock icon={<AlertCircle className="h-10 w-10 text-muted-foreground" />} title="Formulaire désactivé">Ce formulaire n'est plus disponible.</StateBlock></PageShell>;
  }
  if (status === "error") {
    return <PageShell><StateBlock icon={<AlertCircle className="h-10 w-10 text-destructive" />} title="Erreur">Une erreur est survenue lors du chargement. Veuillez réessayer ultérieurement.</StateBlock></PageShell>;
  }
  if (status === "success") {
    return <PageShell><StateBlock icon={<CheckCircle2 className="h-10 w-10 text-primary" />} title="Message envoyé">Votre message a bien été transmis. Nous vous répondrons dans les meilleurs délais.</StateBlock></PageShell>;
  }

  const submitting = status === "submitting";

  return (
    <PageShell>
      <div className="w-full max-w-lg mx-auto space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{config?.name}</h1>
          {config?.description && (
            <p className="text-sm text-muted-foreground">{config.description}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="subject">Sujet <span aria-hidden>*</span></Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Objet de votre demande" disabled={submitting} aria-invalid={!!errors.subject} />
            {errors.subject && <p className="text-xs text-destructive">{errors.subject}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Message <span aria-hidden>*</span></Label>
            <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Décrivez votre demande..." rows={5} disabled={submitting} aria-invalid={!!errors.body} />
            {errors.body && <p className="text-xs text-destructive">{errors.body}</p>}
          </div>

          {/* Upload de fichiers */}
          <div className="space-y-2">
            <Label>
              Pièces jointes{" "}
              <span className="text-muted-foreground text-xs">(optionnel — {MAX_FILES} fichiers max, 5 Mo chacun)</span>
            </Label>

            {files.length > 0 && (
              <ul className="space-y-1.5">
                {files.map((file, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{file.name}</span>
                      <span className="text-muted-foreground text-xs shrink-0">{formatSize(file.size)}</span>
                    </div>
                    <button type="button" onClick={() => removeFile(i)} disabled={submitting}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0" aria-label="Supprimer">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {files.length < MAX_FILES && (
              <>
                <input ref={fileInputRef} type="file" multiple accept={ACCEPT}
                  className="hidden" onChange={handleFileChange} disabled={submitting} />
                <Button type="button" variant="outline" size="sm" disabled={submitting}
                  onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Ajouter {files.length > 0 ? "un autre fichier" : "un fichier"}
                </Button>
              </>
            )}
            {errors.files && <p className="text-xs text-destructive">{errors.files}</p>}
          </div>

          {/* Nature de l'expéditeur */}
          <div className="space-y-1.5">
            <Label htmlFor="senderCategory">Je suis <span aria-hidden>*</span></Label>
            <Select
              value={senderCategory}
              onValueChange={(v) => {
                setSenderCategory(v as SenderCategory);
                setSenderFirstName("");
                setSenderLastName("");
                setSenderCivilite("");
              }}
              disabled={submitting}
            >
              <SelectTrigger id="senderCategory">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="citoyen">Citoyen</SelectItem>
                <SelectItem value="entreprise">Entreprise</SelectItem>
                <SelectItem value="association">Association</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Identité — champs selon la nature */}
          {senderCategory === "citoyen" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="senderCivilite">
                    Civilité <span className="text-muted-foreground text-xs">(optionnel)</span>
                  </Label>
                  <Select
                    value={senderCivilite || "none"}
                    onValueChange={(v) => setSenderCivilite(v === "none" ? "" : v as SenderCivilite)}
                    disabled={submitting}
                  >
                    <SelectTrigger id="senderCivilite">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      <SelectItem value="madame">Madame</SelectItem>
                      <SelectItem value="monsieur">Monsieur</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="senderFirstName">Prénom <span aria-hidden>*</span></Label>
                  <Input id="senderFirstName" value={senderFirstName} onChange={(e) => setSenderFirstName(e.target.value)}
                    placeholder="Jean" disabled={submitting} aria-invalid={!!errors.senderFirstName} />
                  {errors.senderFirstName && <p className="text-xs text-destructive">{errors.senderFirstName}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="senderLastName">Nom <span aria-hidden>*</span></Label>
                <Input id="senderLastName" value={senderLastName} onChange={(e) => setSenderLastName(e.target.value)}
                  placeholder="Dupont" disabled={submitting} aria-invalid={!!errors.senderLastName} />
                {errors.senderLastName && <p className="text-xs text-destructive">{errors.senderLastName}</p>}
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="senderLastName">Raison sociale <span aria-hidden>*</span></Label>
              <Input id="senderLastName" value={senderLastName} onChange={(e) => setSenderLastName(e.target.value)}
                placeholder={senderCategory === "entreprise" ? "Nom de l'entreprise" : "Nom de l'association"}
                disabled={submitting} aria-invalid={!!errors.senderLastName} />
              {errors.senderLastName && <p className="text-xs text-destructive">{errors.senderLastName}</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="senderEmail">
                  Email <span className="text-muted-foreground text-xs">(au moins un des deux)</span>
                </Label>
                <Input id="senderEmail" type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="jean.dupont@exemple.fr" disabled={submitting} aria-invalid={!!errors.senderEmail || !!errors.senderContact} />
                {errors.senderEmail && <p className="text-xs text-destructive">{errors.senderEmail}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="senderPhone">
                  Téléphone <span className="text-muted-foreground text-xs">(au moins un des deux)</span>
                </Label>
                <Input id="senderPhone" type="tel" value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)}
                  placeholder="06 12 34 56 78" disabled={submitting} aria-invalid={!!errors.senderContact} />
              </div>
            </div>
            {errors.senderContact && <p className="text-xs text-destructive">{errors.senderContact}</p>}
          </div>

          {errors.general && (
            <p className="text-sm text-destructive rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
              {errors.general}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Envoyer ma demande
          </Button>
        </form>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-start bg-background px-4 py-12">
      {children}
    </div>
  );
}

function StateBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center max-w-sm">
      {icon}
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
