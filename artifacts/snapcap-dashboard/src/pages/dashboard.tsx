import { useState } from "react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { Search, Video, Clock, Globe, AlertCircle, LayoutGrid, List as ListIcon, Trash2, Activity } from "lucide-react";
import { useListRecordings, useGetRecordingStats, useDeleteRecording, getListRecordingsQueryKey, getGetRecordingStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const { data: stats, isLoading: statsLoading } = useGetRecordingStats();
  const { data: recordingsData, isLoading: recordingsLoading } = useListRecordings({ 
    search: search || undefined,
    tag: tagFilter || undefined,
    limit: 50
  });

  const deleteRecording = useDeleteRecording();

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    console.log("Delete clicked for id:", id);

    try {
      // Direct fetch as a workaround
      const apiBase = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiBase}/api/recordings/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      console.log("Delete response:", response.status);

      if (response.ok) {
        toast.success("Recording deleted");
        queryClient.invalidateQueries({ queryKey: getListRecordingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecordingStatsQueryKey() });
      } else {
        const errorText = await response.text();
        console.error("Delete failed:", response.status, errorText);
        toast.error("Failed to delete recording");
      }
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete recording");
    }
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your recording activity and stats.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setTagFilter(undefined)} className={!tagFilter ? "bg-accent" : ""}>
            All
          </Button>
          {/* Mock tags for filtering - in a real app these would be derived from the data */}
          <Button variant="outline" onClick={() => setTagFilter("bug")} className={tagFilter === "bug" ? "bg-accent" : ""}>
            Bug
          </Button>
          <Button variant="outline" onClick={() => setTagFilter("feature")} className={tagFilter === "feature" ? "bg-accent" : ""}>
            Feature
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-muted-foreground">Total Recordings</p>
                <Video className="h-4 w-4 text-primary" />
              </div>
              <div className="text-3xl font-bold">{stats.totalRecordings}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-muted-foreground">Total Requests Logged</p>
                <Globe className="h-4 w-4 text-blue-500" />
              </div>
              <div className="text-3xl font-bold">{stats.totalRequests.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-muted-foreground">Total Errors Captured</p>
                <AlertCircle className="h-4 w-4 text-destructive" />
              </div>
              <div className="text-3xl font-bold">{stats.totalErrors.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between space-y-0 pb-2">
                <p className="text-sm font-medium text-muted-foreground">Avg Error Rate</p>
                <Activity className="h-4 w-4 text-orange-500" />
              </div>
              <div className="text-3xl font-bold">{stats.avgErrorRate.toFixed(1)}%</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search recordings..."
                className="pl-9 bg-card"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex bg-card border border-border rounded-md p-1">
              <Button 
                variant="ghost" 
                size="sm" 
                className={`px-2 h-7 ${viewMode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid size={16} />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className={`px-2 h-7 ${viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}
                onClick={() => setViewMode('list')}
              >
                <ListIcon size={16} />
              </Button>
            </div>
          </div>

          {recordingsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
            </div>
          ) : recordingsData?.recordings?.length === 0 ? (
            <div className="text-center py-24 border border-dashed rounded-xl bg-card">
              <Video className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No recordings found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Install the Chrome extension to start recording sessions.
              </p>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-3"}>
              {recordingsData?.recordings.map((recording) => (
                <Link key={recording.id} href={`/recordings/${recording.id}`} className="block">
                  <Card className={`group hover:border-primary/50 transition-colors cursor-pointer ${viewMode === 'list' ? 'flex flex-row items-center p-4' : 'flex flex-col overflow-hidden'}`}>
                    {viewMode === 'grid' && (
                      <div className="aspect-video bg-muted relative border-b border-border flex items-center justify-center overflow-hidden">
                        {(() => {
                          const path = recording.videoObjectPath;
                          const thumbPath = recording.thumbnailObjectPath;
                          const apiBase = import.meta.env.VITE_API_URL ?? "";
                          const storageUrl = (p: string) => `${apiBase}/api/storage/${p.replace(/^\/objects\//, '').replace(/^\/local-media\//, 'local/')}`;
                          const isImage = path && /\.(png|jpg|jpeg|gif|webp)$/i.test(path);
                          const isVideo = path && !isImage && (
                            /\.(webm|mp4|mov|avi|mkv)$/i.test(path) ||
                            recording.duration > 1000 ||
                            !/\.[a-z0-9]+$/i.test(path)
                          );

                          if (isVideo) {
                            return (
                              <div className="absolute inset-0 bg-black flex items-center justify-center">
                                {thumbPath && (
                                  <img
                                    src={storageUrl(thumbPath)}
                                    className="w-full h-full object-cover absolute inset-0 z-10 thumbnail-img"
                                    alt=""
                                    loading="lazy"
                                  />
                                )}
                                <video
                                  src={storageUrl(path!)}
                                  className="w-full h-full object-cover absolute inset-0"
                                  muted
                                  loop
                                  playsInline
                                  preload={thumbPath ? "none" : "metadata"}
                                  onMouseEnter={(e) => {
                                    const thumb = e.currentTarget.parentElement?.querySelector('.thumbnail-img') as HTMLElement | null;
                                    if (thumb) thumb.style.display = 'none';
                                    e.currentTarget.play();
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.pause();
                                    e.currentTarget.currentTime = 0;
                                    const thumb = e.currentTarget.parentElement?.querySelector('.thumbnail-img') as HTMLElement | null;
                                    if (thumb) thumb.style.display = '';
                                  }}
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    const fallback = e.currentTarget.parentElement?.querySelector('.video-fallback');
                                    if (fallback) (fallback as HTMLElement).style.display = 'flex';
                                  }}
                                />
                                {!thumbPath && (
                                  <div className="video-fallback hidden absolute inset-0 items-center justify-center text-muted-foreground flex-col">
                                    <Activity className="h-8 w-8 mb-2 opacity-20" />
                                    <span className="text-xs font-mono">Preview unavailable</span>
                                  </div>
                                )}
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none group-hover:opacity-0 transition-opacity bg-black/30 z-20">
                                  <Video className="h-10 w-10 text-white/60" />
                                </div>
                                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded font-mono z-20">
                                  {formatDuration(recording.duration)}
                                </div>
                              </div>
                            );
                          } else if (isImage) {
                            return (
                              <div className="absolute inset-0 bg-black flex items-center justify-center">
                                <img
                                  src={storageUrl(path!)}
                                  className="w-full h-full object-cover"
                                  alt={recording.title}
                                />
                              </div>
                            );
                          } else {
                            return (
                              <div className="text-muted-foreground flex flex-col items-center">
                                <Activity className="h-8 w-8 mb-2 opacity-20" />
                                <span className="text-xs font-mono">Logs Only</span>
                              </div>
                            );
                          }
                        })()}
                      </div>
                    )}

                    <div className={`p-5 flex-1 flex flex-col ${viewMode === 'list' ? 'p-0' : ''}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0 pr-4">
                          <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">
                            {recording.title}
                          </h3>
                          <p className="text-sm text-muted-foreground truncate mt-1 flex items-center gap-1.5">
                            <Globe size={12} />
                            {recording.pageUrl ? new URL(recording.pageUrl).hostname : 'Unknown site'}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => handleDelete(recording.id, e)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>

                    <div className={`mt-auto flex items-center justify-between text-xs text-muted-foreground ${viewMode === 'list' ? 'hidden' : ''}`}>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1" title="Errors">
                          <AlertCircle size={12} className={recording.errorCount > 0 ? "text-destructive" : ""} />
                          {recording.errorCount}
                        </span>
                        <span className="flex items-center gap-1" title="Network Requests">
                          <Globe size={12} />
                          {recording.networkLogsCount}
                        </span>
                      </div>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatDistanceToNow(new Date(recording.createdAt), { addSuffix: true })}
                      </span>
                    </div>

                    {/* List View specifics */}
                    {viewMode === 'list' && (
                      <div className="flex items-center gap-6 ml-auto pl-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1.5 w-16" title="Errors">
                            <AlertCircle size={14} className={recording.errorCount > 0 ? "text-destructive" : ""} />
                            {recording.errorCount}
                          </span>
                          <span className="flex items-center gap-1.5 w-16" title="Network Requests">
                            <Globe size={14} />
                            {recording.networkLogsCount}
                          </span>
                          <span className="flex items-center gap-1.5 w-20 font-mono">
                            <Clock size={14} />
                            {formatDuration(recording.duration)}
                          </span>
                        </div>
                        <span className="w-24 text-right whitespace-nowrap">
                          {format(new Date(recording.createdAt), "MMM d")}
                        </span>
                      </div>
                    )}
                  </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Activity size={16} className="text-primary" />
                Requests Over Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : stats?.requestsByDay && stats.requestsByDay.length > 0 ? (
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.requestsByDay} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(val) => format(new Date(val), "MMM d")}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                        dy={10}
                      />
                      <YAxis 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                      />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
                        labelFormatter={(val) => format(new Date(val), "MMM d, yyyy")}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="count" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorCount)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg">
                  Not enough data yet
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertCircle size={16} className="text-destructive" />
                Top Error Pages
              </CardTitle>
              <CardDescription>Pages with the highest error rates</CardDescription>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : stats?.topErrorPages && stats.topErrorPages.length > 0 ? (
                <div className="space-y-4">
                  {stats.topErrorPages.map((page, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="bg-destructive/10 text-destructive font-mono text-xs w-6 h-6 flex items-center justify-center rounded shrink-0">
                          {i + 1}
                        </div>
                        <span className="text-sm font-medium truncate" title={page.pageUrl}>
                          {page.pageUrl.replace(/^https?:\/\//, '')}
                        </span>
                      </div>
                      <Badge variant="destructive" className="ml-2 shrink-0">{page.errorCount}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
                  No errors recorded yet. Good job!
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
