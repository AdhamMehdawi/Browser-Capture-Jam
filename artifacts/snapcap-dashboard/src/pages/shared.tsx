import { useState, useMemo, useEffect } from "react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";
import { StreamingVideoPlayer } from "@/components/StreamingVideoPlayer";
import {
  Globe, Terminal, MousePointerClick, Activity,
  Search, Info, Clock, AlertCircle, AlertTriangle,
  TextCursorInput, MousePointer, Navigation, SquareMousePointer, CornerDownLeft,
  X as CloseIcon, Copy, Check,
} from "lucide-react";
import { useGetSharedRecording } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { NetworkLogEntry, getGetSharedRecordingQueryKey } from "@workspace/api-client-react";

// ============================================================
// CopyButton
// ============================================================
function CopyButton({ text, title = "Copy", size = 14 }: { text: string; title?: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded transition-colors shrink-0 ${copied ? 'text-green-500' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
      title={copied ? 'Copied!' : title}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

// ============================================================
// PayloadBlock
// ============================================================
type PayloadKind = "json" | "form" | "text";

function detectPayload(body: string): { formatted: string; kind: PayloadKind } {
  const trimmed = body.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return { formatted: JSON.stringify(JSON.parse(trimmed), null, 2), kind: "json" };
    } catch { /* fall through */ }
  }
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
    } catch { /* fall through */ }
  }
  return { formatted: body, kind: "text" };
}

function highlightJson(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

function PayloadBlock({ label, body }: { label: string; body: string }) {
  const { formatted, kind } = detectPayload(body);
  const sizeLabel = body.length < 1024 ? `${body.length} B` : `${(body.length / 1024).toFixed(1)} KB`;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
          kind === "json" ? "bg-emerald-500/10 text-emerald-500" :
          kind === "form" ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground"
        }`}>{kind}</span>
        <span className="text-[10px] text-muted-foreground">{sizeLabel}</span>
        <CopyButton text={formatted} title="Copy payload" />
      </div>
      <pre className="bg-muted/50 border border-border/50 rounded-md p-3 font-mono text-xs whitespace-pre-wrap break-all max-h-[320px] overflow-y-auto">
        {kind === "json" ? (
          <code className="block" dangerouslySetInnerHTML={{ __html: highlightJson(formatted) }} />
        ) : (
          <code className="block">{formatted}</code>
        )}
      </pre>
    </div>
  );
}

// FixedVideoPlayer removed — replaced by StreamingVideoPlayer (shared component)

// ============================================================
// SharedRecordingViewer
// ============================================================

type AnyEvent = NetworkLogEntry;

export default function SharedRecordingViewer() {
  const params = useParams();
  const token = params.token as string;
  const [activeTab, setActiveTab] = useState<string>("info");
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<NetworkLogEntry | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    if (selectedLog) setDetailOpen(true);
  }, [selectedLog]);
  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetailOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailOpen]);

  const { data: recording, isLoading } = useGetSharedRecording(token, {
    query: { enabled: !!token, retry: false, queryKey: getGetSharedRecordingQueryKey(token) }
  });

  const filteredEvents = useMemo(() => {
    if (!recording?.events) return [];
    const ACTION_TYPES = new Set(['click', 'input', 'select', 'submit', 'navigation']);
    return recording.events.filter(event => {
      if (activeTab === 'actions') {
        if (!ACTION_TYPES.has(event.type)) return false;
      } else if (activeTab === 'info') return false;
      else if (event.type !== activeTab) return false;

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
    return (
      <div className="p-8 space-y-6 h-screen flex flex-col items-center justify-center bg-background">
        <Skeleton className="h-12 w-12 rounded-full mb-4" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background text-center p-6">
        <AlertCircle className="h-16 w-16 text-muted-foreground mb-4 opacity-50" />
        <h1 className="text-2xl font-bold mb-2">Recording Not Found</h1>
        <p className="text-muted-foreground max-w-md">
          This share link is invalid or has expired. Please ask the creator to generate a new link.
        </p>
        <Link href="/">
          <a className="mt-6 text-primary hover:underline font-medium">Go to VeloCap Home</a>
        </Link>
      </div>
    );
  }

  // Use SAS URLs from API response (direct Azure access), fall back to proxy URL
  const apiBase = import.meta.env.VITE_API_URL ?? "";
  const mediaPath = recording.videoObjectPath;
  const proxyUrl = mediaPath ? `${apiBase}/api/storage${mediaPath}` : null;
  const isScreenshot = mediaPath && /\.(png|jpg|jpeg|gif|webp)$/i.test(mediaPath);
  const videoUrl = !isScreenshot ? ((recording as any).videoUrl ?? proxyUrl) : null;
  const screenshotUrl = isScreenshot ? ((recording as any).videoUrl ?? proxyUrl) : null;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0 bg-card">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-lg leading-none">{recording.title}</h1>
              <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider py-0 px-1.5 border-primary/30 text-primary bg-primary/5">
                Read Only
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 font-mono">
                <Clock size={12} />
                {format(new Date(recording.createdAt), "MMM d, yyyy HH:mm:ss")}
              </span>
              {recording.pageUrl && (
                <span className="flex items-center gap-1">
                  <Globe size={12} />
                  <a href={recording.pageUrl} target="_blank" rel="noreferrer" className="hover:underline text-blue-400">
                    {(() => { try { return new URL(recording.pageUrl).hostname; } catch { return recording.pageUrl; } })()}
                  </a>
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Left Column — Media */}
        {(videoUrl || screenshotUrl) && (
          <>
          <ResizablePanel defaultSize={65} minSize={30}>
            <div className="h-full flex flex-col bg-muted/30 overflow-auto">
              <div className="flex items-start justify-center p-4 pt-6">
                {videoUrl ? (
                  <div className="w-full max-w-5xl">
                    <div className="rounded-lg shadow-lg bg-black">
                      <StreamingVideoPlayer
                        videoUrl={videoUrl}
                        knownDurationMs={recording.duration}
                        trimStartMs={(recording as any).trimStartMs}
                        trimEndMs={(recording as any).trimEndMs}
                      />
                    </div>
                  </div>
                ) : screenshotUrl ? (
                  <div className="w-full max-w-5xl">
                    <img src={screenshotUrl} alt={recording.title} className="w-full h-auto block" />
                  </div>
                ) : null}
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          </>
        )}

        {/* Right Column — Tabs */}
        <ResizablePanel defaultSize={35} minSize={20} maxSize={60}>
        <div className="h-full flex flex-col">
          {/* Tab headers */}
          <div className="border-b border-border bg-card shrink-0 overflow-x-auto">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-max min-w-full justify-start rounded-none border-0 bg-transparent h-auto p-0">
                {[
                  { value: 'info', label: 'Info', icon: <Info size={14} /> },
                  { value: 'console', label: 'Console', icon: <Terminal size={14} /> },
                  { value: 'request', label: 'Network', icon: <Globe size={14} /> },
                  { value: 'actions', label: 'Actions', icon: <MousePointerClick size={14} /> },
                ].map(tab => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-xs font-medium gap-1.5"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* Tab content */}
          <div className="flex-1 flex flex-col bg-background min-h-0">
            {/* Info Tab */}
            {activeTab === 'info' && (
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                  {recording.pageUrl && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">URL</p>
                      <a href={recording.pageUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-400 hover:underline break-all">
                        {recording.pageUrl}
                      </a>
                    </div>
                  )}

                  {recording.tags && recording.tags.length > 0 && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Tags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {recording.tags.map((tag, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Timestamp</p>
                    <p className="text-sm">{format(new Date(recording.createdAt), "MMM d, yyyy 'at' h:mm a 'GMT'xxx")}</p>
                  </div>

                  {recording.browserInfo && (() => {
                    const bi = recording.browserInfo as Record<string, unknown>;
                    const screen = bi.screen as Record<string, number> | undefined;
                    const viewport = bi.viewport as Record<string, number> | undefined;
                    return (
                      <>
                        {bi.timezone && (
                          <div>
                            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Location</p>
                            <p className="text-sm">{String(bi.timezone)}</p>
                          </div>
                        )}
                        {bi.platform && (
                          <div>
                            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">OS</p>
                            <p className="text-sm">{String(bi.platform)}</p>
                          </div>
                        )}
                        {bi.userAgent && (
                          <div>
                            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Browser</p>
                            <p className="text-sm break-all">{String(bi.userAgent).split(' ').slice(-1)[0]}</p>
                          </div>
                        )}
                        {viewport && (
                          <div>
                            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Window size</p>
                            <p className="text-sm font-mono">{viewport.width}x{viewport.height}</p>
                          </div>
                        )}
                        {screen && (
                          <div>
                            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Screen</p>
                            <p className="text-sm font-mono">{screen.width}x{screen.height} @{screen.dpr}x</p>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Stats</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/50 rounded-md p-2.5">
                        <p className="text-lg font-semibold">{recording.networkLogsCount}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Requests</p>
                      </div>
                      <div className="bg-muted/50 rounded-md p-2.5">
                        <p className="text-lg font-semibold text-destructive">{recording.errorCount}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Errors</p>
                      </div>
                      <div className="bg-muted/50 rounded-md p-2.5">
                        <p className="text-lg font-semibold">{recording.consoleCount}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Console</p>
                      </div>
                      <div className="bg-muted/50 rounded-md p-2.5">
                        <p className="text-lg font-semibold">{recording.clickCount}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">Clicks</p>
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            )}

            {/* Log Tabs */}
            {activeTab !== 'info' && (
              <>
                <div className="p-2 border-b border-border shrink-0">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter logs..."
                      className="h-8 pl-8 text-sm"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>

                {/* Network tab — table */}
                {activeTab === 'request' && (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-xs font-mono border-collapse min-w-[700px] border border-border">
                      <thead className="sticky top-0 bg-card z-10">
                        <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 font-medium w-8 border border-border">#</th>
                          <th className="px-3 py-2 font-medium w-16 border border-border">Method</th>
                          <th className="px-3 py-2 font-medium w-14 border border-border">Status</th>
                          <th className="px-3 py-2 font-medium border border-border">URL</th>
                          <th className="px-3 py-2 font-medium w-24 border border-border">Domain</th>
                          <th className="px-3 py-2 font-medium w-16 text-right border border-border">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEvents.map((event, i) => {
                          let domain = '';
                          try { domain = event.url ? new URL(event.url).hostname : ''; } catch { domain = ''; }
                          const urlPath = (() => { try { return event.url ? new URL(event.url).pathname + new URL(event.url).search : event.url || ''; } catch { return event.url || ''; } })();
                          return (
                            <tr
                              key={event.id || i}
                              onClick={() => setSelectedLog(event)}
                              className={`border-b border-border cursor-pointer transition-colors ${
                                selectedLog?.id === event.id ? 'bg-accent' : 'hover:bg-accent/50'
                              } ${event.status && event.status >= 400 ? 'text-destructive' : ''}`}
                            >
                              <td className="px-3 py-2 text-muted-foreground border border-border">{i + 1}</td>
                              <td className="px-3 py-2 border border-border">
                                <span className={`font-bold ${
                                  event.method === 'GET' ? 'text-blue-400' :
                                  event.method === 'POST' ? 'text-green-400' :
                                  event.method === 'PUT' ? 'text-amber-400' :
                                  event.method === 'DELETE' ? 'text-red-400' : 'text-orange-400'
                                }`}>{event.method}</span>
                              </td>
                              <td className="px-3 py-2 border border-border">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                  event.status && event.status >= 400 ? 'bg-destructive/20 text-destructive' :
                                  event.status && event.status >= 300 ? 'bg-amber-500/20 text-amber-500' :
                                  'bg-emerald-500/10 text-emerald-500'
                                }`}>
                                  {event.status || 'PENDING'}
                                </span>
                              </td>
                              <td className="px-3 py-2 truncate max-w-[200px] border border-border" title={event.url || ''}>
                                {urlPath}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground truncate max-w-[100px] border border-border" title={domain}>
                                {domain}
                              </td>
                              <td className="px-3 py-2 text-right text-muted-foreground tabular-nums border border-border">
                                {event.duration ? `${Math.round(event.duration)}ms` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredEvents.length === 0 && (
                      <div className="p-8 text-center text-muted-foreground text-sm">No requests match your filters.</div>
                    )}
                  </div>
                )}

                {/* Console & Actions tabs — list */}
                {activeTab !== 'request' && (
                  <div className="flex-1 overflow-auto">
                    <div className="divide-y divide-border w-[700px]">
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
                            {event.type === 'console' && (
                              <div className={`text-xs whitespace-nowrap ${
                                event.level === 'error' ? 'text-destructive' :
                                event.level === 'warn' ? 'text-orange-400' : 'text-foreground'
                              }`}>
                                {event.message}
                              </div>
                            )}
                            {event.type === 'click' && (
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                  <span className="text-primary font-medium text-xs">click</span>
                                  {event.targetText && <span className="text-foreground text-xs">"{event.targetText}"</span>}
                                </div>
                                <code className="text-muted-foreground text-[10px] block whitespace-nowrap">{event.selector || event.message}</code>
                              </div>
                            )}
                            {event.type === 'input' && (
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                  <span className="text-emerald-500 font-medium text-xs">input</span>
                                  <span className="text-emerald-400 text-xs">= {event.value ?? ''}</span>
                                </div>
                                <code className="text-muted-foreground text-[10px] block whitespace-nowrap">{event.selector}</code>
                              </div>
                            )}
                            {event.type === 'select' && (
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                  <span className="text-amber-500 font-medium text-xs">select</span>
                                  <span className="text-amber-400 text-xs">{event.value ?? ''}</span>
                                </div>
                                <code className="text-muted-foreground text-[10px] block whitespace-nowrap">{event.selector}</code>
                              </div>
                            )}
                            {event.type === 'submit' && (
                              <div className="space-y-0.5">
                                <span className="text-rose-500 font-medium text-xs">submit</span>
                                <code className="text-muted-foreground text-[10px] block whitespace-nowrap">{event.selector}</code>
                              </div>
                            )}
                            {event.type === 'navigation' && (
                              <div className="flex items-center gap-2 whitespace-nowrap">
                                <span className="text-sky-500 font-medium text-xs shrink-0">navigate</span>
                                <span className="text-sky-400 text-xs">{event.url}</span>
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
                        <div className="p-8 text-center text-muted-foreground text-sm">No logs match your filters.</div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        </ResizablePanel>
      </ResizablePanelGroup>

        {/* Detail drawer overlay */}
        <div
          className={`fixed inset-0 bg-black/40 z-40 transition-opacity ${
            detailOpen && selectedLog ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onClick={() => setDetailOpen(false)}
          aria-hidden="true"
        />
        <div
          className={`fixed right-0 top-0 h-full w-full md:w-[600px] lg:w-[700px] bg-card border-l border-border z-50 shadow-2xl flex flex-col transition-transform duration-200 ease-out ${
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
                  {selectedLog.duration && <Badge variant="outline" className="font-mono text-xs">{Math.round(selectedLog.duration)}ms</Badge>}
                  <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setDetailOpen(false)} aria-label="Close details">
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

              <ScrollArea className="flex-1">
                <div className="space-y-6 p-4">
                  {/* Network details */}
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
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Request Headers</p>
                            <CopyButton text={Object.entries(selectedLog.requestHeaders!).map(([k, v]) => `${k}: ${String(v)}`).join('\n')} title="Copy all request headers" />
                          </div>
                          <div className="bg-muted/50 rounded-md p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
                            {Object.entries(selectedLog.requestHeaders).map(([k, v]) => (
                              <div key={k}><span className="text-blue-400">{k}:</span> {String(v)}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedLog.responseHeaders && Object.keys(selectedLog.responseHeaders).length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Response Headers</p>
                            <CopyButton text={Object.entries(selectedLog.responseHeaders!).map(([k, v]) => `${k}: ${String(v)}`).join('\n')} title="Copy all response headers" />
                          </div>
                          <div className="bg-muted/50 rounded-md p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
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

                  {/* Console details */}
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
                          <div className="bg-background border border-destructive/30 rounded-md p-3 font-mono text-[11px] text-destructive whitespace-pre-wrap break-all">
                            {selectedLog.error}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action details */}
                  {(['click','input','select','submit','navigation'] as const).includes(selectedLog.type as any) && (
                    <div className="space-y-4">
                      {selectedLog.selector && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Primary Selector</p>
                            <CopyButton text={selectedLog.selector} title="Copy selector" />
                          </div>
                          <code className="block bg-muted/50 border border-border/50 rounded-md p-3 font-mono text-xs break-all">
                            {selectedLog.selector}
                          </code>
                        </div>
                      )}

                      {Array.isArray(selectedLog.selectorAlts) && selectedLog.selectorAlts.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Alternate Selectors</p>
                          <div className="space-y-1">
                            {selectedLog.selectorAlts.map((s: string, i: number) => (
                              <code key={i} className="block bg-muted/50 border border-border/50 rounded-md px-3 py-2 font-mono text-[11px] break-all">{s}</code>
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
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : null}
        </div>
    </div>
  );
}
