import { useState, useEffect, useRef, memo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import "plyr/dist/plyr.css";

interface StreamingVideoPlayerProps {
  videoUrl: string;
  knownDurationMs: number | null | undefined;
  trimStartMs?: number | null;
  trimEndMs?: number | null;
  onExpired?: () => void;
}

function StreamingVideoPlayerImpl({
  videoUrl,
  knownDurationMs,
  trimStartMs,
  trimEndMs,
  onExpired,
}: StreamingVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plyrRef = useRef<{ destroy(): void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const knownSec = knownDurationMs ? knownDurationMs / 1000 : 0;
  const trimStartSec = (trimStartMs ?? 0) / 1000;
  const trimEndSec = trimEndMs ? trimEndMs / 1000 : 0;
  const hasTrim = trimStartMs != null && trimEndMs != null;

  // Reset ready state when URL changes
  useEffect(() => {
    setReady(false);
  }, [videoUrl]);

  // Initialize Plyr when videoUrl changes
  useEffect(() => {
    if (!videoRef.current) return;
    let player: { destroy(): void } | null = null;
    let cancelled = false;

    import("plyr").then((mod) => {
      if (cancelled || !videoRef.current) return;
      const PlyrClass = (mod.default ?? mod) as unknown as new (
        el: HTMLVideoElement,
        opts: Record<string, unknown>,
      ) => { destroy(): void };
      player = new PlyrClass(videoRef.current, {
        controls: [
          "play-large",
          "rewind",
          "play",
          "fast-forward",
          "progress",
          "current-time",
          "duration",
          "mute",
          "volume",
          "settings",
          "fullscreen",
        ],
        settings: ["speed"],
        speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
        keyboard: { focused: true, global: false },
        tooltips: { controls: true, seek: true },
        seekTime: 5,
        ...(knownSec > 0 ? { duration: knownSec } : {}),
      });
      plyrRef.current = player;
    });

    return () => {
      cancelled = true;
      if (player) {
        try {
          player.destroy();
        } catch (e) {
          if (import.meta.env.DEV) {
            console.debug("[velocap] plyr destroy threw (safe):", e);
          }
        }
        plyrRef.current = null;
      }
    };
  }, [videoUrl, knownSec]);

  // Enforce trim bounds during playback
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !hasTrim) return;

    const handleTimeUpdate = () => {
      if (v.currentTime < trimStartSec) {
        v.currentTime = trimStartSec;
      }
      if (trimEndSec > 0 && v.currentTime >= trimEndSec) {
        v.pause();
        v.currentTime = trimStartSec;
      }
    };

    const handleSeeked = () => {
      if (v.currentTime < trimStartSec) {
        v.currentTime = trimStartSec;
      }
    };

    v.addEventListener("timeupdate", handleTimeUpdate);
    v.addEventListener("loadedmetadata", handleSeeked);

    if (v.readyState >= 1 && v.currentTime < trimStartSec) {
      v.currentTime = trimStartSec;
    }

    return () => {
      v.removeEventListener("timeupdate", handleTimeUpdate);
      v.removeEventListener("loadedmetadata", handleSeeked);
    };
  }, [hasTrim, trimStartSec, trimEndSec]);

  // Fix WebM duration fallback for old recordings without duration metadata
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const fixAfterPlay = () => {
      v.removeEventListener("playing", fixAfterPlay);
      const reported = v.duration;
      if (
        !Number.isFinite(reported) ||
        Number.isNaN(reported) ||
        (knownSec > 0 && reported < knownSec * 0.8)
      ) {
        setTimeout(() => {
          const onSeeked = () => {
            v.removeEventListener("seeked", onSeeked);
            v.currentTime = v.currentTime > 1e100 ? 0 : v.currentTime;
          };
          v.addEventListener("seeked", onSeeked);
          v.currentTime = 1e101;
        }, 500);
      }
    };

    v.addEventListener("playing", fixAfterPlay);
    return () => v.removeEventListener("playing", fixAfterPlay);
  }, [videoUrl, knownSec]);

  const handleError = () => {
    const v = videoRef.current;
    if (v?.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || v?.error?.code === MediaError.MEDIA_ERR_NETWORK) {
      if (onExpired) {
        onExpired();
        return;
      }
    }
    setError("Video failed to load");
  };

  return (
    <div className="relative w-full aspect-video">
      {/* Skeleton shown until video is ready */}
      {!ready && !error && (
        <Skeleton className="absolute inset-0 rounded-lg" />
      )}

      {/* Video player — hidden until ready, then fades in */}
      <div
        className={`plyr-container w-full h-full transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"}`}
      >
        {!error ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full"
            preload="auto"
            onCanPlay={() => setReady(true)}
            onError={handleError}
          />
        ) : null}
      </div>

      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-destructive text-sm">
          {error}
        </div>
      )}
    </div>
  );
}

// Fix Issue 4: memoise so the player doesn't re-render (and thus re-init Plyr)
// when the parent re-renders for unrelated state changes (search input, tab
// switch, share modal open/close). Plyr re-init was the "frozen frame /
// video doesn't play" symptom.
// Stricter compatibility probe.
//
// `canPlayType('video/webm')` returns "maybe" in Safari 14.1+ even though
// Safari's WebM decoder rejects VP9-encoded WebM (which is what we record).
// We hit a Safari React-DOM commit crash ("NotFoundError") any time a
// <video> with our SAS-signed .webm URL mounts.
//
// Detection strategy: probe for VP9 specifically, AND treat Safari as
// unsupported by default. Bypass via window flag for local debugging.
function detectWebmSupport(): boolean {
  try {
    if (typeof document === "undefined") return true;
    const v = document.createElement("video");
    // Empty string = definitely no; "maybe"/"probably" = some level of support.
    const vp9 = v.canPlayType('video/webm; codecs="vp9"');
    const generic = v.canPlayType("video/webm");
    const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "") || "";
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    if (isSafari) return false; // Safari unreliably plays our WebM/VP9
    return vp9 !== "" || generic !== "";
  } catch {
    return true;
  }
}
const SUPPORTS_WEBM = detectWebmSupport();

function StreamingVideoPlayerWithCompatCheck(props: StreamingVideoPlayerProps) {
  // Fix: don't mount <video> in browsers that can't decode the format.
  // Otherwise React's commit-phase ref attachment on the error-state
  // <video> throws "NotFoundError" and blanks the page.
  const isWebm =
    !!props.videoUrl &&
    /\.webm(\?|$)/i.test(props.videoUrl);
  if (isWebm && !SUPPORTS_WEBM) {
    return (
      <div className="relative w-full aspect-video bg-black/90 rounded-lg flex items-center justify-center text-center p-6">
        <div className="text-sm text-white/80 max-w-md leading-relaxed">
          <p className="font-semibold mb-2">Video playback not supported in this browser</p>
          <p className="text-white/60">
            VeloCap recordings use the WebM format. Safari doesn't play WebM yet — open this link in Chrome, Edge, or Firefox to watch the recording.
          </p>
          {props.videoUrl && (
            <a
              href={props.videoUrl}
              download
              className="inline-block mt-4 text-blue-400 hover:underline text-xs"
            >
              Download the video file
            </a>
          )}
        </div>
      </div>
    );
  }
  return <StreamingVideoPlayerImpl {...props} />;
}

export const StreamingVideoPlayer = memo(
  StreamingVideoPlayerWithCompatCheck,
  (prev, next) =>
    prev.videoUrl === next.videoUrl &&
    prev.knownDurationMs === next.knownDurationMs &&
    prev.trimStartMs === next.trimStartMs &&
    prev.trimEndMs === next.trimEndMs &&
    prev.onExpired === next.onExpired,
);
