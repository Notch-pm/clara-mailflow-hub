import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, User, X } from "lucide-react";
import { toast } from "sonner";
import DuplicateContactsAlert from "@/components/contacts/DuplicateContactsAlert";
import { EluSearchInput } from "@/components/elu/EluSearchField";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import {
  createContact,
  listContacts,
  type SocleContact,
  type SocleContactCivility,
} from "@/services/socleContactService";
import type { SuggestedSender } from "@/services/courierAnalysisService";

function contactName(c: SocleContact): string {
  return c.display_name?.trim() || c.email || "Sans nom";
}

function contactMeta(c: SocleContact): string | null {
  return [c.email, c.mobile_phone ?? c.landline_phone, c.city].filter(Boolean).join(" · ") || null;
}

/** Champ texte de l'espace élu : 17 px, sous 16 px Safari iOS zoome sur le champ. */
const INPUT_CLASS =
  "min-h-14 w-full rounded-xl border bg-card px-4 text-[17px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * L'usager d'un courrier relayé : choisi dans le référentiel du Socle, ou créé
 * sur place. Clara ne stocke aucune identité — la fiche naît au Socle, comme
 * avec `ContactPicker` sur le poste de travail, dont c'est la version tactile :
 * une liste de résultats à grandes lignes plutôt qu'un menu déroulant, et un
 * formulaire de création en ligne plutôt qu'une fenêtre par-dessus.
 *
 * La création se limite à une personne : c'est ce qu'un élu relaie. Une
 * entreprise ou une association se crée depuis l'application complète.
 */
export function EluUsagerPicker({
  organizationId,
  value,
  onChange,
  suggestion = null,
}: {
  organizationId: string;
  value: SocleContact | null;
  onChange: (contact: SocleContact | null) => void;
  /**
   * Usager mentionné dans une dictée, sans fiche reconnue d'office : la
   * recherche part de son nom, et une création éventuelle reprend ce qui a
   * été dit (civilité, prénom, nom, coordonnées).
   */
  suggestion?: SuggestedSender | null;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 300);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!suggestion) return;
    const term = suggestion.last_name?.trim() || suggestion.email?.trim() || suggestion.phone?.trim() || "";
    if (term) setSearch(term);
    setCreating(false);
  }, [suggestion]);

  const { data: results = [], isFetching, isError } = useQuery({
    queryKey: ["socle-contacts", organizationId, "elu-relay", debounced],
    queryFn: () => listContacts(organizationId, { search: debounced, status: "active", limit: 20 }),
    enabled: !!organizationId && debounced.length >= 2 && !value && !creating,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <div className="flex items-center gap-3.5 rounded-xl border border-primary bg-card p-4 shadow-airbnb-sm">
        <User className="h-[22px] w-[22px] shrink-0 text-primary" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[17px] font-semibold text-foreground">{contactName(value)}</span>
          {contactMeta(value) && (
            <span className="break-words text-[15px] text-muted-foreground">{contactMeta(value)}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="flex min-h-11 shrink-0 items-center px-1 text-base font-bold text-primary"
        >
          Changer
        </button>
      </div>
    );
  }

  if (creating) {
    return (
      <NewUsagerForm
        organizationId={organizationId}
        initialName={search.trim()}
        draft={suggestion}
        onCancel={() => setCreating(false)}
        onCreated={(contact) => {
          void qc.invalidateQueries({ queryKey: ["socle-contacts"] });
          setCreating(false);
          setSearch("");
          onChange(contact);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <EluSearchInput value={search} onChange={setSearch} placeholder="Nom, courriel, téléphone" label="Rechercher un usager" />
      {debounced.length >= 2 && (
        <ul className="flex flex-col gap-2" aria-label="Usagers trouvés">
          {/* Un Socle muet n'est pas « aucun usager » : le dire, sinon l'élu
              recrée une fiche qui existe déjà. */}
          {isError ? (
            <li role="alert" className="px-1 text-[15px] text-destructive">
              Le référentiel des usagers ne répond pas. Réessayez dans un instant.
            </li>
          ) : isFetching && results.length === 0 ? (
            <li className="px-1 text-[15px] text-muted-foreground">Recherche…</li>
          ) : results.length === 0 ? (
            <li className="px-1 text-[15px] text-muted-foreground">Aucun usager trouvé.</li>
          ) : (
            results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChange(c)}
                  className="flex min-h-14 w-full flex-col items-start justify-center gap-0.5 rounded-xl border bg-card px-4 py-3 text-left"
                >
                  <span className="text-[17px] font-semibold text-foreground">{contactName(c)}</span>
                  {contactMeta(c) && (
                    <span className="break-words text-[15px] text-muted-foreground">{contactMeta(c)}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="flex min-h-12 items-center gap-2 self-start px-1 text-base font-bold text-primary"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        Créer un nouvel usager
      </button>
    </div>
  );
}

/** Création d'une fiche « personne » au Socle, en ligne dans le formulaire. */
function NewUsagerForm({
  organizationId,
  initialName,
  draft = null,
  onCancel,
  onCreated,
}: {
  organizationId: string;
  initialName: string;
  /** Identité dictée : reprise telle quelle, l'élu corrige au besoin. */
  draft?: SuggestedSender | null;
  onCancel: () => void;
  onCreated: (contact: SocleContact) => void;
}) {
  // Ce que l'élu a déjà tapé dans la recherche sert de nom de famille : il
  // cherchait la personne, il ne la retape pas.
  const [civility, setCivility] = useState<SocleContactCivility | "">(draft?.civility ?? "");
  const [firstName, setFirstName] = useState(draft?.first_name ?? "");
  const [lastName, setLastName] = useState(draft?.last_name || initialName);
  const [email, setEmail] = useState(draft?.email ?? "");
  const [phone, setPhone] = useState(draft?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!civility || !firstName.trim() || !lastName.trim()) {
      setError("Civilité, prénom et nom sont obligatoires.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const contact = await createContact(organizationId, {
        contact_type: "personne",
        civility,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || null,
        mobile_phone: phone.trim() || null,
      });
      toast.success("Usager créé dans le référentiel");
      onCreated(contact);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création de l'usager impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5 rounded-xl border bg-card p-4 shadow-airbnb-sm">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[17px] font-bold text-foreground">Nouvel usager</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Annuler la création"
          className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Une fiche existante proposée avant d'en créer une seconde. */}
      <DuplicateContactsAlert
        organizationId={organizationId}
        draft={{ contact_type: "personne", first_name: firstName, last_name: lastName, email, mobile_phone: phone }}
        onSelect={onCreated}
        selectLabel="Choisir cet usager"
      />

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-bold text-muted-foreground">Civilité *</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["madame", "Madame"],
              ["monsieur", "Monsieur"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={civility === v}
              onClick={() => setCivility(v)}
              className={cn(
                "flex min-h-12 items-center justify-center gap-1.5 rounded-xl border text-[17px] font-semibold",
                civility === v ? "border-primary bg-primary/10 text-primary" : "bg-card text-foreground",
              )}
            >
              {civility === v && <Check className="h-4 w-4" aria-hidden="true" />}
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-muted-foreground">Prénom *</span>
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" className={INPUT_CLASS} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-muted-foreground">Nom *</span>
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" className={INPUT_CLASS} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-muted-foreground">Courriel</span>
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-muted-foreground">Téléphone</span>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </label>

      {error && (
        <p role="alert" className="text-[15px] text-destructive">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        className="min-h-14 w-full rounded-xl bg-primary text-[18px] font-bold text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Création…" : "Créer et choisir cet usager"}
      </button>
    </div>
  );
}
