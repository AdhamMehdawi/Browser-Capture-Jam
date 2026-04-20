import { useState, useMemo } from "react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";
import { 
  ArrowLeft, Share2, Globe, Terminal, MousePointerClick, Activity, 
  Search, Info, Clock, AlertCircle, Play, Pause, AlertTriangle 
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

export default function RecordingViewer() {
  const params = useParams();
  const id = params.id as string;
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<NetworkLogEntry | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
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
    
    return recording.events.filter(event => {
      // Tab filter
      if (activeTab !== "all" && event.type !== activeTab) return false;
      
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
    if (type === "click") return <MousePointerClick className="text-primary h-4 w-4" />;
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

  const videoUrl = recording.videoObjectPath 
    ? `/api/storage/${recording.videoObjectPath.replace(/^\/objects\//, '')}`
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
        <Button onClick={handleShare} variant="outline" className="gap-2 font-medium">
          <Share2 size={16} /> Share
        </Button>
      </header>

      {/* Main Content - Video & Logs */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Column - Video (if available) & Log List */}
        <div className="flex-1 flex flex-col border-r border-border min-w-0 overflow-hidden">
          {videoUrl && (
            <div className="bg-black shrink-0 relative aspect-video max-h-[40vh] border-b border-border flex items-center justify-center">
              <video 
                src={videoUrl} 
                controls 
                className="w-full h-full object-contain"
                preload="metadata"
              />
            </div>
          )}

          <div className="flex-1 flex flex-col bg-background min-h-0">
            <div className="p-3 border-b border-border flex items-center justify-between bg-card shrink-0 gap-4">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-muted">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="request" className="gap-1.5"><Globe size={14} /> Network</TabsTrigger>
                  <TabsTrigger value="console" className="gap-1.5"><Terminal size={14} /> Console</TabsTrigger>
                  <TabsTrigger value="click" className="gap-1.5"><MousePointerClick size={14} /> UI</TabsTrigger>
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
                    className={`px-4 py-2 flex items-start gap-3 text-sm cursor-pointer hover:bg-accent/50 transition-colors font-mono ${
                      selectedLog?.id === event.id ? 'bg-accent border-l-2 border-l-primary pl-[14px]' : 'pl-4'
                    }`}
                  >
                    <div className="text-muted-foreground w-14 shrink-0 pt-0.5 text-xs text-right">
                      {event.timestamp}ms
                    </div>
                    <div className="mt-0.5 shrink-0">
                      {getLogIcon(event.type, event.level, event.status)}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      {event.type === 'request' && (
                        <div className="flex items-center gap-2 truncate">
                          <span className={`font-bold ${
                            event.method === 'GET' ? 'text-blue-400' : 
                            event.method === 'POST' ? 'text-green-400' : 'text-orange-400'
                          }`}>{event.method}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            event.status && event.status >= 400 ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'
                          }`}>
                            {event.status || 'PENDING'}
                          </span>
                          <span className="truncate" title={event.url || ''}>{event.url}</span>
                        </div>
                      )}
                      {event.type === 'console' && (
                        <div className={`truncate ${
                          event.level === 'error' ? 'text-destructive' : 
                          event.level === 'warn' ? 'text-orange-400' : 'text-foreground'
                        }`}>
                          {event.message}
                        </div>
                      )}
                      {event.type === 'click' && (
                        <div className="text-muted-foreground truncate">
                          User clicked: <span className="text-foreground">{event.message}</span>
                        </div>
                      )}
                    </div>
                    {event.duration && (
                      <div className="text-muted-foreground text-xs shrink-0 pt-0.5 w-12 text-right">
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

        {/* Right Column - Detail Panel */}
        <div className="w-full md:w-[450px] lg:w-[550px] shrink-0 bg-card flex flex-col border-t md:border-t-0 border-border z-10 shadow-[-10px_0_20px_-10px_rgba(0,0,0,0.1)]">
          {selectedLog ? (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="p-4 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  {getLogIcon(selectedLog.type, selectedLog.level, selectedLog.status)}
                  <h3 className="font-bold capitalize">{selectedLog.type} Details</h3>
                  <Badge variant="outline" className="ml-auto font-mono text-xs">{selectedLog.timestamp}ms</Badge>
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
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Request Payload</p>
                          <div className="bg-muted/50 border border-border/50 rounded-md p-3 font-mono text-xs overflow-x-auto whitespace-pre">
                            {selectedLog.requestBody}
                          </div>
                        </div>
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

                  {/* Click/UI specific details */}
                  {selectedLog.type === 'click' && (
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Element Info</p>
                      <div className="bg-muted/50 border border-border/50 rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                        {selectedLog.message}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
              <Terminal className="h-12 w-12 opacity-20 mb-4" />
              <p className="font-medium">No log selected</p>
              <p className="text-sm mt-1">Select an event from the timeline to view its details.</p>
            </div>
          )}
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
