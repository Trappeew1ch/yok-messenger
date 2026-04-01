'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

const C = {
  bg: '#0D0D0D', surface: '#1A1A1F', hover: '#222228',
  text: '#E8E8E8', sub: '#8E8E96', muted: '#55555E',
  blue: '#FFFFFF', danger: '#EB5757', online: '#34C759',
};

interface VoiceRecorderProps {
  onSend: (blob: Blob, duration: number, waveform: number[]) => void;
  onCancel: () => void;
}

export default function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [state, setState] = useState<'recording' | 'paused'>('recording');
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTime = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrame = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 }
        });
        streamRef.current = stream;

        const ctx = new AudioContext();
        audioContext.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const anal = ctx.createAnalyser();
        anal.fftSize = 512;
        anal.smoothingTimeConstant = 0.3;
        source.connect(anal);
        analyser.current = anal;

        const recorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm',
        });
        mediaRecorder.current = recorder;
        chunks.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.current.push(e.data);
        };

        recorder.start(100);
        startTime.current = Date.now();

        timerRef.current = setInterval(() => {
          if (mounted) setDuration(Math.floor((Date.now() - startTime.current) / 1000));
        }, 100);

        drawWaveform();
      } catch (err) {
        console.error('[YOK] Microphone access error:', err);
        onCancel();
      }
    };

    start();

    return () => {
      mounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrame.current) cancelAnimationFrame(animFrame.current);
      if (mediaRecorder.current?.state !== 'inactive') {
        try { mediaRecorder.current?.stop(); } catch {}
      }
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioContext.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const anal = analyser.current;
    if (!canvas || !anal) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = anal.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrame.current = requestAnimationFrame(draw);
      anal.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = 3;
      const gap = 2;
      const totalBars = Math.floor(canvas.width / (barWidth + gap));
      const step = Math.max(1, Math.floor(bufferLength / totalBars));

      for (let i = 0; i < totalBars; i++) {
        // Calculate RMS amplitude for this segment
        let sum = 0;
        const segStart = i * step;
        const segEnd = Math.min(segStart + step, bufferLength);
        for (let j = segStart; j < segEnd; j++) {
          const v = (dataArray[j] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / (segEnd - segStart));

        // Apply sensitivity curve: emphasize differences, silence = tiny bar
        const normalized = Math.pow(rms, 0.6) * 2.5;
        const minBarH = 3;
        const maxBarH = canvas.height * 0.85;
        const barHeight = Math.max(minBarH, Math.min(maxBarH, normalized * maxBarH));

        const x = i * (barWidth + gap);
        const y = (canvas.height - barHeight) / 2;

        ctx.fillStyle = C.blue;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1.5);
        ctx.fill();
      }

      // Collect peak data
      let totalRms = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] - 128) / 128;
        totalRms += v * v;
      }
      const peak = Math.sqrt(totalRms / bufferLength);
      setWaveformData(prev => {
        const next = [...prev, peak];
        return next.length > 200 ? next.slice(-200) : next;
      });
    };

    draw();
  }, []);

  const handlePause = () => {
    if (state === 'recording') {
      mediaRecorder.current?.pause();
      if (timerRef.current) clearInterval(timerRef.current);
      setState('paused');
    } else {
      mediaRecorder.current?.resume();
      startTime.current = Date.now() - duration * 1000;
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime.current) / 1000));
      }, 100);
      setState('recording');
    }
  };

  const handleSend = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.onstop = () => {
      const blob = new Blob(chunks.current, { type: 'audio/webm;codecs=opus' });
      onSend(blob, duration, waveformData.slice(-100));
    };
    mediaRecorder.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleDelete = () => {
    if (mediaRecorder.current?.state !== 'inactive') {
      try { mediaRecorder.current?.stop(); } catch {}
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    onCancel();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const iconBtn: React.CSSProperties = {
    width: 36, height: 36, borderRadius: '50%', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flex: 1, width: '100%',
      animation: 'fadeIn 0.2s ease',
    }}>
      {/* Delete button */}
      <button onClick={handleDelete}
        style={{ ...iconBtn, background: 'rgba(235,87,87,0.12)', color: C.danger }}
        title="Удалить">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </button>

      {/* Timer */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        color: state === 'recording' ? C.danger : C.sub,
        fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        minWidth: 42, flexShrink: 0,
      }}>
        {state === 'recording' && (
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.danger, animation: 'pulse 1s infinite' }} />
        )}
        {formatTime(duration)}
      </div>

      {/* Waveform canvas — full available width */}
      <canvas ref={canvasRef} width={600} height={32}
        style={{ flex: 1, minWidth: 0, height: 32 }} />

      {/* Pause/Resume */}
      <button onClick={handlePause}
        style={{ ...iconBtn, background: C.hover, color: C.text }}
        title={state === 'recording' ? 'Пауза' : 'Продолжить'}>
        {state === 'recording' ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        )}
      </button>

      {/* Send */}
      <button onClick={handleSend}
        style={{ ...iconBtn, background: C.blue, color: '#fff' }}
        title="Отправить">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
      </button>
    </div>
  );
}
