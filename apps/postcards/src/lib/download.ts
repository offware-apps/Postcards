import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * Hand `blob` to the user as `filename`. Inside the native wrap (iOS/Android)
 * the WebView ignores an anchor download, so the file is written to the app
 * cache and handed to the system share sheet (Files, Drive, mail…); in a browser
 * it is a plain download.
 */
export async function downloadBlob(filename: string, blob: Blob): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const { uri } = await Filesystem.writeFile({ path: filename, data: btoa(bin), directory: Directory.Cache });
    await Share.share({ title: filename, url: uri });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke after the click has a chance to start the download (revoking
  // synchronously can cancel it in some browsers).
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Hand `text` to the user as `filename`, tagged with MIME `type` (see downloadBlob). */
export function download(filename: string, text: string, type: string): Promise<void> {
  return downloadBlob(filename, new Blob([text], { type }));
}
