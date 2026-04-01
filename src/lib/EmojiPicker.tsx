'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { EMOJI_CATEGORIES, getEmojiUrl } from './emojiData';

interface EmojiPickerProps {
  onSelect: (url: string, name: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [activeCat, setActiveCat] = useState(0);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!search.trim()) return EMOJI_CATEGORIES[activeCat]?.emojis || [];
    const q = search.toLowerCase();
    const all: { cat: string; name: string }[] = [];
    EMOJI_CATEGORIES.forEach(c => c.emojis.forEach(e => {
      if (e.toLowerCase().includes(q)) all.push({ cat: c.name, name: e });
    }));
    return all;
  }, [activeCat, search]);

  return (
    <div ref={pickerRef} style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      width: 370, height: 400,
      background: 'rgba(10,10,12,0.55)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
      borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      display: 'flex', flexDirection: 'column',
      zIndex: 500, overflow: 'hidden',
      animation: 'fadeIn 0.15s ease',
    }}>
      {/* Search */}
      <div style={{ padding: '10px 12px 6px' }}>
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск эмодзи..."
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 10,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.06)',
            color: '#E8E8E8', fontSize: 13, boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Category tabs */}
      {!search && (
        <div style={{ display: 'flex', gap: 2, padding: '0 8px 6px', overflowX: 'auto', flexShrink: 0 }}>
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button key={cat.name} onClick={() => { setActiveCat(i); containerRef.current?.scrollTo(0, 0); }}
              style={{
                padding: '6px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: i === activeCat ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: i === activeCat ? '#FFFFFF' : '#8E8E96',
                fontSize: 16, flexShrink: 0, transition: 'all 0.15s',
              }}
              title={cat.name}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Category name */}
      {!search && (
        <div style={{ padding: '2px 14px 4px', fontSize: 11, color: '#55555E', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
          {EMOJI_CATEGORIES[activeCat]?.name}
        </div>
      )}

      {/* Emoji grid */}
      <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {(search ? filtered as { cat: string; name: string }[] : (filtered as string[]).map(name => ({ cat: EMOJI_CATEGORIES[activeCat].name, name }))).map(item => {
            const emoji = typeof item === 'string' ? { cat: EMOJI_CATEGORIES[activeCat].name, name: item } : item;
            const url = getEmojiUrl(emoji.cat, emoji.name);
            return (
              <button
                key={`${emoji.cat}-${emoji.name}`}
                onClick={() => onSelect(url, emoji.name)}
                title={emoji.name}
                style={{
                  width: '100%', aspectRatio: '1', borderRadius: 8, border: 'none',
                  background: 'transparent', cursor: 'pointer', padding: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <img
                  src={url}
                  alt={emoji.name}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
