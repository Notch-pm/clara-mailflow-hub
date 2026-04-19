import { supabase } from "@/integrations/supabase/client";

const BUCKET = "user-avatars";

/**
 * Upload an avatar file for a user, replacing any existing one.
 * Returns the public URL of the uploaded avatar.
 */
export async function uploadUserAvatar(userId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/avatar.${ext}`;

  // Upload (upsert)
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600",
    });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // cache-bust so newly uploaded picture replaces old one in browser cache
  const url = `${data.publicUrl}?v=${Date.now()}`;

  // Persist on users table
  const { error: updateError } = await supabase
    .from("users")
    .update({ avatar_url: url } as any)
    .eq("id", userId);
  if (updateError) throw updateError;

  return url;
}

/**
 * Remove the user's avatar (best-effort delete from storage + clear column).
 */
export async function removeUserAvatar(userId: string): Promise<void> {
  // Try common extensions
  const candidates = ["jpg", "jpeg", "png", "webp", "gif"].map((ext) => `${userId}/avatar.${ext}`);
  await supabase.storage.from(BUCKET).remove(candidates).catch(() => {});

  const { error } = await supabase
    .from("users")
    .update({ avatar_url: null } as any)
    .eq("id", userId);
  if (error) throw error;
}
