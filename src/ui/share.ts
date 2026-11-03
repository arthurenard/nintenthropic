/**
 * Passing a picture on: to the system's share sheet where the browser shares files, otherwise saved as a download
 * (and a toast says where). The arcade's results card and Grip Prix's finish-line photos both go this way.
 */
import { toast } from "./dom";

/** Shares or saves a PNG as `name`, its share sheet titled `title`. */
export async function shareOrSave(blob: Blob, name: string, title: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type || "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (error) {
      if ((error as Error).name === "AbortError") return; // the player closed the share sheet
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  toast("Saved to your Downloads.", { icon: "check" });
}
