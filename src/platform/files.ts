/**
 * File save behind an adapter (DESIGN.md §8). Anchor download today; Tauri's
 * fs plugin at M3. The File System Access API is deliberately not used — it is
 * outside the Safari baseline in §2.3.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in some engines; defer it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
