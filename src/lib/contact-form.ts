import { z } from "zod";
import type { SocleContact, SocleContactInput } from "@/services/socleContactService";
import { CONTACT_CATEGORIES, roleCategory } from "@/lib/contact-categories";

/** Schéma, valeurs par défaut et charge utile du formulaire contact (décisions pures). */

export const contactFormSchema = z
  .object({
    contact_type: z.enum(["personne", "entreprise", "association", "administration"]),
    civility: z.enum(["madame", "monsieur"]).optional().nullable(),
    first_name: z.string().trim().max(200).optional(),
    last_name: z.string().trim().max(200).optional(),
    usage_name: z.string().trim().max(200).optional(),
    birth_date: z.string().trim().optional(),
    legal_name: z.string().trim().max(300).optional(),
    siret: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || /^\d{14}$/.test(v.replace(/\s/g, "")), "SIRET : 14 chiffres attendus"),
    email: z.string().trim().email("Email invalide").max(255).or(z.literal("")).optional(),
    mobile_phone: z.string().trim().max(50).optional(),
    landline_phone: z.string().trim().max(50).optional(),
    address_line1: z.string().trim().max(300).optional(),
    address_line2: z.string().trim().max(300).optional(),
    postal_code: z.string().trim().max(20).optional(),
    city: z.string().trim().max(200).optional(),
    preferred_channel: z.enum(["email", "telephone", "courrier"]).optional().nullable(),
    internal_notes: z.string().trim().max(5000).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.contact_type === "personne") {
      if (!values.civility) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["civility"], message: "Civilité obligatoire pour une personne" });
      }
      if (!values.last_name?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["last_name"], message: "Nom obligatoire" });
      }
    } else if (!values.legal_name?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["legal_name"], message: "Raison sociale obligatoire" });
    }
  });

export type ContactFormValues = z.infer<typeof contactFormSchema>;

export function contactToFormValues(contact: SocleContact | null): ContactFormValues {
  return {
    contact_type: contact?.contact_type ?? "personne",
    civility: contact?.civility ?? null,
    first_name: contact?.first_name ?? "",
    last_name: contact?.last_name ?? "",
    usage_name: contact?.usage_name ?? "",
    birth_date: contact?.birth_date ?? "",
    legal_name: contact?.legal_name ?? "",
    siret: contact?.siret ?? "",
    email: contact?.email ?? "",
    mobile_phone: contact?.mobile_phone ?? "",
    landline_phone: contact?.landline_phone ?? "",
    address_line1: contact?.address_line1 ?? "",
    address_line2: contact?.address_line2 ?? "",
    postal_code: contact?.postal_code ?? "",
    city: contact?.city ?? "",
    preferred_channel: contact?.preferred_channel ?? null,
    internal_notes: contact?.internal_notes ?? "",
  };
}

export function formValuesToPayload(values: ContactFormValues): SocleContactInput {
  const isPerson = values.contact_type === "personne";
  return {
    contact_type: values.contact_type,
    civility: isPerson ? (values.civility ?? null) : null,
    first_name: isPerson ? values.first_name?.trim() || null : null,
    last_name: isPerson ? values.last_name?.trim() || null : null,
    usage_name: isPerson ? values.usage_name?.trim() || null : null,
    birth_date: isPerson ? values.birth_date?.trim() || null : null,
    legal_name: !isPerson ? values.legal_name?.trim() || null : null,
    siret: !isPerson ? values.siret?.replace(/\s/g, "") || null : null,
    email: values.email?.trim() || null,
    mobile_phone: values.mobile_phone?.trim() || null,
    landline_phone: values.landline_phone?.trim() || null,
    address_line1: values.address_line1?.trim() || null,
    address_line2: values.address_line2?.trim() || null,
    postal_code: values.postal_code?.trim() || null,
    city: values.city?.trim() || null,
    preferred_channel: values.preferred_channel ?? null,
    internal_notes: values.internal_notes?.trim() || null,
  };
}

/** Catégories Interne / Élu en tête, puis le reste du catalogue par nom. */
export function sortRoleOptions<R extends { name: string; code?: string | null }>(roles: readonly R[]): R[] {
  const rank = (r: R) => {
    const c = roleCategory(r);
    return c ? CONTACT_CATEGORIES.indexOf(c) : CONTACT_CATEGORIES.length;
  };
  return [...roles].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function toggleRoleId(current: readonly string[], id: string, checked: boolean): string[] {
  return checked ? [...new Set([...current, id])] : current.filter((x) => x !== id);
}

/**
 * Le référentiel REMPLACE l'ensemble des rôles : on ne les envoie que si
 * l'agent y a touché ET que le catalogue est chargé, pour ne jamais effacer
 * les rôles d'une fiche par mégarde.
 */
export function rolesToSend(
  selected: readonly string[] | null,
  initial: readonly string[],
  catalogLoaded: boolean,
): string[] | null {
  if (!catalogLoaded || selected === null) return null;
  const changed = selected.length !== initial.length || selected.some((id) => !initial.includes(id));
  return changed ? [...selected] : null;
}
