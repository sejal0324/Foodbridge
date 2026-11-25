import { apiGetBlob } from './apiClient';

/**
 * Downloads an authenticated file (PDF certificate, invoice, verification
 * document) as a blob and saves it with the server-provided filename.
 */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const { blob, filename } = await apiGetBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename ?? fallbackName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
}
