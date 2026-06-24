import { supabase } from "@/integrations/supabase/client";

export interface Signatory {
  id: string;
  organization_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  title: string | null;
  signature_storage_key: string | null;
  created_at: string;
  updated_at: string;
}

const BUCKET = "signatures";

export async function listSignatories(organizationId: string): Promise<Signatory[]> {
  const { data, error } = await supabase
    .from("signatories")
    .select("*")
    .eq("organization_id", organizationId)
    .order("last_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Signatory[];
}

export async function createExternalSignatory(
  organizationId: string,
  values: { first_name: string; last_name: string; title?: string | null }
): Promise<Signatory> {
  const { data, error } = await supabase
    .from("signatories")
    .insert({
      organization_id: organizationId,
      user_id: null,
      first_name: values.first_name,
      last_name: values.last_name,
      title: values.title ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Signatory;
}

export async function updateSignatory(
  id: string,
  values: { first_name?: string; last_name?: string; title?: string | null }
): Promise<void> {
  const { error } = await supabase.from("signatories").update(values).eq("id", id);
  if (error) throw error;
}

export async function deleteSignatory(id: string): Promise<void> {
  const { error } = await supabase.from("signatories").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Find or create a signatory row for an org user (used to attach a signature image to a user).
 */
export async function getOrCreateSignatoryForUser(
  organizationId: string,
  user: { id: string; first_name: string | null; last_name: string | null; signataire_title: string | null }
): Promise<Signatory> {
  const { data: existing, error: selErr } = await supabase
    .from("signatories")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing as Signatory;

  const { data, error } = await supabase
    .from("signatories")
    .insert({
      organization_id: organizationId,
      user_id: user.id,
      first_name: user.first_name ?? "",
      last_name: user.last_name ?? "",
      title: user.signataire_title ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Signatory;
}

const MAX_SIGNATURE_WIDTH = 350;

async function resizeSignatureFile(file: File): Promise<{ blob: Blob; ext: string; contentType: string }> {
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image load failed"));
      i.src = dataUrl;
    });
    if (img.width <= MAX_SIGNATURE_WIDTH) {
      return { blob: file, ext: file.name.split(".").pop()?.toLowerCase() || "png", contentType: file.type || "image/png" };
    }
    const ratio = MAX_SIGNATURE_WIDTH / img.width;
    const w = MAX_SIGNATURE_WIDTH;
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d ctx");
    ctx.drawImage(img, 0, 0, w, h);
    // Preserve transparency → PNG
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
    );
    return { blob, ext: "png", contentType: "image/png" };
  } catch {
    return { blob: file, ext: file.name.split(".").pop()?.toLowerCase() || "png", contentType: file.type || "image/png" };
  }
}

export async function uploadSignatureImage(
  organizationId: string,
  signatoryId: string,
  file: File
): Promise<string> {
  const { blob, ext, contentType } = await resizeSignatureFile(file);
  const key = `${organizationId}/${signatoryId}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(key, blob, { upsert: true, contentType });
  if (upErr) throw upErr;

  // Fetch previous key to remove afterwards
  const { data: prev } = await supabase
    .from("signatories")
    .select("signature_storage_key")
    .eq("id", signatoryId)
    .maybeSingle();

  const { error: updErr } = await supabase
    .from("signatories")
    .update({ signature_storage_key: key })
    .eq("id", signatoryId);
  if (updErr) throw updErr;

  if (prev?.signature_storage_key && prev.signature_storage_key !== key) {
    await supabase.storage.from(BUCKET).remove([prev.signature_storage_key]);
  }
  return key;
}

export async function removeSignatureImage(signatoryId: string): Promise<void> {
  const { data: prev } = await supabase
    .from("signatories")
    .select("signature_storage_key")
    .eq("id", signatoryId)
    .maybeSingle();
  if (prev?.signature_storage_key) {
    await supabase.storage.from(BUCKET).remove([prev.signature_storage_key]);
  }
  const { error } = await supabase
    .from("signatories")
    .update({ signature_storage_key: null })
    .eq("id", signatoryId);
  if (error) throw error;
}

export async function getSignatureUrl(storageKey: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// --- Service ↔ Signatories ---

export async function listServiceSignatoryIds(serviceId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("service_signatories")
    .select("signatory_id")
    .eq("service_id", serviceId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.signatory_id);
}

export async function setServiceSignatories(
  organizationId: string,
  serviceId: string,
  signatoryIds: string[]
): Promise<void> {
  const current = await listServiceSignatoryIds(serviceId);
  const currentSet = new Set(current);
  const nextSet = new Set(signatoryIds);

  const toAdd = signatoryIds.filter((id) => !currentSet.has(id));
  const toRemove = current.filter((id) => !nextSet.has(id));

  if (toAdd.length > 0) {
    const rows = toAdd.map((sid) => ({
      organization_id: organizationId,
      service_id: serviceId,
      signatory_id: sid,
    }));
    const { error } = await supabase.from("service_signatories").insert(rows);
    if (error) throw error;
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("service_signatories")
      .delete()
      .eq("service_id", serviceId)
      .in("signatory_id", toRemove);
    if (error) throw error;
  }
}
