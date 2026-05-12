import Handlebars from "handlebars";

export interface PrintReplyOptions {
  bodyHtml: string;
  subject: string | null;
  senderName: string | null;
  date: string | null;
  organizationName?: string | null;
  organizationCompleteHtml?: string | null;
  serviceName?: string | null;
  serviceCompleteHtml?: string | null;
  templateHtml?: string | null;
}

export interface ContactInfo {
  address_street?: string | null;
  address_complement?: string | null;
  address_postal_code?: string | null;
  address_city?: string | null;
  phone?: string | null;
  website?: string | null;
  contact_email?: string | null;
}

export function buildContactBlock(name: string | null | undefined, info: ContactInfo | null | undefined): string {
  const esc = (s: string | null | undefined) =>
    (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines: string[] = [];
  if (name) lines.push(`<strong>${esc(name)}</strong>`);
  if (info) {
    if (info.address_street) lines.push(esc(info.address_street));
    if (info.address_complement) lines.push(esc(info.address_complement));
    const cityLine = [info.address_postal_code, info.address_city].filter(Boolean).join(" ").trim();
    if (cityLine) lines.push(esc(cityLine));
    if (info.phone) lines.push(`Tél : ${esc(info.phone)}`);
    if (info.website) lines.push(`Web : ${esc(info.website)}`);
    if (info.contact_email) lines.push(`Email : ${esc(info.contact_email)}`);
  }
  return lines.join("<br>");
}

const LETTER_BODY_CSS = `
    .letter-body p { margin: 0.6em 0; }
    .letter-body h2 { font-size: 14pt; font-weight: bold; margin: 1em 0 0.5em; }
    .letter-body h3 { font-size: 13pt; font-weight: bold; margin: 0.8em 0 0.4em; }
    .letter-body ul, .letter-body ol { padding-left: 1.5em; margin: 0.5em 0; }
    .letter-body hr { border: none; border-top: 1px solid #ccc; margin: 1em 0; }
    .letter-body img[alt="signature-clara"] { display: block; height: 70px; width: auto; object-fit: contain; margin-top: 0.5em; }
    .letter-body img:not([alt="signature-clara"]) { max-width: 100%; height: auto; page-break-inside: avoid; }
    h2, h3 { page-break-after: avoid; }
    img { page-break-inside: avoid; }`;

function formatDate(dateStr: string | null): string {
  return dateStr
    ? new Date(dateStr).toLocaleDateString("fr-FR", { dateStyle: "long" })
    : new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });
}

function escape(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function openAndPrint(printWin: Window, html: string): void {
  const triggerPrint = () => {
    try {
      printWin.focus();
      printWin.print();
      printWin.addEventListener("afterprint", () => printWin.close());
    } catch {
      /* popup may have been closed manually */
    }
  };

  // Register before writing so we don't miss the load event
  printWin.addEventListener("load", triggerPrint, { once: true });

  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();

  // Fallback: if the document is already complete (synchronous content with no
  // external resources), the load event may not fire — trigger after images settle.
  const fallback = () => {
    if (printWin.closed) return;
    const imgs = Array.from(printWin.document.images || []);
    const pending = imgs.filter((img) => !img.complete);
    if (pending.length === 0) {
      triggerPrint();
      return;
    }
    let remaining = pending.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) triggerPrint();
    };
    pending.forEach((img) => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
  };
  setTimeout(fallback, 100);
}

export function printReply(options: PrintReplyOptions): void {
  const printWin = window.open("", "_blank", "width=900,height=700");
  if (!printWin) throw new Error("La fenêtre d'impression a été bloquée par le navigateur. Autorisez les popups pour ce site.");

  const dateStr = formatDate(options.date);

  if (options.templateHtml) {
    const compiled = Handlebars.compile(options.templateHtml);
    const merged = compiled({
      date: dateStr,
      objet: options.subject ?? "",
      contenu: new Handlebars.SafeString(options.bodyHtml),
      expediteur: options.senderName ?? "",
      organisation: options.organizationName ?? "",
      organisation_complete: new Handlebars.SafeString(options.organizationCompleteHtml ?? ""),
      service: options.serviceName ?? "",
      service_complete: new Handlebars.SafeString(options.serviceCompleteHtml ?? ""),
    });
    openAndPrint(printWin, merged);
    return;
  }

  // Standard layout (no template)
  openAndPrint(printWin, `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${escape(options.subject) || "Réponse"}</title>
  <style>
    @page { size: A4; margin: 2.5cm; }
    body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.6; color: #000; background: white; margin: 0; }
    .org-name { font-weight: bold; font-size: 13pt; }
    .date-line { text-align: right; margin-top: 1em; font-size: 11pt; }
    .recipient-line { margin-top: 2em; }
    .letter-subject { font-weight: bold; margin: 1.5em 0; text-decoration: underline; }${LETTER_BODY_CSS}
  </style>
</head>
<body>
  <div class="letter-header">
    ${options.organizationName ? `<div class="org-name">${escape(options.organizationName)}</div>` : ""}
    <div class="date-line">${dateStr}</div>
    ${options.senderName ? `<div class="recipient-line">${escape(options.senderName)}</div>` : ""}
  </div>
  ${options.subject ? `<div class="letter-subject">Objet : ${escape(options.subject)}</div>` : ""}
  <div class="letter-body">${options.bodyHtml}</div>
</body>
</html>`);
}
