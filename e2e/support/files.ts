// Fichiers de test fabriqués à la volée (aucun binaire versionné) : un PDF
// d'une page portant du texte, lisible par l'OCR, et une image PNG minimale.

/** PDF d'une page, police Helvetica, une ligne de texte par entrée de `lines`. */
export function textPdf(lines: string[]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, (c) => {
    const map: Record<string, string> = { é: "e", è: "e", ê: "e", à: "a", ç: "c", ù: "u", î: "i", ô: "o", É: "E" };
    return map[c] ?? "?";
  });
  const content =
    "BT /F1 14 Tf 60 760 Td 20 TL\n" + lines.map((l) => `(${esc(l)}) Tj T*`).join("\n") + "\nET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (pdf += `${String(o).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/** PNG 1×1 : image valide, sans texte (cas « pièce illisible » / signature). */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Courrier type : de quoi alimenter l'analyse (demande claire, expéditeur, objet). */
export function courrierTypePdf(marker: string): Buffer {
  return textPdf([
    "Madame le Maire,",
    "",
    `Objet : demande de reparation de l'eclairage public (${marker})`,
    "",
    "Je vous ecris pour signaler que le lampadaire situe au 12 rue des Lilas",
    "est eteint depuis trois semaines. Pourriez-vous faire intervenir vos services",
    "dans les meilleurs delais ? Je souhaite recevoir une reponse ecrite.",
    "",
    "Cordialement,",
    "Jeanne Exemple",
    "12 rue des Lilas, 75000 Paris",
    "jeanne.exemple@example.test",
  ]);
}
