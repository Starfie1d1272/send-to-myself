import { sendClipboard } from "./send-clipboard";

export default async function Command() {
  await sendClipboard("new");
}
