/** Fields used by the extension; transport compatibility is tested against the real API. */
export interface Item {
  id: string;
  content: string;
  kind: string;
  sensitive: boolean;
  attachments?: Array<{ id: string; filename: string; mimeType: string; size: number }>;
}
