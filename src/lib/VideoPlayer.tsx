'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface VideoPlayerProps {
  src: string;
}

export default function VideoPlayer({ src }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [ready, setReady] = useState(false);
  const [errored, setErrored] = useState(false);
  const [hovered, setHovered] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => { setDuration(v.duration); setReady(true); };
    const onTime = () => {
      setCurrentTime(v.currentTime);
      if (v.duration) setProgress((v.currentTime / v.duration) * 100);
    };
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    const onErr = () => setErrored(true);

    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnd);
    v.addEventListener('error', onErr);
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnd);
      v.removeEventListener('error', onErr);
    };
  }, []);

  const togglePlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v || errored) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      try {
        await v.play();
        setPlaying(true);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.error('[YOK] Video play error:', e);
        setErrored(true);
      }
    }
  }, [playing, errored]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    const bar = progressRef.current;
    if (!v || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pos * duration;
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (errored) {
    return (
      <div style={{ width: '100%', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', borderRadius: 16, color: '#666', fontSize: 13 }}>
        Видео недоступно
      </div>
    );
  }

  return (
    <div
      style={{ position: 'relative', width: '100%', cursor: 'pointer', borderRadius: 16, overflow: 'hidden', background: '#000' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        playsInline
        style={{ display: 'block', width: '100%', minHeight: 120 }}
        onClick={togglePlay}
      />

      {/* Play / Pause overlay */}
      {(!playing || hovered) && ready && (
        <div
          onClick={togglePlay}
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: playing ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.3)',
            transition: 'opacity 0.2s', opacity: (!playing || hovered) ? 1 : 0,
          }}
        >
          {!playing && (
            <div style={{
              width: 52, height: 52, borderRadius: '50%', background: 'rgba(255,255,255,0.9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#111">
                <polygon points="6 3 20 12 6 21" />
              </svg>
            </div>
          )}
        </div>
      )}

      {/* Bottom controls bar */}
      {ready && (playing || hovered) && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
          padding: '16px 10px 8px',
        }}>
          {/* Progress bar */}
          <div
            ref={progressRef}
            onClick={handleSeek}
            style={{ height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, cursor: 'pointer', marginBottom: 6 }}
          >
            <div style={{ height: '100%', width: `${progress}%`, background: '#fff', borderRadius: 2, transition: 'width 0.1s' }} />
          </div>
          {/* Time */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
