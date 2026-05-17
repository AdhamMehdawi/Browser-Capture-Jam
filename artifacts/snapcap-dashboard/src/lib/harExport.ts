// ============================================================
// HAR exporter — feature #12
//
// Converts captured `request`-type events from a recording into the
// HTTP Archive (HAR) 1.2 format so the user can drop the file into
// Chrome DevTools / Charles / Postman / Fiddler / etc. and inspect
// every request the user made during the bug.
//
// Spec: https://w3c.github.io/web-performance/specs/HAR/Overview.html
// ============================================================

type AnyEvent = Record<string, any>;

interface HarKv {
  name: string;
  value: string;
}

interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    cookies: never[];
    headers: HarKv[];
    queryString: HarKv[];
    headersSize: number;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    cookies: never[];
    headers: HarKv[];
    content: { size: number; mimeType: string; text?: string };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { send: number; wait: number; receive: number };
  serverIPAddress?: string;
  _resourceType?: string;
}

interface HarLog {
  log: {
    version: "1.2";
    creator: { name: string; version: string };
    browser?: { name: string; version: string };
    pages: Array<{
      startedDateTime: string;
      id: string;
      title: string;
      pageTimings: { onContentLoad: number; onLoad: number };
    }>;
    entries: HarEntry[];
  };
}

function headersToHar(h: Record<string, unknown> | undefined): HarKv[] {
  if (!h || typeof h !== "object") return [];
  return Object.entries(h).map(([name, value]) => ({
    name,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

function queryStringFromUrl(url: string): HarKv[] {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function bytesOfString(s: string | undefined): number {
  if (!s) return 0;
  try { return new TextEncoder().encode(s).length; } catch { return s.length; }
}

interface ToHarInput {
  recordingId: string;
  recordingTitle: string;
  pageUrl: string | null;
  events: AnyEvent[];
  browserInfo?: { userAgent?: string } | null;
}

export function eventsToHar({
  recordingId,
  recordingTitle,
  pageUrl,
  events,
  browserInfo,
}: ToHarInput): HarLog {
  const requests = events.filter((e) => e?.type === "request");

  // Earliest event timestamp = the start of the recording (matches the rest
  // of our code). Falls back to "now" if nothing useful is in the array.
  let earliest = Infinity;
  for (const e of events) {
    if (typeof e?.timestamp === "number" && e.timestamp < earliest) {
      earliest = e.timestamp;
    }
  }
  if (earliest === Infinity) earliest = Date.now();

  const pageId = `page_${recordingId}`;

  const entries: HarEntry[] = requests.map((r) => {
    const startedAt = typeof r.timestamp === "number" ? r.timestamp : earliest;
    const durationMs = typeof r.duration === "number" ? r.duration : 0;

    const requestHeaders = headersToHar(r.requestHeaders);
    const responseHeaders = headersToHar(r.responseHeaders);
    const requestBodyText = typeof r.requestBody === "string" ? r.requestBody : undefined;
    const responseBodyText = typeof r.responseBody === "string" ? r.responseBody : undefined;

    const mimeType = (() => {
      const ct = responseHeaders.find((h) => h.name.toLowerCase() === "content-type")?.value;
      return ct ? String(ct).split(";")[0].trim() : "";
    })();

    return {
      pageref: pageId,
      startedDateTime: new Date(startedAt).toISOString(),
      time: durationMs,
      request: {
        method: String(r.method ?? "GET").toUpperCase(),
        url: String(r.url ?? ""),
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: requestHeaders,
        queryString: queryStringFromUrl(String(r.url ?? "")),
        headersSize: -1,
        bodySize: bytesOfString(requestBodyText),
        ...(requestBodyText
          ? { postData: { mimeType: "text/plain", text: requestBodyText } }
          : {}),
      } as HarEntry["request"] & { postData?: { mimeType: string; text: string } },
      response: {
        status: typeof r.status === "number" ? r.status : 0,
        statusText: String(r.statusText ?? ""),
        httpVersion: "HTTP/1.1",
        cookies: [],
        headers: responseHeaders,
        content: {
          size: bytesOfString(responseBodyText),
          mimeType: mimeType || "application/octet-stream",
          ...(responseBodyText ? { text: responseBodyText } : {}),
        },
        redirectURL: "",
        headersSize: -1,
        bodySize: bytesOfString(responseBodyText),
      },
      cache: {},
      timings: {
        // We don't capture phase-level timings (DNS/SSL/wait/receive). HAR
        // requires non-negative values; -1 means "not applicable".
        send: 0,
        wait: durationMs,
        receive: 0,
      },
      _resourceType: "fetch",
    } as HarEntry;
  });

  return {
    log: {
      version: "1.2",
      creator: { name: "VeloCap", version: "1" },
      ...(browserInfo?.userAgent
        ? { browser: { name: browserInfo.userAgent, version: "" } }
        : {}),
      pages: [
        {
          startedDateTime: new Date(earliest).toISOString(),
          id: pageId,
          title: recordingTitle || pageUrl || "VeloCap recording",
          pageTimings: { onContentLoad: -1, onLoad: -1 },
        },
      ],
      entries,
    },
  };
}

export function downloadHar(filename: string, har: HarLog): void {
  const blob = new Blob([JSON.stringify(har, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".har") ? filename : `${filename}.har`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the blob URL on next tick — Safari needs this delay.
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function safeFilenameForRecording(title: string, id: string): string {
  const slug = (title || "recording")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "recording";
  return `velocap-${slug}-${id.slice(0, 8)}.har`;
}
