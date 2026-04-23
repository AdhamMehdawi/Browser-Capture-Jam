import { useState, useMemo, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";
import {
  ArrowLeft, Share2, Globe, Terminal, MousePointerClick, Activity,
  Search, Info, Clock, AlertCircle, Play, Pause, AlertTriangle,
  TextCursorInput, MousePointer, Navigation, SquareMousePointer, CornerDownLeft,
  X as CloseIcon,
} from "lucide-react";
import { useGetRecording, useCreateShareLink } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { NetworkLogEntry, getGetRecordingQueryKey } from "@workspace/api-client-react";

// ============================================================
// PayloadBlock — readable viewer for request/response bodies
//   • auto-detects JSON / URL-encoded / text
//   • pretty-prints JSON with syntax coloring
//   • copy-to-clipboard
//   • size/kind badges so you know what you're looking at
// ============================================================
type PayloadKind = "json" | "form" | "text";

function detectPayload(body: string): { formatted: string; kind: PayloadKind } {
  const trimmed = body.trim();
  // JSON: object/array that parses cleanly
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return { formatted: JSON.stringify(JSON.parse(trimmed), null, 2), kind: "json" };
    } catch {
      /* fall through */
    }
  }
  // URL-encoded form (single-line, at least one k=v pair, no braces)
  if (
    !trimmed.includes("\n") &&
    /^[A-Za-z0-9._~\-\[\]]+=/.test(trimmed) &&
    !trimmed.startsWith("{") &&
    !trimmed.startsWith("[")
  ) {
    try {
      const entries = Array.from(new URLSearchParams(trimmed).entries());
      if (entries.length) {
        const widest = Math.min(32, Math.max(...entries.map(([k]) => k.length)));
        return {
          formatted: entries.map(([k, v]) => `${k.padEnd(widest)}  ${v}`).join("\n"),
          kind: "form",
        };
      }
    } catch {
      /* fall through */
    }
  }
  return { formatted: body, kind: "text" };
}

// Syntax-highlight a JSON string. Dangerous-HTML is fine here because the
// text is fully escaped inside the function; only the span wrappers are raw.
function highlightJson(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls: string;
      if (/^"/.test(match)) cls = /:$/.test(match) ? "text-orange-400" : "text-emerald-400";
      else if (/^(?:true|false)$/.test(match)) cls = "text-violet-400";
      else if (match === "null") cls = "text-rose-400";
      else cls = "text-sky-400";
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

// ============================================================
// FixedVideoPlayer
//   Many recordings in the DB were made before the extension patched
//   the EBML Duration element, so Chrome reports `duration: Infinity`
//   and the scrub bar is unusable. We fetch the video as a blob,
//   patch its duration client-side using the Jam's known duration,
//   then serve it via blob: URL.
// ============================================================
function FixedVideoPlayer({
  videoUrl,
  knownDurationMs,
}: {
  videoUrl: string;
  knownDurationMs: number | null | undefined;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createdBlobUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);

    (async () => {
      try {
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        let patched = blob;
        if (knownDurationMs && knownDurationMs > 0 && blob.type.includes('webm')) {
          try {
            const mod = await import('fix-webm-duration');
            const fixer = (mod as { default?: unknown }).default ?? mod;
            patched = await new Promise<Blob>((resolve, reject) => {
              (fixer as (b: Blob, d: number, cb: (out: Blob) => void) => void)(
                blob,
                knownDurationMs,
                (out) => resolve(out),
              );
              setTimeout(() => reject(new Error('patcher timeout')), 5000);
            }).catch((e) => {
              console.warn('[dashboard] duration patch failed, using raw blob', e);
              return blob;
            });
          } catch (e) {
            console.warn('[dashboard] fix-webm-duration import failed', e);
          }
        }
        if (cancelled) return;
        const url = URL.createObjectURL(patched);
        if (createdBlobUrl.current) URL.revokeObjectURL(createdBlobUrl.current);
        createdBlobUrl.current = url;
        setSrc(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (createdBlobUrl.current) {
        URL.revokeObjectURL(createdBlobUrl.current);
        createdBlobUrl.current = null;
      }
    };
  }, [videoUrl, knownDurationMs]);

  return (
    <div className="bg-black flex-1 relative w-full flex items-center justify-center">
      {src ? (
        <video
          src={src}
          controls
          className="w-full h-full object-contain"
          preload="metadata"
          onLoadedMetadata={(e) => {
            // Belt-and-braces: if the patcher silently returned the raw
            // blob, fall back to the seek-to-huge-time hack.
            const v = e.currentTarget;
            if (v.duration === Infinity || Number.isNaN(v.duration)) {
              const onSeeked = () => {
                v.removeEventListener('seeked', onSeeked);
                v.currentTime = 0;
              };
              v.addEventListener('seeked', onSeeked);
              v.currentTime = 1e101;
            }
          }}
        />
      ) : error ? (
        <div className="text-destructive text-sm p-6 text-center">
          Video failed to load: {error}
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">Preparing video…</div>
      )}
    </div>
  );
}

// ============================================================
// Cypress exporter
//   Translates captured action events into a runnable Cypress spec.
//   Good defaults:
//     • prefers cy.contains('tag', 'text') for clicked text links/buttons
//       when we have stable text
//     • .clear().type() for text inputs, with [masked] → Cypress.env()
//     • dedupes adjacent navigations, merges click+nav into url assert
//     • drops clicks on our own extension UI (already stripped upstream)
// ============================================================
type AnyEvent = Record<string, any>;

function jsEscape(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function generateCypressSpec(events: AnyEvent[], pageUrl: string | null): string {
  const ACTION_TYPES = new Set(['click', 'input', 'select', 'submit', 'navigation']);
  const actions = [...events]
    .filter((e) => ACTION_TYPES.has(e.type))
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  const lines: string[] = [];
  const describeName = pageUrl ? new URL(pageUrl).host : 'captured session';

  lines.push(`// Generated by VeloRec from a recording`);
  lines.push(`describe('${jsEscape(describeName)}', () => {`);
  lines.push(`  it('replays the captured user flow', () => {`);

  let firstNav = true;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const sel = a.selector || '';

    if (a.type === 'navigation') {
      if (firstNav) {
        lines.push(`    cy.visit('${jsEscape(a.url || pageUrl || '/')}');`);
        firstNav = false;
      } else {
        // Skip duplicates already coalesced upstream; for the rest, assert
        // that the URL landed where we expected.
        try {
          const path = new URL(a.url).pathname;
          lines.push(`    cy.url().should('include', '${jsEscape(path)}');`);
        } catch {
          /* ignore malformed */
        }
      }
      continue;
    }

    if (a.type === 'click') {
      if (a.targetText && ['BUTTON', 'A', 'LABEL', 'SPAN'].includes((a.targetTag || '').toUpperCase())) {
        lines.push(`    cy.contains('${jsEscape(a.targetTag)}', '${jsEscape(a.targetText)}').click();`);
      } else {
        lines.push(`    cy.get('${jsEscape(sel)}').click();`);
      }
      continue;
    }

    if (a.type === 'input') {
      const masked = a.value === '[masked]';
      const val = masked
        ? `Cypress.env('${a.targetName?.toUpperCase() || 'VALUE'}')`
        : `'${jsEscape(a.value ?? '')}'`;
      lines.push(`    cy.get('${jsEscape(sel)}').clear().type(${val});`);
      continue;
    }

    if (a.type === 'select') {
      lines.push(`    cy.get('${jsEscape(sel)}').select('${jsEscape(a.value ?? '')}');`);
      continue;
    }

    if (a.type === 'submit') {
      lines.push(`    cy.get('${jsEscape(sel)}').submit();`);
      continue;
    }
  }

  lines.push(`  });`);
  lines.push(`});`);
  return lines.join('\n');
}

function PayloadBlock({ label, body }: { label: string; body: string }) {
  const { formatted, kind } = useMemo(() => detectPayload(body), [body]);
  const bytes = new Blob([body]).size;
  const sizeLabel = bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

  const copy = () => {
    navigator.clipboard.writeText(formatted).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Copy failed"),
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {kind}
          </span>
          <span className="text-[10px] text-muted-foreground">{sizeLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] uppercase"
            onClick={copy}
          >
            Copy
          </Button>
        </div>
      </div>
      <pre className="bg-muted/50 border border-border/50 rounded-md p-3 font-mono text-xs overflow-x-auto whitespace-pre break-all max-h-[320px] overflow-y-auto">
        {kind === "json" ? (
          <code
            className="block"
            dangerouslySetInnerHTML={{ __html: highlightJson(formatted) }}
          />
        ) : (
          <code className="block">{formatted}</code>
        )}
      </pre>
    </div>
  );
}

export default function RecordingViewer() {
  const params = useParams();
  const id = params.id as string;
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<NetworkLogEntry | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // Auto-open the detail drawer whenever an event is selected. Closing it
  // clears the selection too so the drawer is easy to reopen via clicking
  // another event.
  useEffect(() => {
    if (selectedLog) setDetailOpen(true);
  }, [selectedLog]);
  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetailOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailOpen]);
  const [shareUrl, setShareUrl] = useState("");

  const { data: recording, isLoading } = useGetRecording(id, {
    query: { enabled: !!id, queryKey: getGetRecordingQueryKey(id) }
  });

  const createShareLink = useCreateShareLink();

  const handleShare = () => {
    if (recording?.shareToken) {
      const url = `${window.location.origin}/share/${recording.shareToken}`;
      setShareUrl(url);
      setShareModalOpen(true);
      return;
    }

    createShareLink.mutate({ id }, {
      onSuccess: (res) => {
        const url = `${window.location.origin}/share/${res.shareToken}`;
        setShareUrl(url);
        setShareModalOpen(true);
        toast.success("Share link created!");
      },
      onError: () => {
        toast.error("Failed to create share link");
      }
    });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success("Copied to clipboard");
  };

  const filteredEvents = useMemo(() => {
    if (!recording?.events) return [];
    
    const ACTION_TYPES = new Set(['click', 'input', 'select', 'submit', 'navigation']);
    return recording.events.filter(event => {
      // Tab filter
      if (activeTab === 'actions') {
        if (!ACTION_TYPES.has(event.type)) return false;
      } else if (activeTab !== "all" && event.type !== activeTab) return false;
      
      // Search filter
      if (search) {
        const query = search.toLowerCase();
        const matchesUrl = event.url?.toLowerCase().includes(query);
        const matchesMsg = event.message?.toLowerCase().includes(query);
        const matchesStatus = event.status?.toString().includes(query);
        return matchesUrl || matchesMsg || matchesStatus;
      }
      
      return true;
    }).sort((a, b) => a.timestamp - b.timestamp);
  }, [recording?.events, activeTab, search]);

  const getLogIcon = (type: string, level?: string | null, status?: number | null) => {
    if (type === "request") {
      if (status && status >= 400) return <AlertCircle className="text-destructive h-4 w-4" />;
      return <Globe className="text-blue-500 h-4 w-4" />;
    }
    if (type === "console") {
      if (level === "error") return <AlertCircle className="text-destructive h-4 w-4" />;
      if (level === "warn") return <AlertTriangle className="text-orange-500 h-4 w-4" />;
      return <Terminal className="text-muted-foreground h-4 w-4" />;
    }
    if (type === "click") return <MousePointer className="text-primary h-4 w-4" />;
    if (type === "input") return <TextCursorInput className="text-emerald-500 h-4 w-4" />;
    if (type === "select") return <SquareMousePointer className="text-amber-500 h-4 w-4" />;
    if (type === "submit") return <CornerDownLeft className="text-rose-500 h-4 w-4" />;
    if (type === "navigation") return <Navigation className="text-sky-500 h-4 w-4" />;
    if (type === "performance") return <Activity className="text-purple-500 h-4 w-4" />;
    return <Info className="text-muted-foreground h-4 w-4" />;
  };

  if (isLoading) {
    return <div className="p-8 space-y-6">
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-[400px] w-full" />
      <Skeleton className="h-64 w-full" />
    </div>;
  }

  if (!recording) {
    return <div className="p-8 text-center text-muted-foreground">Recording not found.</div>;
  }

  // Handle both old (/local-media/) and new (/objects/local/) path formats
  const videoUrl = recording.videoObjectPath
    ? `/api/storage/${recording.videoObjectPath.replace(/^\/objects\//, '').replace(/^\/local-media\//, 'local/')}`
    : null;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0 bg-card">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft size={18} />
            </Button>
          </Link>
          <div>
            <h1 className="font-semibold text-lg leading-none">{recording.title}</h1>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 font-mono">
                <Clock size={12} />
                {format(new Date(recording.createdAt), "MMM d, yyyy HH:mm:ss")}
              </span>
              {recording.pageUrl && (
                <span className="flex items-center gap-1">
                  <Globe size={12} />
                  <a href={recording.pageUrl} target="_blank" rel="noreferrer" className="hover:underline text-blue-400">
                    {new URL(recording.pageUrl).hostname}
                  </a>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              const spec = generateCypressSpec(recording.events ?? [], recording.pageUrl);
              navigator.clipboard.writeText(spec).then(
                () => toast.success('Cypress spec copied'),
                () => toast.error('Copy failed'),
              );
            }}
            variant="outline"
            className="gap-2 font-medium"
            title="Generate a Cypress spec from captured actions"
          >
            <Activity size={16} /> Copy Cypress
          </Button>
          <Button
            onClick={() => {
              const spec = generateCypressSpec(recording.events ?? [], recording.pageUrl);
              const blob = new Blob([spec], { type: 'text/javascript' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `velorec-${recording.id}.cy.js`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
            variant="outline"
            className="gap-2 font-medium"
          >
            Download .cy.js
          </Button>
          <Button onClick={handleShare} variant="outline" className="gap-2 font-medium">
            <Share2 size={16} /> Share
          </Button>
        </div>
      </header>

      {/* Main Content - Video on left, Logs on right */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Column - Video */}
        {videoUrl && (
          <div className="md:w-[45%] lg:w-[40%] shrink-0 flex flex-col border-r border-border bg-black">
            <FixedVideoPlayer videoUrl={videoUrl} knownDurationMs={recording.duration} />
          </div>
        )}

        {/* Right Column - Log List */}
        <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${!videoUrl ? 'w-full' : ''}`}>
          <div className="flex-1 flex flex-col bg-background min-h-0">
            <div className="p-3 border-b border-border flex items-center justify-between bg-card shrink-0 gap-4">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-muted">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="request" className="gap-1.5"><Globe size={14} /> Network</TabsTrigger>
                  <TabsTrigger value="console" className="gap-1.5"><Terminal size={14} /> Console</TabsTrigger>
                  <TabsTrigger value="click" className="gap-1.5"><MousePointerClick size={14} /> UI</TabsTrigger>
                  <TabsTrigger value="actions" className="gap-1.5"><MousePointerClick size={14} /> Actions</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="relative w-64 shrink-0">
                <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Filter logs..." 
                  className="h-8 pl-8 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="divide-y divide-border">
                {filteredEvents.map((event, i) => (
                  <div
                    key={event.id || i}
                    onClick={() => setSelectedLog(event)}
                    className={`px-4 py-2.5 flex items-start gap-3 text-sm cursor-pointer hover:bg-accent/50 transition-colors ${
                      selectedLog?.id === event.id ? 'bg-accent border-l-2 border-l-primary pl-[14px]' : 'pl-4'
                    }`}
                  >
                    <div className="text-muted-foreground shrink-0 pt-0.5 text-[10px] font-mono tabular-nums">
                      {event.timestamp}
                    </div>
                    <div className="mt-0.5 shrink-0">
                      {getLogIcon(event.type, event.level, event.status)}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5 overflow-hidden">
                      {event.type === 'request' && (
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold shrink-0 ${
                            event.method === 'GET' ? 'text-blue-400' :
                            event.method === 'POST' ? 'text-green-400' : 'text-orange-400'
                          }`}>{event.method}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${
                            event.status && event.status >= 400 ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'
                          }`}>
                            {event.status || 'PENDING'}
                          </span>
                          <span className="truncate text-xs" title={event.url || ''}>{event.url}</span>
                        </div>
                      )}
                      {event.type === 'console' && (
                        <div className={`truncate text-xs ${
                          event.level === 'error' ? 'text-destructive' :
                          event.level === 'warn' ? 'text-orange-400' : 'text-foreground'
                        }`}>
                          {event.message}
                        </div>
                      )}
                      {event.type === 'click' && (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-primary font-medium text-xs">click</span>
                            {event.targetText && (
                              <span className="text-foreground text-xs truncate">"{event.targetText}"</span>
                            )}
                          </div>
                          <code className="text-muted-foreground text-[10px] block truncate">{event.selector || event.message}</code>
                        </div>
                      )}
                      {event.type === 'input' && (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-500 font-medium text-xs">input</span>
                            <span className="text-emerald-400 text-xs truncate">= {event.value ?? ''}</span>
                          </div>
                          <code className="text-muted-foreground text-[10px] block truncate">{event.selector}</code>
                        </div>
                      )}
                      {event.type === 'select' && (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-amber-500 font-medium text-xs">select</span>
                            <span className="text-amber-400 text-xs truncate">→ {event.value ?? ''}</span>
                          </div>
                          <code className="text-muted-foreground text-[10px] block truncate">{event.selector}</code>
                        </div>
                      )}
                      {event.type === 'submit' && (
                        <div className="space-y-0.5">
                          <span className="text-rose-500 font-medium text-xs">submit</span>
                          <code className="text-muted-foreground text-[10px] block truncate">{event.selector}</code>
                        </div>
                      )}
                      {event.type === 'navigation' && (
                        <div className="flex items-center gap-2">
                          <span className="text-sky-500 font-medium text-xs shrink-0">navigate</span>
                          <span className="text-sky-400 text-xs truncate">{event.url}</span>
                        </div>
                      )}
                    </div>
                    {event.duration && (
                      <div className="text-muted-foreground text-[10px] font-mono shrink-0 pt-0.5 tabular-nums">
                        {Math.round(event.duration)}ms
                      </div>
                    )}
                  </div>
                ))}
                {filteredEvents.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    No logs match your filters.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Right-side detail drawer — hidden by default, slides in when an
            event is selected. Click-backdrop / X / Esc to close. */}
        <div
          className={`fixed inset-0 bg-black/40 z-40 transition-opacity ${
            detailOpen && selectedLog ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onClick={() => setDetailOpen(false)}
          aria-hidden="true"
        />
        <div
          className={`fixed right-0 top-0 h-full w-full md:w-[500px] lg:w-[580px] bg-card border-l border-border z-50 shadow-2xl flex flex-col transition-transform duration-200 ease-out ${
            detailOpen && selectedLog ? "translate-x-0" : "translate-x-full"
          }`}
          role="complementary"
          aria-label="Event details"
        >
          {selectedLog ? (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="p-4 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  {getLogIcon(selectedLog.type, selectedLog.level, selectedLog.status)}
                  <h3 className="font-bold capitalize">{selectedLog.type} Details</h3>
                  <Badge variant="outline" className="font-mono text-xs">{selectedLog.timestamp}ms</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    onClick={() => setDetailOpen(false)}
                    aria-label="Close details"
                  >
                    <CloseIcon size={18} />
                  </Button>
                </div>
                {selectedLog.type === 'request' && (
                  <div className="font-mono text-sm break-all leading-snug">
                    <span className="font-bold mr-2 text-primary">{selectedLog.method}</span>
                    {selectedLog.url}
                  </div>
                )}
              </div>
              
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-6">
                  {/* Network specific details */}
                  {selectedLog.type === 'request' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Status</p>
                          <p className={`font-mono text-sm ${selectedLog.status && selectedLog.status >= 400 ? 'text-destructive' : 'text-green-500'}`}>
                            {selectedLog.status}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Duration</p>
                          <p className="font-mono text-sm">{selectedLog.duration ? `${Math.round(selectedLog.duration)}ms` : '-'}</p>
                        </div>
                      </div>

                      {selectedLog.requestHeaders && Object.keys(selectedLog.requestHeaders).length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Request Headers</p>
                          <div className="bg-muted/50 rounded-md p-3 font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre">
                            {Object.entries(selectedLog.requestHeaders).map(([k, v]) => (
                              <div key={k}><span className="text-blue-400">{k}:</span> {String(v)}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedLog.responseHeaders && Object.keys(selectedLog.responseHeaders).length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Response Headers</p>
                          <div className="bg-muted/50 rounded-md p-3 font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre">
                            {Object.entries(selectedLog.responseHeaders).map(([k, v]) => (
                              <div key={k}><span className="text-blue-400">{k}:</span> {String(v)}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedLog.requestBody && (
                        <PayloadBlock label="Request Payload" body={selectedLog.requestBody} />
                      )}

                      {(selectedLog as any).responseBody && (
                        <PayloadBlock label="Response Payload" body={(selectedLog as any).responseBody} />
                      )}
                    </>
                  )}

                  {/* Console specific details */}
                  {selectedLog.type === 'console' && (
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Message</p>
                      <div className={`bg-muted/50 border border-border/50 rounded-md p-3 font-mono text-xs overflow-x-auto whitespace-pre-wrap ${
                        selectedLog.level === 'error' ? 'text-destructive border-destructive/20 bg-destructive/5' : ''
                      }`}>
                        {selectedLog.message}
                      </div>
                      {selectedLog.error && (
                        <div className="mt-4">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Stack Trace</p>
                          <div className="bg-background border border-destructive/30 rounded-md p-3 font-mono text-[11px] text-destructive overflow-x-auto whitespace-pre">
                            {selectedLog.error}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action-event details: click / input / select / submit / navigation */}
                  {(['click','input','select','submit','navigation'] as const).includes(selectedLog.type as any) && (
                    <div className="space-y-4">
                      {selectedLog.selector && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Primary Selector</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] uppercase"
                              onClick={() => {
                                navigator.clipboard.writeText(selectedLog.selector);
                                toast.success('Copied selector');
                              }}
                            >
                              Copy
                            </Button>
                          </div>
                          <code className="block bg-muted/50 border border-border/50 rounded-md p-3 font-mono text-xs break-all">
                            {selectedLog.selector}
                          </code>
                        </div>
                      )}

                      {Array.isArray(selectedLog.selectorAlts) && selectedLog.selectorAlts.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                            Alternate Selectors
                          </p>
                          <div className="space-y-1">
                            {selectedLog.selectorAlts.map((s: string, i: number) => (
                              <code
                                key={i}
                                className="block bg-muted/50 border border-border/50 rounded-md px-3 py-2 font-mono text-[11px] break-all"
                              >
                                {s}
                              </code>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Action</p>
                          <p className="font-mono text-sm capitalize">{selectedLog.type}</p>
                        </div>
                        {selectedLog.targetTag && (
                          <div>
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Tag</p>
                            <p className="font-mono text-sm">&lt;{selectedLog.targetTag}&gt;</p>
                          </div>
                        )}
                        {selectedLog.targetText && (
                          <div className="col-span-2">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Text</p>
                            <p className="font-mono text-sm">"{selectedLog.targetText}"</p>
                          </div>
                        )}
                        {selectedLog.targetRole && (
                          <div>
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Role</p>
                            <p className="font-mono text-sm">{selectedLog.targetRole}</p>
                          </div>
                        )}
                        {selectedLog.inputType && (
                          <div>
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Input Type</p>
                            <p className="font-mono text-sm">{selectedLog.inputType}</p>
                          </div>
                        )}
                        {selectedLog.targetName && (
                          <div>
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Name</p>
                            <p className="font-mono text-sm">{selectedLog.targetName}</p>
                          </div>
                        )}
                        {selectedLog.url && (
                          <div className="col-span-2">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">URL at time</p>
                            <p className="font-mono text-[11px] break-all text-muted-foreground">{selectedLog.url}</p>
                          </div>
                        )}
                      </div>

                      {selectedLog.value != null && selectedLog.value !== '' && (
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Value</p>
                          <code className="block bg-muted/50 border border-border/50 rounded-md p-3 font-mono text-xs break-all">
                            {selectedLog.value}
                          </code>
                        </div>
                      )}

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Cypress Snippet</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] uppercase"
                            onClick={() => {
                              const snippet = generateCypressSpec([selectedLog], recording?.pageUrl ?? null);
                              navigator.clipboard.writeText(snippet);
                              toast.success('Snippet copied');
                            }}
                          >
                            Copy
                          </Button>
                        </div>
                        <pre className="bg-muted/50 border border-border/50 rounded-md p-3 font-mono text-[11px] overflow-x-auto">
                          {generateCypressSpec([selectedLog], recording?.pageUrl ?? null)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={shareModalOpen} onOpenChange={setShareModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Recording</DialogTitle>
            <DialogDescription>
              Anyone with this link can view this recording. No sign-in required.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 mt-4">
            <div className="grid flex-1 gap-2">
              <Input
                readOnly
                value={shareUrl}
                className="font-mono text-sm bg-muted"
              />
            </div>
            <Button type="button" size="sm" className="px-3" onClick={copyToClipboard}>
              Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
