'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

const C = {
  bg: '#0D0D0D', surface: '#1A1A1F', text: '#E8E8E8',
  sub: '#8E8E96', muted: '#55555E', blue: '#4DA6FF',
};

interface MediaItem {
  url: string;
  type: 'image' | 'video';
  messageId: string;
}

interface MediaViewerProps {
  items: MediaItem[];
  initialIndex: number;
  onClose: () => void;
}

export default function MediaViewer({ items, initialIndex, onClose }: MediaViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const current = items[index];

  // Reset zoom/pan on index change
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [index]);

  // Keyboard nav
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) setIndex(i => i - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) setIndex(i => i + 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, items.length, onClose]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(5, Math.max(0.5, z - e.deltaY * 0.001)));
  }, []);

  // Pan with mouse drag when zoomed
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  };

  const handleMouseUp = () => setDragging(false);

  const download = () => {
    const a = document.createElement('a');
    a.href = current.url;
    a.download = `yok_media_${Date.now()}`;
    a.target = '_blank';
    a.click();
  };

  const btnStyle: React.CSSProperties = {
    width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.1)',
    backdropFilter: 'blur(10px)', border: 'none', color: '#fff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
    transition: 'background 0.2s',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
        userSelect: 'none',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px' }}>
        <span style={{ color: C.sub, fontSize: 14 }}>
          {index + 1} из {items.length}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnStyle} onClick={download} title="Скачать">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button style={btnStyle} onClick={onClose} title="Закрыть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Media content */}
      <div
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: zoom > 1 ? 'grab' : 'default' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {current.type === 'image' ? (
          <img
            src={current.url}
            alt=""
            style={{
              maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain',
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transition: dragging ? 'none' : 'transform 0.15s ease',
              borderRadius: 4,
            }}
            draggable={false}
          />
        ) : (
          <video
            src={current.url}
            controls
            autoPlay
            style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 4 }}
          />
        )}
      </div>

      {/* Navigation arrows */}
      {index > 0 && (
        <button
          onClick={() => setIndex(i => i - 1)}
          style={{ ...btnStyle, position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      )}
      {index < items.length - 1 && (
        <button
          onClick={() => setIndex(i => i + 1)}
          style={{ ...btnStyle, position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      )}

      {/* Thumbnail strip at bottom */}
      {items.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '8px 16px 16px' }}>
          {items.map((item, i) => (
            <div
              key={i}
              onClick={() => setIndex(i)}
              style={{
                width: 48, height: 48, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                border: i === index ? `2px solid ${C.blue}` : '2px solid transparent',
                opacity: i === index ? 1 : 0.5, transition: 'all 0.15s',
              }}
            >
              {item.type === 'image' ? (
                <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>▶</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
