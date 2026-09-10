import { supabase } from "@/integrations/supabase/client";

/**
 * Un tag dit l'une de DEUX choses, et jamais les deux : de quoi parle le
 * courrier (« Voirie ») ou sur quel ton (« Mécontentement »). D'où le groupe —
 * qui commande la palette proposée, l'affichage sur le courrier et la scission
 * des statistiques.
 */
export type TagGroup = "theme" | "sentiment";

export const TAG_GROUPS: { value: TagGroup; label: string; description: string }[] = [
  {
    value: "theme",
    label: "Thème",
    description: "Le sujet du courrier — des catégories, sans ordre entre elles.",
  },
  {
    value: "sentiment",
    label: "Sentiment",
    description: "Le ton du rédacteur — une échelle, du plus positif au plus négatif.",
  },
];

export function tagGroupLabel(group: TagGroup): string {
  return TAG_GROUPS.find((g) => g.value === group)?.label ?? group;
}

export interface CourierTag {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  tag_group: TagGroup;
  created_at: string;
  created_by: string | null;
}

export async function listTags(orgId: string): Promise<CourierTag[]> {
  const { data, error } = await supabase
    .from("courier_tags")
    .select("*")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CourierTag[];
}

export async function createTag(
  orgId: string,
  name: string,
  color?: string | null,
  group: TagGroup = "theme",
): Promise<CourierTag> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("courier_tags")
    .insert({
      organization_id: orgId,
      name: name.trim(),
      color: color ?? null,
      tag_group: group,
      created_by: user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CourierTag;
}

/**
 * Renommer, repeindre, ou **changer de groupe**. Le nom est la clé de tout ce
 * qui est déjà appliqué (`couriers.metadata->'tags'` est un tableau de NOMS) :
 * un renommage laisse donc les courriers déjà tagués sur l'ancien nom, qui
 * s'affiche alors en orphelin. Le rappeler à l'appelant, pas le corriger ici en
 * douce — c'est une décision d'agent.
 */
export async function updateTag(
  id: string,
  updates: { name?: string; color?: string | null; group?: TagGroup },
): Promise<CourierTag> {
  const payload: { name?: string; color?: string | null; tag_group?: TagGroup } = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.color !== undefined) payload.color = updates.color;
  if (updates.group !== undefined) payload.tag_group = updates.group;
  const { data, error } = await supabase
    .from("courier_tags")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CourierTag;
}

export async function deleteTag(_orgId: string, id: string): Promise<void> {
  const { error } = await supabase.from("courier_tags").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Sentiment : un DÉGRADÉ vert → rouge, ordonné par valence. La position dans la
 * liste porte le sens — c'est ce qui permet de lire une courbe de sentiments
 * d'un coup d'œil. Les sept marches correspondent aux sept valeurs de l'ancien
 * champ « État d'esprit », devenues des tags le 2026-09-10.
 */
export const SENTIMENT_COLOR_RAMP: { name: string; value: string }[] = [
  { name: "Très positif", value: "hsl(152 83% 42%)" },
  { name: "Positif", value: "hsl(88 62% 45%)" },
  { name: "Neutre", value: "hsl(48 95% 50%)" },
  { name: "Réservé", value: "hsl(35 95% 52%)" },
  { name: "Tendu", value: "hsl(22 92% 52%)" },
  { name: "Négatif", value: "hsl(8 85% 52%)" },
  { name: "Très négatif", value: "hsl(0 84% 45%)" },
];

/**
 * Thème : des teintes DIVERSIFIÉES, sans ordre — ce sont des catégories. Ni
 * vert ni rouge : ces deux-là appartiennent à l'échelle des sentiments, et un
 * thème peint en rouge se lirait comme une alerte.
 */
export const THEME_COLOR_PALETTE: { name: string; value: string }[] = [
  { name: "Bleu", value: "hsl(212 92% 55%)" },
  { name: "Cyan", value: "hsl(190 85% 42%)" },
  { name: "Indigo", value: "hsl(243 75% 59%)" },
  { name: "Violet", value: "hsl(265 80% 60%)" },
  { name: "Fuchsia", value: "hsl(292 70% 55%)" },
  { name: "Rose", value: "hsl(330 75% 55%)" },
  { name: "Brun", value: "hsl(25 40% 45%)" },
  { name: "Ardoise", value: "hsl(215 25% 45%)" },
  { name: "Gris", value: "hsl(220 9% 46%)" },
];

export function paletteFor(group: TagGroup): { name: string; value: string }[] {
  return group === "sentiment" ? SENTIMENT_COLOR_RAMP : THEME_COLOR_PALETTE;
}

/** Couleur par défaut d'un nouveau tag : neutre pour un sentiment, bleu pour un thème. */
export function defaultColorFor(group: TagGroup): string {
  return group === "sentiment" ? SENTIMENT_COLOR_RAMP[2].value : THEME_COLOR_PALETTE[0].value;
}
