'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

const C = {
  text: '#E8E8E8', sub: '#8E8E96', muted: '#55555E', accent: '#FFFFFF',
};

interface VoicePlayerProps {
  src: string;
  duration?: number;
  waveformPeaks?: number[];
  isMine?: boolean;
}

export default function VoicePlayer({ src, duration: initialDuration, waveformPeaks, isMine }: VoicePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [speed, setSpeed] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);

  const peaks = waveformPeaks && waveformPeaks.length > 0
    ? waveformPeaks
    : Array.from({ length: 40 }, () => 0.3 + Math.random() * 0.5);

  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoaded = () => setDuration(audio.duration);
    const handleEnded = () => { setPlaying(false); setCurrentTime(0); };
    const handleTime = () => setCurrentTime(audio.currentTime);
    const handleError = () => { setErrored(true); setPlaying(false); };

    audio.addEventListener('loadedmetadata', handleLoaded);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTime);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoaded);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTime);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const barWidth = 2.5;
    const gap = 1.5;
    const totalBars = Math.floor(w / (barWidth + gap));
    const progress = duration > 0 ? currentTime / duration : 0;
    const progressBar = Math.floor(progress * totalBars);

    for (let i = 0; i < totalBars; i++) {
      const peakIdx = Math.floor((i / totalBars) * peaks.length);
      const peak = peaks[peakIdx] || 0.3;
      const barHeight = Math.max(3, peak * h * 0.8);
      const x = i * (barWidth + gap);
      const y = (h - barHeight) / 2;

      ctx.fillStyle = i <= progressBar ? C.accent : (isMine ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.15)');
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1);
      ctx.fill();
    }
  }, [currentTime, duration, peaks, isMine]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  useEffect(() => {
    if (playing) {
      const animate = () => {
        drawWaveform();
        animRef.current = requestAnimationFrame(animate);
      };
      animate();
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playing, drawWaveform]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || errored) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.playbackRate = speed;
      try {
        await audio.play();
        setPlaying(true);
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          console.debug('[YOK] Audio play aborted (re-render)');
          return;
        }
        console.error('[YOK] Audio play error:', e);
        setErrored(true);
      }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  };

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const btnStyle: React.CSSProperties = {
    width: 32, height: 32, borderRadius: '50%', border: 'none',
    background: '#FFFFFF', color: '#0D0D0D', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'transform 0.1s',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 200 }}>
      <audio ref={audioRef} preload="metadata">
        <source src={src} type="audio/webm;codecs=opus" />
        <source src={src} type="audio/webm" />
        <source src={src} type="audio/ogg;codecs=opus" />
      </audio>

      {/* Play/Pause */}
      <button onClick={togglePlay} style={{ ...btnStyle, opacity: errored ? 0.4 : 1 }} title={errored ? 'Не удалось загрузить' : undefined}>
        {errored ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        ) : playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        )}
      </button>

      {/* Waveform */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          width={180}
          height={28}
          style={{ cursor: 'pointer', width: '100%', height: 28 }}
          onClick={handleSeek}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted }}>
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Speed */}
      <button
        onClick={cycleSpeed}
        style={{
          background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8,
          padding: '4px 8px', color: speed !== 1 ? '#FFFFFF' : C.sub,
          fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        }}
      >
        {speed}×
      </button>
    </div>
  );
}
