'use client';

import React, { useState } from 'react';

/**
 * YOK Message Renderer
 * Parses markdown-like syntax into React elements.
 * 
 * Supported:
 * - **bold**
 * - *italic*
 * - ***bold italic***
 * - ~~strikethrough~~
 * - `code`
 * - ||spoiler||
 * - [text](url) markdown links
 * - @username mentions
 * - URLs auto-linked
 */

interface SpoilerProps {
  children: React.ReactNode;
}

function Spoiler({ children }: SpoilerProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      style={{
        background: revealed ? 'rgba(255,255,255,0.08)' : '#55555E',
        color: revealed ? 'inherit' : 'transparent',
        borderRadius: 4,
        padding: '1px 4px',
        cursor: revealed ? 'text' : 'pointer',
        transition: 'all 0.3s ease',
        userSelect: revealed ? 'text' : 'none',
      }}
    >
      {children}
    </span>
  );
}

// Token types for our mini-parser
type Token =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'bolditalic'; value: string }
  | { type: 'strike'; value: string }
  | { type: 'code'; value: string }
  | { type: 'spoiler'; value: string }
  | { type: 'link'; url: string; text?: string }
  | { type: 'emoji_img'; name: string; url: string }
  | { type: 'mention'; username: string };

/**
 * Tokenize text using sequential pattern matching.
 * Each pattern is tried at current position; first match wins.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const patterns: { re: RegExp; toToken: (m: RegExpMatchArray) => Token }[] = [
    { re: /^!\[([^\]]+)\]\((\/emoji\/[^)]+)\)/, toToken: m => ({ type: 'emoji_img', name: m[1], url: m[2] }) },
    { re: /^\*\*\*(.+?)\*\*\*/, toToken: m => ({ type: 'bolditalic', value: m[1] }) },
    { re: /^\*\*(.+?)\*\*/, toToken: m => ({ type: 'bold', value: m[1] }) },
    { re: /^\*(.+?)\*/, toToken: m => ({ type: 'italic', value: m[1] }) },
    { re: /^~~(.+?)~~/, toToken: m => ({ type: 'strike', value: m[1] }) },
    { re: /^`(.+?)`/, toToken: m => ({ type: 'code', value: m[1] }) },
    { re: /^\|\|(.+?)\|\|/, toToken: m => ({ type: 'spoiler', value: m[1] }) },
    { re: /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)/, toToken: m => ({ type: 'link', url: m[2], text: m[1] }) },
    { re: /^@([a-zA-Z0-9_]{2,32})\b/, toToken: m => ({ type: 'mention', username: m[1] }) },
    { re: /^https?:\/\/[^\s<>\])"']+/, toToken: m => ({ type: 'link', url: m[0] }) },
  ];

  let pos = 0;
  while (pos < text.length) {
    let matched = false;
    const remaining = text.slice(pos);
    for (const { re, toToken } of patterns) {
      const m = remaining.match(re);
      if (m) {
        tokens.push(toToken(m));
        pos += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const last = tokens[tokens.length - 1];
      if (last && last.type === 'text') {
        last.value += text[pos];
      } else {
        tokens.push({ type: 'text', value: text[pos] });
      }
      pos++;
    }
  }

  return tokens;
}

/** Render formatted text content with markdown-like syntax. */
export function renderFormattedText(content: string | null | undefined): React.ReactNode {
  if (!content) return null;

  // Split by newlines to handle multi-line
  const lines = content.split('\n');

  return lines.map((line, lineIdx) => (
    <React.Fragment key={lineIdx}>
      {lineIdx > 0 && <br />}
      {renderLine(line, lineIdx)}
    </React.Fragment>
  ));
}

function renderLine(line: string, lineKey: number): React.ReactNode {
  const tokens = tokenize(line);
  if (tokens.length === 0) return null;

  return tokens.map((token, i) => {
    const key = `${lineKey}-${i}`;
    switch (token.type) {
      case 'text':
        return <span key={key}>{token.value}</span>;
      case 'bold':
        return <strong key={key} style={{ fontWeight: 600 }}>{token.value}</strong>;
      case 'italic':
        return <em key={key}>{token.value}</em>;
      case 'bolditalic':
        return <strong key={key} style={{ fontWeight: 600 }}><em>{token.value}</em></strong>;
      case 'strike':
        return <s key={key} style={{ opacity: 0.6 }}>{token.value}</s>;
      case 'code':
        return (
          <code key={key} style={{
            background: 'rgba(255,255,255,0.06)',
            padding: '2px 6px',
            borderRadius: 4,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: '0.9em',
          }}>
            {token.value}
          </code>
        );
      case 'spoiler':
        return <Spoiler key={key}>{token.value}</Spoiler>;
      case 'link':
        return (
          <a
            key={key}
            href={token.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#4DA6FF', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
          >
            {token.text || token.url.replace(/^https?:\/\/(www\.)?/, '').substring(0, 40)}
            {!token.text && token.url.replace(/^https?:\/\/(www\.)?/, '').length > 40 ? '…' : ''}
          </a>
        );
      case 'emoji_img':
        return (
          <img
            key={key}
            src={token.url}
            alt={token.name}
            title={token.name}
            style={{ height: '1.3em', width: 'auto', verticalAlign: 'middle', display: 'inline', objectFit: 'contain', margin: '0 1px' }}
            loading="lazy"
          />
        );
      case 'mention':
        return (
          <a
            key={key}
            href={`/chat?join=${token.username}`}
            style={{ color: '#4DA6FF', textDecoration: 'none', fontWeight: 500 }}
            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
          >
            @{token.username}
          </a>
        );
      default:
        return null;
    }
  });
}

/**
 * FormatToolbar — floating toolbar that appears when text is selected in the textarea.
 * Wraps selected text with markdown syntax.
 */
export function FormatToolbar({
  textareaRef,
  inputText,
  setInputText,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputText: string;
  setInputText: (text: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  React.useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    const handleSelect = () => {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      if (start !== end) {
        // Show toolbar above selection
        const rect = ta.getBoundingClientRect();
        setPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
        setShow(true);
      } else {
        setShow(false);
      }
    };

    const handleBlur = () => {
      // Delay to allow button clicks
      setTimeout(() => setShow(false), 200);
    };

    ta.addEventListener('select', handleSelect);
    ta.addEventListener('mouseup', handleSelect);
    ta.addEventListener('blur', handleBlur);

    return () => {
      ta.removeEventListener('select', handleSelect);
      ta.removeEventListener('mouseup', handleSelect);
      ta.removeEventListener('blur', handleBlur);
    };
  }, [textareaRef]);

  const wrapSelection = (prefix: string, suffix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = inputText.slice(start, end);
    const newText = inputText.slice(0, start) + prefix + selected + suffix + inputText.slice(end);
    setInputText(newText);
    // Restore focus
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 10);
    setShow(false);
  };

  if (!show) return null;

  const btnStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: '#E8E8E8', cursor: 'pointer',
    padding: '6px 10px', fontSize: 13, fontWeight: 500, borderRadius: 6,
    transition: 'background 0.15s',
  };

  return (
    <div style={{
      position: 'fixed',
      left: pos.x,
      top: pos.y,
      transform: 'translate(-50%, -100%)',
      background: 'rgba(10,10,12,0.55)',
      backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
      borderRadius: 10,
      padding: '4px 6px',
      display: 'flex',
      gap: 2,
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.06)',
      zIndex: 1000,
      animation: 'fadeIn 0.15s ease',
    }}>
      <button style={{ ...btnStyle, fontWeight: 700 }} onClick={() => wrapSelection('**', '**')} title="Жирный">B</button>
      <button style={{ ...btnStyle, fontStyle: 'italic' }} onClick={() => wrapSelection('*', '*')} title="Курсив">I</button>
      <button style={{ ...btnStyle, textDecoration: 'line-through' }} onClick={() => wrapSelection('~~', '~~')} title="Зачёркнут">S</button>
      <button style={{ ...btnStyle, fontFamily: 'monospace', fontSize: 12 }} onClick={() => wrapSelection('`', '`')} title="Код">&lt;/&gt;</button>
      <button style={btnStyle} onClick={() => wrapSelection('||', '||')} title="Спойлер">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
      <button style={btnStyle} onClick={() => {
        const url = prompt('URL:');
        if (url) wrapSelection('[', `](${url.startsWith('http') ? url : 'https://' + url})`);
      }} title="Ссылка">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
      </button>
    </div>
  );
}
