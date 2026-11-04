import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Captions,
  FileText,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ResolvedVideoPlayback } from '../../learning/types.js';

interface VttCueItem {
  start: number;
  end: number;
  text: string;
}

function parseTimestampToSeconds(raw: string): number {
  const parts = raw.trim().split(':');
  if (parts.length === 3) {
    const h = Number.parseFloat(parts[0]) || 0;
    const m = Number.parseFloat(parts[1]) || 0;
    const s = Number.parseFloat(parts[2].replace(',', '.')) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = Number.parseFloat(parts[0]) || 0;
    const s = Number.parseFloat(parts[1].replace(',', '.')) || 0;
    return m * 60 + s;
  }
  return 0;
}

function parseWebVtt(vttText: string): VttCueItem[] {
  const blocks = vttText.replace(/\r\n/g, '\n').split(/\n\n+/);
  const cues: VttCueItem[] = [];
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0 || lines[0].startsWith('WEBVTT')) continue;
    const arrowLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowLineIdx === -1) continue;
    const [startRaw, endRaw] = lines[arrowLineIdx].split('-->');
    const endToken = (endRaw || '').trim().split(/\s+/)[0] || '';
    const start = parseTimestampToSeconds(startRaw || '00:00.000');
    const end = parseTimestampToSeconds(endToken);
    const text = lines.slice(arrowLineIdx + 1).join(' ');
    if (text && end > start) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

export function formatDurationLabel(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface TutorialVideoPlayerProps {
  tutorialId: string;
  tutorialTitle: string;
  catalogDurationSeconds: number;
  video: ResolvedVideoPlayback;
  initialPositionSeconds: number;
  initialMaxWatchedSeconds: number;
  isCompleted: boolean;
  firstActionPath?: string;
  firstActionLabel?: string;
  onSaveProgress: (payload: { lastPositionSeconds: number; watchedSeconds: number }) => Promise<void>;
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export function TutorialVideoPlayer({
  tutorialId,
  tutorialTitle,
  catalogDurationSeconds,
  video,
  initialPositionSeconds,
  initialMaxWatchedSeconds,
  isCompleted,
  firstActionPath,
  firstActionLabel,
  onSaveProgress,
}: TutorialVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(video.renderMode === 'html5_video');
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(catalogDurationSeconds);
  const [currentTime, setCurrentTime] = useState<number>(initialPositionSeconds || 0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [captionsEnabled, setCaptionsEnabled] = useState<boolean>(true);
  const [cues, setCues] = useState<VttCueItem[]>([]);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showResumeBanner, setShowResumeBanner] = useState<boolean>(
    initialPositionSeconds >= 2 && !isCompleted
  );
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  // Track cumulative genuinely watched playback time separately from scrub bar position
  const watchedAccumulatorRef = useRef<number>(initialMaxWatchedSeconds || 0);
  const lastPlaybackTickRef = useRef<number | null>(null);
  const lastPersistedAtMsRef = useRef<number>(0);
  const latestPositionRef = useRef<number>(initialPositionSeconds || 0);
  const hasAppliedInitialSeekRef = useRef<boolean>(false);

  // Reset state when switching tutorials
  useEffect(() => {
    setIsPlaying(false);
    setPlaybackError(null);
    setIsBuffering(video.renderMode === 'html5_video');
    setDuration(catalogDurationSeconds);
    setCurrentTime(initialPositionSeconds || 0);
    setShowResumeBanner(initialPositionSeconds >= 2 && !isCompleted);
    watchedAccumulatorRef.current = initialMaxWatchedSeconds || 0;
    lastPlaybackTickRef.current = null;
    lastPersistedAtMsRef.current = 0;
    latestPositionRef.current = initialPositionSeconds || 0;
    hasAppliedInitialSeekRef.current = false;
  }, [tutorialId, video.renderMode, video.playbackUrl]);

  // Load WebVTT cues for reliable cross-browser caption rendering alongside native <track>
  useEffect(() => {
    let cancelled = false;
    if (video.renderMode !== 'html5_video' || !video.captionsUrl) {
      setCues([]);
      return;
    }
    fetch(video.captionsUrl, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((txt) => {
        if (!cancelled && txt) {
          setCues(parseWebVtt(txt));
        }
      })
      .catch(() => {
        if (!cancelled) setCues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [video.renderMode, video.captionsUrl]);

  // Sync native textTracks mode to prevent duplicate browser-drawn captions over our accessible overlay
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !el.textTracks) return;
    for (let i = 0; i < el.textTracks.length; i += 1) {
      el.textTracks[i].mode = 'hidden';
    }
  }, [cues, captionsEnabled, reloadNonce]);

  const flushProgress = useCallback(
    (overridePos?: number, overrideWatched?: number) => {
      if (video.renderMode !== 'html5_video') return;
      const cappedDuration = Math.max(1, catalogDurationSeconds);
      const pos = Math.max(
        0,
        Math.min(cappedDuration, Math.floor(overridePos ?? latestPositionRef.current))
      );
      const watched = Math.max(
        0,
        Math.min(cappedDuration, Math.floor(overrideWatched ?? watchedAccumulatorRef.current))
      );
      if (pos === 0 && watched === 0) return;
      lastPersistedAtMsRef.current = Date.now();
      void onSaveProgress({
        lastPositionSeconds: pos,
        watchedSeconds: watched,
      });
    },
    [catalogDurationSeconds, onSaveProgress, video.renderMode]
  );

  // Flush unsaved progress on unmount or tab hide
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushProgress();
    };
  }, [flushProgress]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el || playbackError) return;
    if (el.paused || el.ended) {
      lastPlaybackTickRef.current = el.currentTime;
      el.play().catch(() => {
        setPlaybackError('Browser blocked playback or video stream could not be decoded.');
      });
    } else {
      el.pause();
    }
  };

  const handleSeek = (nextValue: number) => {
    const el = videoRef.current;
    const bounded = Math.max(0, Math.min(duration || catalogDurationSeconds, nextValue));
    setCurrentTime(bounded);
    latestPositionRef.current = bounded;
    if (el) {
      lastPlaybackTickRef.current = bounded;
      el.currentTime = bounded;
    }
    flushProgress(bounded, watchedAccumulatorRef.current);
  };

  const handleRestartFromBeginning = () => {
    setShowResumeBanner(false);
    handleSeek(0);
    const el = videoRef.current;
    if (el && el.paused) {
      el.play().catch(() => {});
    }
  };

  const toggleMute = () => {
    const el = videoRef.current;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (el) {
      el.muted = nextMuted;
    }
  };

  const handleVolumeChange = (nextVol: number) => {
    const el = videoRef.current;
    const clamped = Math.max(0, Math.min(1, nextVol));
    setVolume(clamped);
    setIsMuted(clamped === 0);
    if (el) {
      el.volume = clamped;
      el.muted = clamped === 0;
    }
  };

  const handleRateChange = (nextRate: number) => {
    setPlaybackRate(nextRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
    }
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen may be restricted in sandboxed preview iframes
    }
  };

  const handleRetryVideo = () => {
    setPlaybackError(null);
    setIsBuffering(true);
    hasAppliedInitialSeekRef.current = false;
    setReloadNonce((n) => n + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (video.renderMode !== 'html5_video') return;
    const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (targetTag === 'select') return;

    if (e.key === ' ' || e.key.toLowerCase() === 'k') {
      if (targetTag !== 'button') {
        e.preventDefault();
        togglePlay();
      }
    } else if (e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleMute();
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      void toggleFullscreen();
    } else if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      setCaptionsEnabled((prev) => !prev);
    } else if (e.key === 'ArrowRight' && targetTag !== 'input') {
      e.preventDefault();
      handleSeek(currentTime + 5);
    } else if (e.key === 'ArrowLeft' && targetTag !== 'input') {
      e.preventDefault();
      handleSeek(currentTime - 5);
    }
  };

  const activeCue =
    captionsEnabled && cues.length > 0
      ? cues.find((c) => currentTime >= c.start && currentTime <= c.end) || null
      : null;

  if (video.renderMode === 'unavailable' || !video.playbackUrl) {
    return (
      <div
        data-testid="video-unavailable-panel"
        className="rounded-xl border border-subtle bg-surface overflow-hidden"
      >
        <div className="aspect-video max-h-[420px] w-full flex flex-col items-center justify-center p-6 sm:p-10 text-center bg-elevated/60">
          <div className="w-11 h-11 rounded-xl border border-subtle bg-surface flex items-center justify-center text-muted mb-4">
            <FileText size={20} />
          </div>
          <h3 className="text-base sm:text-lg font-semibold text-strong">
            Video recording not yet uploaded
          </h3>
          <p className="text-xs sm:text-sm text-muted max-w-lg mt-1.5 leading-relaxed">
            This curriculum module currently provides a verified written FortiX operational walkthrough below. Operators can attach a self-hosted{' '}
            <code className="font-mono text-strong">.webm</code> or{' '}
            <code className="font-mono text-strong">.mp4</code> capture anytime via Manage Tutorials.
          </p>
          {firstActionPath && (
            <div className="mt-5">
              <Link
                to={firstActionPath}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-inverted text-xs font-semibold hover:bg-primary-hover transition-colors"
              >
                <span>{firstActionLabel || 'Open Target FortiX Screen'}</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (video.renderMode === 'trusted_embed') {
    return (
      <div className="rounded-xl border border-subtle bg-surface overflow-hidden">
        <div className="aspect-video w-full bg-black">
          <iframe
            title={tutorialTitle}
            src={video.playbackUrl}
            className="w-full h-full border-0"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="fullscreen; encrypted-media; picture-in-picture"
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={`Video player for ${tutorialTitle}`}
      data-testid="tutorial-video-player"
      className="rounded-xl border border-subtle bg-[#0b0d14] text-zinc-100 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="relative aspect-video w-full bg-[#07090e] flex items-center justify-center select-none">
        <video
          key={`${video.playbackUrl}-${reloadNonce}`}
          ref={videoRef}
          src={video.playbackUrl}
          poster={video.thumbnailUrl || undefined}
          preload="metadata"
          playsInline
          onClick={togglePlay}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            const mediaDur =
              Number.isFinite(el.duration) && el.duration > 0
                ? Math.round(el.duration)
                : catalogDurationSeconds;
            setDuration(mediaDur);
            setIsBuffering(false);
            el.playbackRate = playbackRate;
            el.volume = volume;
            el.muted = isMuted;

            if (!hasAppliedInitialSeekRef.current && initialPositionSeconds > 0 && initialPositionSeconds < mediaDur) {
              hasAppliedInitialSeekRef.current = true;
              el.currentTime = initialPositionSeconds;
              setCurrentTime(initialPositionSeconds);
              latestPositionRef.current = initialPositionSeconds;
            }
          }}
          onCanPlay={() => setIsBuffering(false)}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => {
            setIsBuffering(false);
            setIsPlaying(true);
          }}
          onPlay={() => {
            setIsPlaying(true);
            if (lastPersistedAtMsRef.current === 0) {
              lastPersistedAtMsRef.current = Date.now();
            }
            if (videoRef.current) {
              lastPlaybackTickRef.current = videoRef.current.currentTime;
            }
          }}
          onPause={() => {
            setIsPlaying(false);
            lastPlaybackTickRef.current = null;
            if (videoRef.current && !videoRef.current.ended) {
              flushProgress(videoRef.current.currentTime, watchedAccumulatorRef.current);
            }
          }}
          onTimeUpdate={(e) => {
            const nowSec = e.currentTarget.currentTime;
            setCurrentTime(nowSec);
            latestPositionRef.current = nowSec;

            if (lastPlaybackTickRef.current !== null && !e.currentTarget.paused) {
              const delta = nowSec - lastPlaybackTickRef.current;
              if (delta > 0 && delta <= 2.5) {
                watchedAccumulatorRef.current = Math.min(
                  catalogDurationSeconds,
                  watchedAccumulatorRef.current + delta
                );
              }
            }
            lastPlaybackTickRef.current = nowSec;

            if (Date.now() - lastPersistedAtMsRef.current >= 6000) {
              flushProgress(nowSec, watchedAccumulatorRef.current);
            }
          }}
          onEnded={(e) => {
            setIsPlaying(false);
            lastPlaybackTickRef.current = null;
            const endPos = Math.min(
              catalogDurationSeconds,
              Math.max(Math.round(e.currentTarget.currentTime), watchedAccumulatorRef.current)
            );
            // If user watched most of the video naturally, ensure completion threshold is recorded cleanly
            const finalWatched =
              watchedAccumulatorRef.current >= catalogDurationSeconds * 0.75
                ? catalogDurationSeconds
                : watchedAccumulatorRef.current;
            watchedAccumulatorRef.current = finalWatched;
            flushProgress(endPos, finalWatched);
          }}
          onError={() => {
            setIsBuffering(false);
            setIsPlaying(false);
            setPlaybackError(
              'Tutorial video media could not be loaded. Check your connection or follow the step-by-step operational guide below.'
            );
          }}
          className="w-full h-full object-contain cursor-pointer"
          data-testid="html5-video-element"
        >
          {video.captionsUrl && (
            <track
              kind="captions"
              src={video.captionsUrl}
              srcLang="en"
              label="English"
              default={captionsEnabled}
            />
          )}
        </video>

        {/* Resume indicator banner */}
        {showResumeBanner && !isPlaying && !playbackError && (
          <div
            data-testid="video-resume-banner"
            className="absolute top-3 left-3 right-3 sm:right-auto flex flex-wrap items-center gap-3 px-3.5 py-2 rounded-lg bg-[#111522]/95 border border-white/15 text-xs text-zinc-200 shadow-lg"
          >
            <span className="font-mono tabular-nums">
              Saved at {formatDurationLabel(initialPositionSeconds)}
            </span>
            <button
              type="button"
              onClick={handleRestartFromBeginning}
              className="inline-flex items-center gap-1 text-primary hover:underline font-semibold"
            >
              <RotateCcw size={12} />
              <span>Start from 0:00</span>
            </button>
          </div>
        )}

        {/* Center play overlay when paused */}
        {!isPlaying && !isBuffering && !playbackError && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label={`Play ${tutorialTitle}`}
            data-testid="video-overlay-play-btn"
            className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-primary hover:bg-primary-hover text-zinc-950 flex items-center justify-center shadow-xl transition-transform hover:scale-105 cursor-pointer"
          >
            <Play size={24} className="ml-0.5 fill-current" />
          </button>
        )}

        {/* Loading indicator */}
        {isBuffering && !playbackError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 pointer-events-none">
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#121624]/90 border border-white/15 text-xs text-zinc-200">
              <RefreshCw size={14} className="animate-spin text-primary" />
              <span>Loading video stream…</span>
            </div>
          </div>
        )}

        {/* Error recovery overlay */}
        {playbackError && (
          <div
            role="alert"
            data-testid="video-playback-error"
            className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#0b0d14]/95"
          >
            <AlertCircle size={24} className="text-red-400 mb-2.5" />
            <p className="text-xs sm:text-sm font-medium text-zinc-100 max-w-md">{playbackError}</p>
            <button
              type="button"
              onClick={handleRetryVideo}
              className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white transition-colors"
            >
              <RefreshCw size={13} />
              <span>Retry Playback</span>
            </button>
          </div>
        )}

        {/* Accessible WebVTT caption cue overlay */}
        {activeCue && !playbackError && (
          <div
            aria-live="polite"
            data-testid="video-caption-overlay"
            className="absolute bottom-3 left-4 right-4 flex justify-center pointer-events-none"
          >
            <span className="px-3 py-1.5 rounded bg-black/85 border border-white/10 text-xs sm:text-sm font-medium text-zinc-100 text-center max-w-2xl leading-snug">
              {activeCue.text}
            </span>
          </div>
        )}
      </div>

      {/* Accessible Control Bar */}
      <div className="px-3 sm:px-4 py-2.5 bg-[#10131e] border-t border-white/10 space-y-2">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.25}
            value={Math.min(currentTime, Math.max(1, duration))}
            onChange={(e) => handleSeek(Number.parseFloat(e.target.value))}
            aria-label="Seek tutorial timeline"
            data-testid="video-seek-slider"
            className="w-full h-1.5 accent-[#F27D26] cursor-pointer"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={togglePlay}
              disabled={Boolean(playbackError)}
              aria-label={isPlaying ? 'Pause tutorial' : 'Play tutorial'}
              data-testid="video-play-pause-btn"
              className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-100 disabled:opacity-40 transition-colors cursor-pointer"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-200 transition-colors cursor-pointer"
              >
                {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number.parseFloat(e.target.value))}
                aria-label="Volume"
                className="hidden sm:block w-16 h-1 accent-[#F27D26] cursor-pointer"
              />
            </div>

            <span
              data-testid="video-timestamp"
              className="font-mono tabular-nums text-[11px] sm:text-xs text-zinc-300"
            >
              {formatDurationLabel(currentTime)} / {formatDurationLabel(duration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {video.captionsUrl && (
              <button
                type="button"
                onClick={() => setCaptionsEnabled((v) => !v)}
                aria-pressed={captionsEnabled}
                aria-label="Toggle captions"
                data-testid="video-captions-btn"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  captionsEnabled
                    ? 'bg-primary/20 text-primary border border-primary/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                }`}
              >
                <Captions size={14} />
                <span>CC</span>
              </button>
            )}

            <label className="sr-only" htmlFor={`speed-${tutorialId}`}>
              Playback speed
            </label>
            <select
              id={`speed-${tutorialId}`}
              aria-label="Playback speed"
              data-testid="video-speed-select"
              value={playbackRate}
              onChange={(e) => handleRateChange(Number.parseFloat(e.target.value))}
              className="bg-[#181c2b] border border-white/15 rounded px-2 py-1 text-[11px] font-mono tabular-nums text-zinc-100 focus:outline-none focus:border-primary cursor-pointer"
            >
              {PLAYBACK_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}x
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-200 transition-colors cursor-pointer"
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
