import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDocuments } from "@/services/courierDocumentService";

/**
 * Pièces d'un courrier telles que les montre l'aperçu (`DocumentViewer`) : si le
 * courrier porte un corps d'email (`metadata.body_html` / `body_text`), il est
 * injecté en premier « document » synthétique, comme une pièce jointe.
 */
export function useCourierDisplayDocuments(
  courier: { id: string; metadata?: Record<string, unknown> | null } | null | undefined,
  organizationId: string,
  enabled = true,
) {
  const { data: documents = [] } = useQuery({
    queryKey: ["courier-documents", courier?.id],
    queryFn: () => getDocuments(courier!.id),
    enabled: !!courier?.id && enabled,
  });

  const displayDocuments = useMemo(() => {
    const meta = courier?.metadata ?? {};
    const html = (meta.body_html as string | undefined) ?? null;
    const text = (meta.body_text as string | undefined) ?? null;
    if (!html && !text) return documents;
    const inlineDoc = {
      id: `inline:email-body:${courier?.id}`,
      courier_id: courier?.id,
      organization_id: organizationId,
      file_name: "Corps de l'email",
      mime_type: html ? "text/html" : "text/plain",
      file_size: null,
      document_type: "original",
      storage_key: "",
      checksum: null,
      created_at: new Date().toISOString(),
      inline_html: html,
      inline_text: text,
    };
    return [inlineDoc, ...documents];
  }, [documents, courier?.id, courier?.metadata, organizationId]);

  return { documents, displayDocuments };
}
