import { supabase } from "@/integrations/supabase/client";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storage-documents`;

async function getHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Non authentifié");
  return {
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Upload a file to clara-documents bucket via the edge function.
 * Returns storage metadata (storage_key, file_name, mime_type, file_size).
 */
export async function uploadDocument(
  orgId: string,
  file: File,
  storagePath: string
): Promise<{ storage_key: string; file_name: string; mime_type: string; file_size: number }> {
  const headers = await getHeaders();
  headers["x-org-id"] = orgId;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", storagePath);

  const res = await fetch(`${FUNCTION_URL}?action=upload`, {
    method: "POST",
    headers,
    body: formData,
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Upload failed");
  return json;
}

/**
 * Get a short-lived signed URL for downloading a document.
 */
export async function getDocumentUrl(orgId: string, storagePath: string): Promise<string> {
  const headers = await getHeaders();
  headers["x-org-id"] = orgId;

  const params = new URLSearchParams({ action: "download", path: storagePath });
  const res = await fetch(`${FUNCTION_URL}?${params}`, { headers });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Download failed");
  return json.url;
}

/**
 * Delete a file from storage.
 */
export async function deleteDocumentFile(orgId: string, storagePath: string): Promise<void> {
  const headers = await getHeaders();
  headers["x-org-id"] = orgId;
  headers["Content-Type"] = "application/json";

  const res = await fetch(`${FUNCTION_URL}?action=delete`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ path: storagePath }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Delete failed");
}
