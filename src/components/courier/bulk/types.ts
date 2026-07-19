// Types partagés du parcours d'import en masse. Historiquement dupliqués dans
// chaque étape du wizard — centralisés ici, source de vérité unique.

export interface BulkFile {
  id: string;
  file: File;
  previewUrl: string;
  groupId: number | null;
  rejected: boolean;
  rejectReason?: string;
}

export interface DraftCourier {
  id: string;
  title: string;
  senderName: string;
  senderEmail: string;
  recipientName: string;
  serviceId: string;
  serviceName: string;
  tags: string[];
  bodyText: string;
  fileIds: string[];
  confidence: number;
  flags: Array<"missing-service" | "duplicate">;
}

export function getGroupIds(files: BulkFile[]): number[] {
  const ids = new Set<number>();
  files.forEach((f) => { if (f.groupId !== null && !f.rejected) ids.add(f.groupId); });
  return Array.from(ids).sort((a, b) => a - b);
}

export function nextGroupId(files: BulkFile[]): number {
  const ids = getGroupIds(files);
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}
