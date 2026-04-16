/**
 * Abstract storage service interface for Clara.
 *
 * Rules:
 * - Methods return `storage_key` (the bucket-relative path), never a URL.
 * - No file content is ever stored in the database — only the storage_key reference.
 * - Signed URLs are ephemeral and must never be persisted.
 */

// ── Types ───────────────────────────────────────────────────────────────

export interface UploadResult {
  /** Bucket-relative path — this is what gets saved in courier_documents.storage_key */
  storage_key: string;
  file_name: string;
  mime_type: string;
  file_size: number;
}

export interface StorageService {
  /**
   * Upload a file and return its storage_key (never a URL).
   * @param orgId  - organisation tenant id (used as path prefix for isolation)
   * @param file   - the File to upload
   * @param path   - desired sub-path inside the org prefix (e.g. "courriers/abc/scan.pdf")
   */
  upload(orgId: string, file: File, path: string): Promise<UploadResult>;

  /**
   * Generate a short-lived signed URL for reading a file.
   * The URL must NOT be persisted — it expires after `ttlSeconds`.
   */
  getSignedUrl(orgId: string, storageKey: string, ttlSeconds?: number): Promise<string>;

  /**
   * Permanently delete a file from storage.
   */
  delete(orgId: string, storageKey: string): Promise<void>;
}

// ── Supabase implementation (via edge function) ─────────────────────────

import { supabase } from "@/integrations/supabase/client";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storage-documents`;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Non authentifié");
  return { Authorization: `Bearer ${token}` };
}

class SupabaseStorageService implements StorageService {
  async upload(orgId: string, file: File, path: string): Promise<UploadResult> {
    const headers = await authHeaders();
    headers["x-org-id"] = orgId;

    const form = new FormData();
    form.append("file", file);
    form.append("path", path);

    const res = await fetch(`${FUNCTION_URL}?action=upload`, {
      method: "POST",
      headers,
      body: form,
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Upload failed");
    return json as UploadResult;
  }

  async getSignedUrl(orgId: string, storageKey: string, _ttlSeconds = 60): Promise<string> {
    const headers = await authHeaders();
    headers["x-org-id"] = orgId;

    const params = new URLSearchParams({ action: "download", path: storageKey });
    const res = await fetch(`${FUNCTION_URL}?${params}`, { headers });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Download failed");
    return json.url as string;
  }

  async delete(orgId: string, storageKey: string): Promise<void> {
    const headers = await authHeaders();
    headers["x-org-id"] = orgId;
    headers["Content-Type"] = "application/json";

    const res = await fetch(`${FUNCTION_URL}?action=delete`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ path: storageKey }),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Delete failed");
  }
}

// ── Singleton export ────────────────────────────────────────────────────

/** The storage service instance used throughout the app. */
export const storage: StorageService = new SupabaseStorageService();
