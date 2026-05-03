import { supabase } from "@/integrations/supabase/client";
import PizZip from "pizzip";

export async function getOrgTemplateData(orgId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("reply_template_data")
    .eq("id", orgId)
    .single();
  if (error) return null;
  return (data as any)?.reply_template_data ?? null;
}

export async function uploadOrgTemplate(orgId: string, file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".docx")) {
    throw new Error("Le fichier doit être au format .docx");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Le fichier ne doit pas dépasser 10 Mo");
  }
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = "";
  uint8.forEach((b) => { binary += String.fromCharCode(b); });
  const base64 = btoa(binary);

  const { error } = await supabase
    .from("organizations")
    .update({ reply_template_data: base64 } as never)
    .eq("id", orgId);
  if (error) throw error;
}

export async function removeOrgTemplate(orgId: string): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({ reply_template_data: null } as never)
    .eq("id", orgId);
  if (error) throw error;
}

// ─── HTML template ───────────────────────────────────────────────────────────

export async function getOrgHtmlTemplate(
  orgId: string,
): Promise<{ html: string | null; design: object | null }> {
  const { data, error } = await supabase
    .from("organizations")
    .select("reply_template_html, reply_template_design")
    .eq("id", orgId)
    .single();
  if (error) return { html: null, design: null };
  return {
    html: (data as any)?.reply_template_html ?? null,
    design: (data as any)?.reply_template_design ?? null,
  };
}

export async function saveOrgHtmlTemplate(
  orgId: string,
  html: string,
  design: object,
): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({ reply_template_html: html, reply_template_design: design } as never)
    .eq("id", orgId);
  if (error) throw error;
}

export async function removeOrgHtmlTemplate(orgId: string): Promise<void> {
  const { error } = await supabase
    .from("organizations")
    .update({ reply_template_html: null, reply_template_design: null } as never)
    .eq("id", orgId);
  if (error) throw error;
}

// ─── XML helpers ─────────────────────────────────────────────────────────────
// OOXML uses namespaced elements (w:p, w:r, w:t…). DOMParser in XML mode
// does NOT match them via querySelector("p") — we must filter by localName.

function byLocal(node: Element | Document, name: string): Element[] {
  const root = node instanceof Document ? node.documentElement : node;
  return Array.from(root.getElementsByTagName("*")).filter((e) => e.localName === name);
}

// w:val is a namespaced attribute; getAttribute("w:val") works in most browsers
// for qualified attribute names in XML documents, but fall back to getAttributeNS.
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function wAttr(el: Element, name: string): string | null {
  return el.getAttribute(`w:${name}`) ?? el.getAttributeNS(W_NS, name);
}

// ─── Image map from .rels file ────────────────────────────────────────────────

function buildImageMap(zip: PizZip, relsPath: string): Record<string, string> {
  const map: Record<string, string> = {};
  const relsFile = zip.files[relsPath];
  if (!relsFile) return map;

  const parser = new DOMParser();
  const doc = parser.parseFromString(relsFile.asText(), "application/xml");
  // Relationship elements live in the package relationships namespace (default ns).
  const rels = Array.from(doc.getElementsByTagName("*")).filter((e) => e.localName === "Relationship");

  rels.forEach((rel) => {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    const type = rel.getAttribute("Type") ?? "";
    if (!id || !target || !type.includes("image")) return;

    const mediaPath = target.startsWith("media/") ? `word/${target}` : target;
    const mediaFile = zip.files[mediaPath];
    if (!mediaFile) return;

    const uint8 = mediaFile.asUint8Array();
    const ext = target.split(".").pop()?.toLowerCase() ?? "png";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", svg: "image/svg+xml",
    };
    const mime = mimeMap[ext] ?? "image/png";
    let bin = "";
    uint8.forEach((b) => { bin += String.fromCharCode(b); });
    map[id] = `data:${mime};base64,${btoa(bin)}`;
  });

  return map;
}

// ─── OOXML → HTML converter ───────────────────────────────────────────────────

function xmlToHtml(xmlContent: string, imageMap: Record<string, string>): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, "application/xml");

  const paragraphs = byLocal(doc, "p");
  const parts: string[] = [];

  paragraphs.forEach((para) => {
    // Alignment from w:jc w:val
    const jc = byLocal(para, "jc")[0];
    const alignVal = jc ? wAttr(jc, "val") ?? "left" : "left";
    const alignMap: Record<string, string> = { center: "center", right: "right", both: "justify" };
    const textAlign = alignMap[alignVal] ?? "left";

    let paraHtml = "";
    const runs = byLocal(para, "r");

    runs.forEach((run) => {
      // Bold: w:b present and w:val != "0"
      const bEl = byLocal(run, "b")[0];
      const isBold = !!bEl && wAttr(bEl, "val") !== "0";
      const iEl = byLocal(run, "i")[0];
      const isItalic = !!iEl && wAttr(iEl, "val") !== "0";

      // Text content
      let text = "";
      byLocal(run, "t").forEach((t) => { text += t.textContent ?? ""; });
      if (text) {
        let escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        if (isBold) escaped = `<strong>${escaped}</strong>`;
        if (isItalic) escaped = `<em>${escaped}</em>`;
        paraHtml += escaped;
      }

      // Drawing (embedded image)
      const drawing = byLocal(run, "drawing")[0];
      if (drawing) {
        const blip = byLocal(drawing, "blip")[0];
        // r:embed attribute — try qualified name first, then NS
        const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        const rId = blip?.getAttribute("r:embed") ?? blip?.getAttributeNS(R_NS, "embed");
        if (rId && imageMap[rId]) {
          const extent = byLocal(drawing, "extent")[0];
          // cx/cy are plain attributes on wp:extent (no namespace)
          const cx = extent?.getAttribute("cx");
          const cy = extent?.getAttribute("cy");
          const w = cx ? Math.round(parseInt(cx) / 9525) : undefined;
          const h = cy ? Math.round(parseInt(cy) / 9525) : undefined;
          const sizeAttr = w && h ? ` width="${w}" height="${h}"` : "";
          paraHtml += `<img src="${imageMap[rId]}"${sizeAttr} style="max-width:100%;">`;
        }
      }

      if (byLocal(run, "br").length > 0) paraHtml += "<br>";
    });

    parts.push(`<p style="text-align:${textAlign};margin:0.3em 0;">${paraHtml}</p>`);
  });

  return parts.join("\n");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function extractTemplateLayout(
  orgId: string,
): Promise<{ headerHtml: string; footerHtml: string }> {
  const base64 = await getOrgTemplateData(orgId);
  if (!base64) throw new Error("Aucun modèle configuré pour cette organisation.");

  const bin = atob(base64);
  const uint8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) uint8[i] = bin.charCodeAt(i);

  const zip = new PizZip(uint8.buffer);

  const headerImageMap = buildImageMap(zip, "word/_rels/header1.xml.rels");
  const footerImageMap = buildImageMap(zip, "word/_rels/footer1.xml.rels");

  const headerXml = zip.files["word/header1.xml"]?.asText() ?? "";
  const footerXml = zip.files["word/footer1.xml"]?.asText() ?? "";

  return {
    headerHtml: headerXml ? xmlToHtml(headerXml, headerImageMap) : "",
    footerHtml: footerXml ? xmlToHtml(footerXml, footerImageMap) : "",
  };
}
