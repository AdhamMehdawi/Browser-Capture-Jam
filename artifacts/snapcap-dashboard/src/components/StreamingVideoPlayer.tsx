import { useState, useEffect, useRef } from "react";
import "plyr/dist/plyr.css";

interface StreamingVideoPlayerProps {
  videoUrl: string;
  knownDurationMs: number | null | undefined;
  trimStartMs?: number | null;
  trimEndMs?: number | null;
  onExpired?: () => void;
}

export function StreamingVideoPlayer({
  videoUrl,
  knownDurationMs,
  trimStartMs,
  trimEndMs,
  onExpired,
}: StreamingVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const plyrRef = useRef<{ destroy(): void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const knownSec = knownDurationMs ? knownDurationMs / 1000 : 0;
  const trimStartSec = (trimStartMs ?? 0) / 1000;
  const trimEndSec = trimEndMs ? trimEndMs / 1000 : 0;
  const hasTrim = trimStartMs != null && trimEndMs != null;

  // Initialize Plyr when videoUrl changes
  useEffect(() => {
    if (!videoRef.current) return;
    let player: { destroy(): void } | null = null;

    import("plyr").then((mod) => {
      const PlyrClass = (mod.default ?? mod) as unknown as new (
        el: HTMLVideoElement,
        opts: Record<string, unknown>,
      ) => { destroy(): void };
      if (!videoRef.current) return;
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
      if (player) {
        player.destroy();
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
      // After initial load, seek to trim start
      if (v.currentTime < trimStartSec) {
        v.currentTime = trimStartSec;
      }
    };

    v.addEventListener("timeupdate", handleTimeUpdate);
    v.addEventListener("loadedmetadata", handleSeeked);

    // If already loaded, seek now
    if (v.readyState >= 1 && v.currentTime < trimStartSec) {
      v.currentTime = trimStartSec;
    }

    return () => {
      v.removeEventListener("timeupdate", handleTimeUpdate);
      v.removeEventListener("loadedmetadata", handleSeeked);
    };
  }, [hasTrim, trimStartSec, trimEndSec]);

  // Fix duration for WebM files that report Infinity or wrong duration
  const fixDuration = (v: HTMLVideoElement) => {
    const reported = v.duration;
    if (
      !Number.isFinite(reported) ||
      Number.isNaN(reported) ||
      (knownSec > 0 && reported < knownSec * 0.8)
    ) {
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        v.currentTime = 0;
      };
      v.addEventListener("seeked", onSeeked);
      v.currentTime = 1e101;
    }
  };

  const handleError = () => {
    const v = videoRef.current;
    if (v?.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || v?.error?.code === MediaError.MEDIA_ERR_NETWORK) {
      // SAS URL may have expired (403 from Azure)
      if (onExpired) {
        onExpired();
        return;
      }
    }
    setError("Video failed to load");
  };

  return (
    <div className="bg-black relative w-full h-full plyr-container">
      {!error ? (
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full"
          preload="metadata"
          onLoadedMetadata={(e) => fixDuration(e.currentTarget)}
          onError={handleError}
        />
      ) : (
        <div className="text-destructive text-sm p-6 text-center">
          {error}
        </div>
      )}
    </div>
  );
}
