import { supabase } from "@/integrations/supabase/client";

export interface CourierTag {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  created_at: string;
  created_by: string | null;
}

export async function listTags(orgId: string): Promise<CourierTag[]> {
  const { data, error } = await supabase
    .from("courier_tags" as any)
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
): Promise<CourierTag> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("courier_tags" as any)
    .insert({
      organization_id: orgId,
      name: name.trim(),
      color: color ?? null,
      created_by: user?.id ?? null,
    } as any)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as CourierTag;
}

export async function deleteTag(_orgId: string, id: string): Promise<void> {
  const { error } = await supabase.from("courier_tags" as any).delete().eq("id", id);
  if (error) throw error;
}

export const TAG_COLOR_PALETTE: { name: string; value: string }[] = [
  { name: "Vert", value: "hsl(152 83% 42%)" },
  { name: "Jaune", value: "hsl(43 100% 67%)" },
  { name: "Bleu", value: "hsl(212 92% 55%)" },
  { name: "Rouge", value: "hsl(0 84% 60%)" },
  { name: "Violet", value: "hsl(265 80% 60%)" },
  { name: "Gris", value: "hsl(220 9% 46%)" },
];
