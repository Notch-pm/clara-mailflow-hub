// Clé d'une porte de dépôt de serveur à serveur (`nora-courrier`,
// `iris-courrier`) : une clé par appelant, comparée à temps constant sur les
// empreintes (longueurs égales). Une clé absente côté Clara ne laisse RIEN passer.

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function keyMatches(presented: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Le jeton d'un en-tête `Authorization: Bearer …`, ou chaîne vide. */
export function bearerOf(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}
