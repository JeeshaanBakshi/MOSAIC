import "server-only";
// Reading an uploaded bill PDF back out of the file store (for the download route). Kept apart from the engine so it
// is not callable through the /api/rpc door.
import { read } from "../engine/store";
import { getStorage } from "./storage";

export async function readStatementFile(id: number): Promise<{ bytes: Buffer; fileName: string } | null> {
  const st = read().db.statements[id];
  if (!st) return null;
  const b64 = await getStorage().getFile(st.fileKey);
  return b64 ? { bytes: Buffer.from(b64, "base64"), fileName: st.fileName } : null;
}
