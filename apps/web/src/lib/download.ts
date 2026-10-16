/**
 * Hands text to the browser as a file download (Blob plus `<a download>`,
 * which the CSP allows: `img-src … blob:` is not involved, the anchor only
 * navigates to the blob URL for the download).
 */
export function downloadText(filename: string, text: string, type: string): void {
  downloadBlob(filename, new Blob([text], { type }));
}

/**
 * Hands a blob to the browser as a file download, byte for byte (a server
 * download such as the open-questions CSV keeps its byte order mark).
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
