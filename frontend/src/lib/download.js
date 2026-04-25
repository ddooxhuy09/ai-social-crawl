/**
 * Download a plain JavaScript value as a pretty-printed JSON file.
 * Creates and immediately revokes the object URL to prevent memory leaks.
 */
export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}

/**
 * Trigger a browser file-download for an arbitrary Blob.
 * Revokes the object URL after the click so there are no memory leaks.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Fetch a crawl history entry from the backend as a CSV and trigger a download.
 * @param {object} item     - History item with `id` and `keyword` fields.
 * @param {string} apiBase  - API base URL (empty string in production, localhost in dev).
 * @param {Function} onError - Called with an error message string on failure.
 */
export async function downloadHistoryCsv(item, apiBase, onError) {
  try {
    const res = await fetch(`${apiBase}/api/history/${item.id}/download`);
    if (!res.ok) throw new Error("Tải CSV thất bại.");
    const filename = `pins_${(item.keyword || "data").replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`;
    downloadBlob(await res.blob(), filename);
  } catch (err) {
    onError?.(err.message || "Không tải được CSV.");
  }
}
