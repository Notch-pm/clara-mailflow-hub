/**
 * Abstract storage service interface for Clara.
 *
 * Rules:
 * - Methods return `storage_key` (the bucket-relative path), never a URL.
 * - No file content is ever stored in the database — only the storage_key reference.
 * - Signed URLs are ephemeral and must never be persisted.
 */

import { supabase } from "@/integrations/supabase/client";
import type { CourierDocument } from "@/types/courier";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storage-documents`;

// ── Types ───────────────────────────────────────────────────────────────

export interface UploadResult extends CourierDocument {}

export interface StorageService {
  /**
   * Upload a file for a courier. The edge function handles:
   * - path generation: org_{orgId}/couriers/{courierId}/{uuid}.{ext}
   * - storage upload
   * - courier_documents row insertion
   * Returns the full courier_documents row.
   */
  upload(
    orgId: string,
    courierId: string,
    file: File,
    documentType?: string
  ): Promise<UploadResult>;

  /**
   * Generate a short-lived signed URL for reading a file.
   */
  getSignedUrl(orgId: string, storageKey: string): Promise<string>;

  /**
   * Delete a document: removes file from storage AND the DB row.
   */
  delete(orgId: string, documentId: string): Promise<void>;

  /**
   * Get the max file size (in bytes) configured for an organization.
   */
  getMaxFileSize(orgId: string): Promise<number>;
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Non authentifié");
  return { Authorization: `Bearer ${token}` };
}

// ── Supabase implementation (via edge function) ─────────────────────────

class SupabaseStorageService implements StorageService {
  async upload(
    orgId: string,
    courierId: string,
    file: File,
    documentType = "attachment"
  ): Promise<UploadResult> {
    const headers = await authHeaders();
    headers["x-org-id"] = orgId;

    const form = new FormData();
    form.append("file", file);
    form.append("courier_id", courierId);
    form.append("document_type", documentType);

    const res = await fetch(`${FUNCTION_URL}?action=upload`, {
      method: "POST",
      headers,
      body: form,
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Upload failed");
    return json as UploadResult;
  }

  async getSignedUrl(orgId: string, storageKey: string): Promise<string> {
    const headers = await authHeaders();
    headers["x-org-id"] = orgId;

    const params = new URLSearchParams({ action: "download", path: storageKey });
    const res = await fetch(`${FUNCTION_URL}?${params}`, { headers });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Download failed");
    return json.url as string;
  }

  async delete(orgId: string, documentId: string): Promise<void> {
    const headers = await authHeaders();
    headers["x-org-id"] = orgId;
    headers["Content-Type"] = "application/json";

    const res = await fetch(`${FUNCTION_URL}?action=delete`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ document_id: documentId }),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Delete failed");
  }

  async getMaxFileSize(orgId: string): Promise<number> {
    const headers = await authHeaders();
    headers["x-org-id"] = orgId;

    const params = new URLSearchParams({ action: "max-size" });
    const res = await fetch(`${FUNCTION_URL}?${params}`, { headers });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to get max size");
    return json.max_file_size as number;
  }
}

// ── Singleton export ────────────────────────────────────────────────────

export const storage: StorageService = new SupabaseStorageService();
