// Direct-to-Azure Block Blob upload utilities.
// Uses plain fetch() with SAS URLs — no Azure SDK needed.

/** Base64-encoded, equal-length block IDs for ordered commits. */
function blockId(index: number): string {
  return btoa(String(index).padStart(6, '0'));
}

/** PUT a single block to Azure Blob Storage. Retries up to 3 times. */
export async function putBlock(
  sasUrl: string,
  index: number,
  data: Blob,
): Promise<void> {
  const id = blockId(index);
  const sep = sasUrl.includes('?') ? '&' : '?';
  const url = `${sasUrl}${sep}comp=block&blockid=${encodeURIComponent(id)}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Length': String(data.size),
        },
        body: data,
      });
      if (res.ok) return;
      lastErr = new Error(`PUT Block ${index} failed: ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    // Exponential backoff: 1s, 2s, 4s
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastErr ?? new Error(`PUT Block ${index} failed after retries`);
}

/** Commit all uploaded blocks into a single blob via Put Block List. */
export async function putBlockList(
  sasUrl: string,
  blockCount: number,
): Promise<void> {
  const ids = Array.from({ length: blockCount }, (_, i) => blockId(i));
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<BlockList>',
    ...ids.map((id) => `  <Latest>${id}</Latest>`),
    '</BlockList>',
  ].join('\n');

  const sep = sasUrl.includes('?') ? '&' : '?';
  const url = `${sasUrl}${sep}comp=blocklist`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/xml',
      'x-ms-blob-content-type': 'video/webm',
    },
    body: xml,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Put Block List failed: ${res.status} ${res.statusText} — ${body}`);
  }
}

/** Upload a single blob in one shot (for screenshots/thumbnails). */
export async function putBlobSingle(
  sasUrl: string,
  data: Blob,
  contentType: string,
): Promise<void> {
  const sep = sasUrl.includes('?') ? '&' : '?';
  // Use BlockBlob type for single-shot upload
  const url = `${sasUrl}${sep}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': contentType,
          'Content-Length': String(data.size),
        },
        body: data,
      });
      if (res.ok) return;
      lastErr = new Error(`PUT Blob failed: ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastErr ?? new Error('PUT Blob failed after retries');
}
