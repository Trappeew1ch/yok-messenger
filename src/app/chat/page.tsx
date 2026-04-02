'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useConversations, type ConversationWithDetails } from '@/lib/useConversations';
import { useMessages, type MessageWithSender, type MessageStatus } from '@/lib/useMessages';
import { useUserSearch } from '@/lib/useUserSearch';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { renderFormattedText, FormatToolbar } from '@/lib/MessageRenderer';
import MediaViewer from '@/lib/MediaViewer';
import VoiceRecorder from '@/lib/VoiceRecorder';
import VoicePlayer from '@/lib/VoicePlayer';
import VideoPlayer from '@/lib/VideoPlayer';
import EmojiPicker from '@/lib/EmojiPicker';
import { getEmojiUrl } from '@/lib/emojiData';
import {
  getOrCreateIdentity,
  setupConversationKey,
  encryptMessage,
  decryptMessage,
  isEncryptedPayload,
  parseEncryptedPayload,
  loadConversationKey,
  type EncryptedPayload,
} from '@/lib/crypto';

const C = {
  bg: '#0D0D0D', sidebar: '#141416', surface: '#1A1A1F', hover: '#222228',
  text: '#E8E8E8', sub: '#8E8E96', muted: '#55555E', blue: '#FFFFFF',
  sent: '#2A2A30', border: '#1F1F24', online: '#34C759', danger: '#EB5757',
};

// Helper: render emoji — custom image path or unicode fallback
const EmojiDisplay = ({ emoji, size = 36 }: { emoji: string; size?: number }) => {
  if (emoji.startsWith('/emoji/')) return <img src={emoji} alt="emoji" style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' }} />;
  return <span style={{ fontSize: size * 0.75, lineHeight: 1 }}>{emoji}</span>;
};

export default function ChatPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading, signOut, refreshProfile } = useAuth();
  const { conversations, loading: convsLoading, createDM, createGroup, createChannel, refresh: refreshConversations } = useConversations(user?.id);
  const [activeConvId, setActiveConvId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('yok_lastConv');
    return null;
  });
  const setActiveConvPersist = (id: string | null) => {
    setActiveConvId(id);
    if (id) localStorage.setItem('yok_lastConv', id); else localStorage.removeItem('yok_lastConv');
  };
  const { messages, sendMessage, sendTyping, editMessage, deleteMessage } = useMessages(activeConvId, user?.id);

  const [inputText, setInputText] = useState('');
  const [view, setView] = useState<'chats' | 'settings' | 'settings-detail'>('chats');
  const [settingsSection, setSettingsSection] = useState<'profile' | 'privacy' | 'appearance' | 'sessions'>('profile');

  // Sidebar search — searches USERS
  const [sidebarSearch, setSidebarSearch] = useState('');
  const { results: userSearchResults, search: searchUsers, clear: clearSearch, searching } = useUserSearch();
  const [searchHistory, setSearchHistory] = useState<string[]>([]); // user IDs of recently clicked

  // Modal (only group/channel)
  const [modal, setModal] = useState<{ open: boolean; type: 'group' | 'channel' | null; step: number; name: string; desc: string; members: string[]; search: string }>({
    open: false, type: null, step: 0, name: '', desc: '', members: [], search: ''
  });

  // Settings edits
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editGreetingEmoji, setEditGreetingEmoji] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [replyTo, setReplyTo] = useState<MessageWithSender | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{ file: File; url: string; type: string } | null>(null);
  const [mediaCaption, setMediaCaption] = useState('');
  const [creatingConv, setCreatingConv] = useState(false);
  const [viewerOpen, setViewerOpen] = useState<{ items: { url: string; type: 'image' | 'video'; messageId: string }[]; index: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ file: File; url: string; type: 'image' | 'video' | 'file' }[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msgId: string } | null>(null);
  const [settingsEmojiOpen, setSettingsEmojiOpen] = useState(false);
  const [profilePopup, setProfilePopup] = useState<{ id: string; name: string; username?: string | null; avatar?: string | null; emoji?: string | null; color?: string | null; bio?: string | null; isOnline?: boolean } | null>(null);
  const [channelSettings, setChannelSettings] = useState<{ open: boolean; name: string; desc: string; saving: boolean }>({ open: false, name: '', desc: '', saving: false });
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window !== 'undefined') { const v = localStorage.getItem('yok_fontsize'); return v ? parseInt(v) : 14; }
    return 14;
  });
  const [e2eKey, setE2eKey] = useState<CryptoKey | null>(null);
  const [decryptedCache, setDecryptedCache] = useState<Map<string, string>>(new Map());
  const identityRef = useRef<{ keyPair: CryptoKeyPair; publicJwk: JsonWebKey } | null>(null);
  const e2eKeyRef = useRef<CryptoKey | null>(null); // stable ref for handleSend
  const msgsEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!authLoading && !user) router.push('/auth'); }, [authLoading, user, router]);
  useEffect(() => { msgsEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  // Keep e2eKeyRef in sync
  useEffect(() => { e2eKeyRef.current = e2eKey; }, [e2eKey]);

  // Handle ?join=username and ?dm=userId query params (from @mentions and /username routes)
  useEffect(() => {
    if (!user?.id || conversations.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const joinUsername = params.get('join');
    const dmUserId = params.get('dm');

    if (joinUsername) {
      // Find conversation by username
      const conv = conversations.find(c => c.username === joinUsername);
      if (conv) {
        setActiveConvPersist(conv.id);
        setView('chats');
      } else {
        // Try to join via API
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'join_by_username', username: joinUsername, userId: user.id }),
        }).then(r => r.json()).then(data => {
          if (data.id) {
            refreshConversations().then(() => {
              setActiveConvPersist(data.id);
              setView('chats');
            });
          }
        });
      }
      // Clean URL
      window.history.replaceState({}, '', '/chat');
    }

    if (dmUserId) {
      createDM(dmUserId).then(id => {
        if (id) {
          refreshConversations().then(() => {
            setActiveConvPersist(id);
            setView('chats');
          });
        }
      });
      window.history.replaceState({}, '', '/chat');
    }
  }, [user?.id, conversations.length]);

  // ── E2EE: Initialize identity on login (once) ──
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getOrCreateIdentity(user.id).then(id => {
      if (cancelled) return;
      identityRef.current = id;
      // Publish public key to server (only if not already set)
      const pubKeyStr = JSON.stringify(id.publicJwk);
      if (profile?.public_key !== pubKeyStr) {
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_profile', userId: user.id, publicKey: pubKeyStr }),
        }).catch(() => {});
      }
    }).catch(err => console.warn('[YOK/E2EE] Identity init error:', err));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── E2EE: Setup conversation key when activeConvId changes ──
  useEffect(() => {
    if (!activeConvId || !identityRef.current) { setE2eKey(null); return; }
    let cancelled = false;
    const identity = identityRef.current;

    const setup = async () => {
      try {
        // 1. Try loading existing key from IndexedDB (fast)
        const cached = await loadConversationKey(activeConvId);
        if (cached) { if (!cancelled) setE2eKey(cached); return; }

        // 2. For DM — derive via ECDH
        const conv = conversations.find(c => c.id === activeConvId);
        let theirJwk: JsonWebKey | undefined;
        if (conv?.type === 'direct' && conv?.otherUser) {
          const res = await fetch(`/api/profile?userId=${conv.otherUser.id}`);
          const data = await res.json();
          if (data.profile?.public_key) {
            try { theirJwk = JSON.parse(data.profile.public_key); } catch {}
          }
        }

        const key = await setupConversationKey(activeConvId, identity.keyPair.privateKey, theirJwk);
        if (!cancelled) setE2eKey(key);
      } catch (err) {
        console.warn('[YOK/E2EE] Key setup failed, using unencrypted:', err);
        if (!cancelled) setE2eKey(null);
      }
    };
    setup();
    return () => { cancelled = true; };
  // Only re-run when activeConvId changes — NOT on every conversations update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  // ── E2EE: Decrypt messages in background ──
  useEffect(() => {
    if (!e2eKey || messages.length === 0) return;
    let cancelled = false;
    const decrypt = async () => {
      const newEntries: [string, string][] = [];
      for (const msg of messages) {
        if (cancelled) break;
        if (!msg.content || decryptedCache.has(msg.id)) continue;
        if (!isEncryptedPayload(msg.content)) continue;
        const payload = parseEncryptedPayload(msg.content);
        if (!payload) continue;
        try {
          const plain = await decryptMessage(payload, e2eKey);
          newEntries.push([msg.id, plain]);
        } catch {
          newEntries.push([msg.id, '🔒 Не удалось расшифровать']);
        }
      }
      if (!cancelled && newEntries.length > 0) {
        setDecryptedCache(prev => {
          const copy = new Map(prev);
          for (const [k, v] of newEntries) copy.set(k, v);
          return copy;
        });
      }
    };
    decrypt();
    return () => { cancelled = true; };
  }, [messages, e2eKey, decryptedCache]);

  /** Get display content for a message (decrypted if E2EE). */
  const getMessageContent = (msg: MessageWithSender): string | null => {
    if (!msg.content) return null;
    // Encrypted message — try cached decryption
    if (isEncryptedPayload(msg.content)) {
      return decryptedCache.get(msg.id) || '🔒 Расшифровка...';
    }
    // Plaintext message — show as-is
    return msg.content;
  };
  useEffect(() => {
    if ((view === 'settings' || view === 'settings-detail') && profile) {
      setEditName(profile.display_name);
      setEditUsername(profile.username || '');
      setEditBio(profile.bio || '');
      setEditGreetingEmoji(profile.profile_emoji || '👋');
    }
  }, [view, profile]);

  // Load search history from localStorage
  useEffect(() => {
    const h = localStorage.getItem('yok_search_history');
    if (h) setSearchHistory(JSON.parse(h));
  }, []);

  // Trigger user search when sidebar search changes
  useEffect(() => {
    if (sidebarSearch.trim()) searchUsers(sidebarSearch);
    else clearSearch();
  }, [sidebarSearch, searchUsers, clearSearch]);

  const activeConv = conversations.find(c => c.id === activeConvId);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() && attachedFiles.length === 0) return;
    if (inputText.trim()) {
      let content = inputText.trim();
      const key = e2eKeyRef.current;
      if (key) {
        try {
          const encrypted = await encryptMessage(content, key);
          content = JSON.stringify(encrypted);
        } catch (err) {
          console.warn('[YOK/E2EE] Encrypt failed, sending plaintext:', err);
        }
      }
      if (editingId) { await editMessage(editingId, content); setEditingId(null); }
      else { await sendMessage(content, 'text', replyTo ? { reply_to_id: replyTo.id } : undefined); setReplyTo(null); }
      setInputText('');
    }
    inputRef.current?.focus();
    if (inputRef.current) inputRef.current.style.height = 'auto';
    // Upload attached files
    if (attachedFiles.length > 0) {
      const files = [...attachedFiles];
      setAttachedFiles([]);
      for (const af of files) {
        await doMediaUpload(af.file);
      }
    }
  }, [inputText, sendMessage, editMessage, editingId, replyTo, attachedFiles]);

  /** Resize image client-side before upload (max 2560px, WebP). */
  const resizeImage = (file: File, maxSize = 2560): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => resolve(blob || file), 'image/webp', 0.85);
      };
      img.src = URL.createObjectURL(file);
    });
  };

  /** Upload media and send message. */
  const doMediaUpload = async (file: File, caption?: string) => {
    if (!user || !activeConvId) return;
    setUploadingMedia(true); setUploadProgress(0);
    try {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const msgType = isImage ? 'image' : isVideo ? 'video' : 'file';
      let uploadFile: Blob = file;
      let ext = file.name.split('.').pop();
      if (isImage) { uploadFile = await resizeImage(file); ext = 'webp'; }
      const path = `${activeConvId}/${Date.now()}.${ext}`;
      const progressInterval = setInterval(() => setUploadProgress(p => Math.min(p + 12, 90)), 150);
      // Use service-role API route for reliable upload
      const formData = new FormData();
      formData.append('file', uploadFile, `media.${ext}`);
      formData.append('path', path);
      formData.append('bucket', 'media');
      formData.append('userId', user.id);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      clearInterval(progressInterval);
      if (!data.url) { console.error('[YOK] Media upload error:', data.error); setUploadingMedia(false); return; }
      setUploadProgress(100);
      const text = caption || (isImage ? '📷 Фото' : isVideo ? '🎬 Видео' : '📎 Файл');
      await sendMessage(text, msgType as any, { media_url: data.url });
    } catch (err) { console.error('[YOK] Media upload:', err); }
    setUploadingMedia(false); setUploadProgress(0);
  };

  // Media upload from file input — supports multiple files
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    // Single file — show preview (images/videos); multiple or any type — add to attachments
    for (const file of files) {
      const isImg = file.type.startsWith('image/');
      const isVid = file.type.startsWith('video/');
      const ftype = isImg ? 'image' : isVid ? 'video' : 'file';
      setAttachedFiles(prev => [...prev, { file, url: URL.createObjectURL(file), type: ftype as any }]);
    }
    e.target.value = '';
  };

  // Send media after preview confirmation
  const handleSendMediaPreview = async () => {
    if (!mediaPreview) return;
    await doMediaUpload(mediaPreview.file, mediaCaption || undefined);
    URL.revokeObjectURL(mediaPreview.url);
    setMediaPreview(null); setMediaCaption('');
  };

  // Drag & drop handler — supports multiple files
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    if (files.length === 1 && (files[0].type.startsWith('image/') || files[0].type.startsWith('video/'))) {
      setMediaPreview({ file: files[0], url: URL.createObjectURL(files[0]), type: files[0].type.startsWith('image/') ? 'image' : 'video' });
    } else {
      for (const file of files) {
        await doMediaUpload(file);
      }
    }
  };

  // Ctrl+V paste handler
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) setMediaPreview({ file, url: URL.createObjectURL(file), type: 'image' });
        return;
      }
    }
  };

  // Voice message send handler
  const handleVoiceSend = async (blob: Blob, duration: number, waveform: number[]) => {
    if (!user || !activeConvId) return;
    setRecording(false); setUploadingMedia(true);
    try {
      const path = `${activeConvId}/${Date.now()}.webm`;
      const formData = new FormData();
      formData.append('file', blob, 'voice.webm');
      formData.append('path', path);
      formData.append('bucket', 'media');
      formData.append('userId', user.id);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.url) { console.error('[YOK] Voice upload error:', data.error); setUploadingMedia(false); return; }
      await sendMessage(`🎤 ${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`, 'voice', {
        media_url: data.url,
        media_metadata: JSON.stringify({ duration, waveform }),
      });
    } catch (err) { console.error('[YOK] Voice upload:', err); }
    setUploadingMedia(false);
  };

  // Collect all media items from messages for the viewer
  const mediaItems = messages
    .filter(m => m.media_url && (m.type === 'image' || m.type === 'video'))
    .map(m => ({ url: m.media_url!, type: m.type as 'image' | 'video', messageId: m.id }));

  // Click a searched user → create DM → open it
  const handleUserClick = async (clickedUserId: string) => {
    console.log('[YOK] handleUserClick:', clickedUserId);
    // Save to search history
    const newHistory = [clickedUserId, ...searchHistory.filter(id => id !== clickedUserId)].slice(0, 20);
    setSearchHistory(newHistory);
    localStorage.setItem('yok_search_history', JSON.stringify(newHistory));

    try {
      const convId = await createDM(clickedUserId);
      console.log('[YOK] createDM result:', convId);
      if (convId) {
        setActiveConvPersist(convId);
        setSidebarSearch('');
        clearSearch();
      } else {
        console.error('[YOK] createDM returned null — check browser console for errors above');
      }
    } catch (err) {
      console.error('[YOK] handleUserClick error:', err);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_profile', userId: user.id,
          displayName: editName,
          username: editUsername.length >= 5 ? editUsername : null,
          bio: editBio || null,
          profileEmoji: editGreetingEmoji || '👋',
        }),
      });
      await refreshProfile();
    } catch (err) { console.error('[YOK] save profile error:', err); }
    setSaving(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingAvatar(true);
    try {
      // Resize avatar to 400px
      const resized = await new Promise<Blob>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const size = 400;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d')!;
          const min = Math.min(img.width, img.height);
          const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
          ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
          canvas.toBlob(b => resolve(b || file), 'image/webp', 0.9);
        };
        img.src = URL.createObjectURL(file);
      });
      const path = `${user.id}/avatar.webp`;
      // Use service role via API for reliable upload
      const formData = new FormData();
      formData.append('file', resized, 'avatar.webp');
      formData.append('path', path);
      formData.append('bucket', 'avatars');
      formData.append('userId', user.id);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update_profile', userId: user.id, avatarUrl: data.url }),
        });
        await refreshProfile();
      } else {
        console.error('Avatar upload failed:', data.error);
      }
    } catch (err) { console.error('Avatar upload:', err); }
    setUploadingAvatar(false);
  };

  const getName = (c: ConversationWithDetails) => {
    if (c.type === 'direct' && c.otherUser) {
      if (c.otherUser.id === user?.id) return 'Избранное';
      return c.otherUser.display_name;
    }
    return c.name || 'Без названия';
  };
  const getInitial = (c: ConversationWithDetails) => getName(c)[0]?.toUpperCase() || '?';
  const getAvatar = (c: ConversationWithDetails) => {
    if (c.type === 'direct' && c.otherUser?.avatar_url) return c.otherUser.avatar_url;
    if ((c.type === 'group' || c.type === 'channel') && c.avatar_url) return c.avatar_url;
    return null;
  };
  const getPreview = (c: ConversationWithDetails) => {
    if (!c.lastMessage) return 'Нет сообщений';
    if (c.lastMessage.type === 'image') return '🖼 Фото';
    if (c.lastMessage.type === 'video') return '🎬 Видео';
    if (c.lastMessage.type === 'voice') return '🎤 Голосовое';
    if (c.lastMessage.type === 'file') return '📄 Файл';
    const raw = c.lastMessage.content || '';
    // Strip encrypted payloads
    if (raw.startsWith('{') && raw.includes('"iv"')) return '🔒 Сообщение';
    // Strip emoji markdown ![name](/emoji/...) → name
    const clean = raw.replace(/!\[([^\]]+)\]\([^)]+\)/g, '$1');
    return clean.substring(0, 50) || '';
  };

  const resetModal = () => setModal({ open: false, type: null, step: 0, name: '', desc: '', members: [], search: '' });
  const handleCreate = async () => {
    if (creatingConv) return; // prevent duplicate
    setCreatingConv(true);
    try {
      if (modal.type === 'group' && modal.name && modal.members.length > 0) {
        const id = await createGroup(modal.name, modal.members);
        if (id) setActiveConvPersist(id);
      } else if (modal.type === 'channel' && modal.name) {
        const id = await createChannel(modal.name);
        if (id) setActiveConvPersist(id);
      }
    } finally {
      setCreatingConv(false);
    }
    resetModal();
  };

  /* ═══════ SVGs ═══════ */
  const ic = {
    chat: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>,
    write: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
    send: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    back: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
    close: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    search: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    chevron: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
    profileIc: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    privacyIc: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    themeIc: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>,
    sessionIc: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    camera: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
    attach: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>,
  };

  if (authLoading || !user) return (
    <div suppressHydrationWarning style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, color: C.text, fontFamily: "'Inter',sans-serif" }}>
      <img src="/yokicon.png" alt="YOK" style={{ width: 48, height: 48, objectFit: 'contain' }} />
    </div>
  );

  /* ═══════ Avatar component ═══════ */
  const Avatar = ({ src, name, size = 44, color }: { src?: string | null; name: string; size?: number; color?: string }) => {
    if (src) return <img src={src} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: color || C.hover, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: size * 0.38, color: C.blue, flexShrink: 0 }}>
        {name[0]?.toUpperCase() || '?'}
      </div>
    );
  };

  /* ═══════ MODAL (Group/Channel only) ═══════ */
  const renderModal = () => {
    if (!modal.open) return null;
    const totalSteps = modal.type === 'group' ? 2 : 1;
    const progress = modal.type ? modal.step / totalSteps : 0;
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={e => { if (e.target === e.currentTarget) resetModal(); }}>
        <div style={{ width: 420, background: 'rgba(10,10,12,0.55)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
          <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{!modal.type ? 'Создать' : modal.type === 'group' ? 'Новая группа' : 'Новый канал'}</span>
            <button onClick={resetModal} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}>{ic.close}</button>
          </div>
          {modal.type && <div style={{ height: 3, background: C.bg }}><div style={{ height: '100%', width: `${progress * 100}%`, background: C.blue, transition: 'width 0.3s ease' }} /></div>}
          <div style={{ padding: 20, minHeight: modal.type ? 160 : 100 }}>
            {/* Choose type */}
            {!modal.type && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[{ t: 'group' as const, title: 'Группа', desc: 'Чат для нескольких участников' }, { t: 'channel' as const, title: 'Канал', desc: 'Вещание для аудитории' }].map(({ t, title, desc }) => (
                  <div key={t} onClick={() => setModal(m => ({ ...m, type: t, step: 1 }))} style={{ padding: 16, background: C.bg, borderRadius: 14, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div><div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div><div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>{desc}</div></div>
                    <span style={{ color: C.muted }}>{ic.chevron}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Step 1: Name */}
            {modal.type && modal.step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <label style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: C.sub }}>Название</label>
                <input autoFocus value={modal.name} onChange={e => setModal(m => ({ ...m, name: e.target.value }))} placeholder="Название..." style={inputStyle} />
                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                  <Pill onClick={() => setModal(m => ({ ...m, type: null, step: 0 }))}>Назад</Pill>
                  <Pill primary onClick={() => modal.type === 'group' ? setModal(m => ({ ...m, step: 2 })) : handleCreate()} disabled={!modal.name}>{modal.type === 'channel' ? 'Создать' : 'Далее'}</Pill>
                </div>
              </div>
            )}
            {/* Step 2: Members (group) */}
            {modal.type === 'group' && modal.step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', height: 300 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.bg, borderRadius: 12, padding: '10px 14px', marginBottom: 16 }}>
                  {ic.search}
                  <input autoFocus value={modal.search} onChange={e => { setModal(m => ({ ...m, search: e.target.value })); searchUsers(e.target.value); }} placeholder="Поиск участников..." style={{ background: 'none', border: 'none', color: C.text, flex: 1, fontSize: 14 }} />
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {userSearchResults.filter(u => u.id !== user?.id).map(u => {
                    const sel = modal.members.includes(u.id);
                    return (
                      <div key={u.id} onClick={() => setModal(m => ({ ...m, members: sel ? m.members.filter(id => id !== u.id) : [...m.members, u.id] }))}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', background: sel ? 'rgba(77,166,255,0.08)' : 'transparent' }}>
                        <Avatar src={u.avatar_url} name={u.display_name} size={40} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 15 }}>{u.display_name}</div>
                          {u.username && <div style={{ fontSize: 13, color: C.sub }}>@{u.username}</div>}
                        </div>
                        {sel && <span style={{ color: C.blue, fontWeight: 600 }}>✓</span>}
                      </div>
                    );
                  })}
                  {modal.search.length >= 1 && userSearchResults.length === 0 && <div style={{ textAlign: 'center', color: C.muted, marginTop: 40 }}>Не найдено</div>}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                  <Pill onClick={() => setModal(m => ({ ...m, step: 1 }))}>Назад</Pill>
                  <Pill primary onClick={handleCreate} disabled={modal.members.length === 0}>Создать</Pill>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ═══════ SETTINGS ═══════ */
  const settingsSections = [
    { id: 'profile' as const, label: 'Профиль', icon: ic.profileIc, color: '#3478F6' },
    { id: 'privacy' as const, label: 'Конфиденциальность', icon: ic.privacyIc, color: '#30B650' },
    { id: 'appearance' as const, label: 'Оформление', icon: ic.themeIc, color: '#FF9500' },
    { id: 'sessions' as const, label: 'Устройства', icon: ic.sessionIc, color: '#8E8E93' },
  ];

  const renderSettingsMain = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => setView('chats')} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}>{ic.back}</button>
        <span style={{ fontSize: 18, fontWeight: 600 }}>Настройки</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, background: C.surface, borderRadius: 14, marginBottom: 20, cursor: 'pointer' }}
          onClick={() => { setSettingsSection('profile'); setView('settings-detail'); }}>
          <Avatar src={profile?.avatar_url} name={profile?.display_name || ''} size={52} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{profile?.display_name}</div>
            <div style={{ fontSize: 13, color: C.sub }}>{profile?.username ? `@${profile.username}` : 'Редактировать профиль'}</div>
          </div>
          <span style={{ color: C.muted }}>{ic.chevron}</span>
        </div>
        <div style={{ background: C.surface, borderRadius: 14, overflow: 'hidden' }}>
          {settingsSections.map((s, i) => (
            <div key={s.id} onClick={() => { setSettingsSection(s.id); setView('settings-detail'); }}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', cursor: 'pointer', borderBottom: i < settingsSections.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.icon}</div>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{s.label}</span>
              <span style={{ color: C.muted }}>{ic.chevron}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderSettingsDetail = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => setView('settings')} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}>{ic.back}</button>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{settingsSection === 'profile' ? 'Профиль' : settingsSection === 'privacy' ? 'Конфиденциальность' : settingsSection === 'appearance' ? 'Оформление' : 'Устройства'}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {settingsSection === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Avatar upload */}
            <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <div onClick={() => avatarInputRef.current?.click()}
                style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}>
                <Avatar src={profile?.avatar_url} name={profile?.display_name || ''} size={80} />
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: '50%', background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${C.sidebar}` }}>{ic.camera}</div>
                {uploadingAvatar && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>...</div>}
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>Нажмите для смены аватарки</div>
            </div>
            <SInput label="Имя" value={editName} onChange={setEditName} />
            <SInput label="Юзернейм" value={editUsername} onChange={v => setEditUsername(v.replace(/\s/g, ''))} prefix="@" />
            <div>
              <label style={labelStyle}>О себе</label>
              <textarea value={editBio} onChange={e => setEditBio(e.target.value.slice(0, 200))} rows={3}
                style={{ width: '100%', resize: 'none', background: C.hover, border: 'none', borderRadius: 10, padding: 12, color: C.text, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              <div style={{ fontSize: 12, color: C.muted, textAlign: 'right' }}>{editBio.length}/200</div>
            </div>
            {/* Greeting emoji picker — custom animated emojis */}
            <div>
              <label style={labelStyle}>Приветственный эмодзи</label>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>Отображается при первом диалоге с вами</div>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setSettingsEmojiOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: C.hover, borderRadius: 12, border: 'none', color: C.text, cursor: 'pointer', width: '100%', fontSize: 14 }}>
                  <EmojiDisplay emoji={editGreetingEmoji} size={28} />
                  <span style={{ flex: 1, textAlign: 'left' }}>Выбрать эмодзи</span>
                  <span style={{ color: C.muted, fontSize: 12 }}>▼</span>
                </button>
                {settingsEmojiOpen && (
                  <EmojiPicker
                    onSelect={(url, name) => {
                      setEditGreetingEmoji(url);
                      setSettingsEmojiOpen(false);
                    }}
                    onClose={() => setSettingsEmojiOpen(false)}
                  />
                )}
              </div>
            </div>
            {/* Save button — only show when there are changes */}
            {(editName !== (profile?.display_name || '') || editUsername !== (profile?.username || '') || editBio !== (profile?.bio || '') || editGreetingEmoji !== (profile?.profile_emoji || '👋')) && (
              <Pill primary fullWidth onClick={handleSaveProfile} disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить'}</Pill>
            )}
          </div>
        )}
        {settingsSection === 'privacy' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: C.surface, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>🔒 Шифрование</div>
              <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.7 }}>
                Все сообщения зашифрованы сквозным шифрованием (E2EE) по протоколу <b>ECDH P-256</b> + <b>AES&#x2011;256&#x2011;GCM</b>.
                Ключи хранятся только на вашем устройстве и никогда не передаются на сервер.
                Сервер видит только зашифрованный контент.
              </div>
            </div>
            <div style={{ background: C.surface, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>🛡️ Защита данных</div>
              <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.7 }}>
                Пароли хешируются алгоритмом <b>bcrypt</b> и не хранятся в открытом виде.
                Все соединения защищены <b>TLS 1.3</b>.
                Электронная почта используется только для аутентификации и не передаётся третьим лицам.
              </div>
            </div>
            <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', lineHeight: 1.6, padding: '0 8px' }}>
              YOK шифрует весь трафик: сообщения, медиа, голосовые, пароли и личные данные.
              Никто, включая команду YOK, не может прочитать ваши переписки.
            </div>
          </div>
        )}
        {settingsSection === 'appearance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: C.surface, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>🔤 Размер шрифта</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 11, color: C.muted }}>A</span>
                <input type="range" min={12} max={20} value={fontSize} onChange={e => { const v = parseInt(e.target.value); setFontSize(v); localStorage.setItem('yok_fontsize', String(v)); }}
                  style={{ flex: 1, accentColor: C.blue }} />
                <span style={{ fontSize: 18, color: C.muted }}>A</span>
                <span style={{ fontSize: 13, color: C.sub, minWidth: 28, textAlign: 'right' }}>{fontSize}px</span>
              </div>
              <div style={{ fontSize: fontSize, color: C.text, marginTop: 12, background: C.hover, borderRadius: 10, padding: '10px 14px', lineHeight: 1.5 }}>Пример текста с эмодзи 😊</div>
            </div>
          </div>
        )}
        {settingsSection === 'sessions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: C.surface, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Текущее устройство</div>
              <div style={{ fontSize: 13, color: C.online, marginTop: 4 }}>Активно</div>
            </div>
            <Pill danger fullWidth onClick={async () => { await signOut(); router.push('/auth'); }}>Завершить сессию</Pill>
          </div>
        )}
      </div>
    </div>
  );

  /* ═══════ LEFT NAV ═══════ */
  const isSettingsView = view === 'settings' || view === 'settings-detail';
  const renderNav = () => (
    <div style={{ width: 64, background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 20, gap: 8, flexShrink: 0 }}>
      <img src="/yokicon.png" alt="YOK" style={{ width: 32, height: 32, objectFit: 'contain', marginBottom: 16 }} />
      <NavBtn icon={ic.chat} active={view === 'chats'} onClick={() => setView('chats')} />
      {/* Favorites */}
      <NavBtn icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>} active={false} onClick={async () => {
        // Find or create 'Избранное' self-chat
        const existing = conversations.find(c => c.type === 'direct' && c.otherUser?.id === user?.id);
        if (existing) { setActiveConvPersist(existing.id); setView('chats'); return; }
        const id = await createDM(user!.id);
        if (id) { await refreshConversations(); setActiveConvPersist(id); setView('chats'); }
      }} />
      <div style={{ flex: 1 }} />
      <div onClick={() => setView(isSettingsView ? 'chats' : 'settings')}
        style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', cursor: 'pointer', marginBottom: 16, border: isSettingsView ? `2px solid ${C.blue}` : '2px solid transparent', transition: 'border 0.15s', flexShrink: 0 }}>
        <Avatar src={profile?.avatar_url} name={profile?.display_name || ''} size={34} />
      </div>
    </div>
  );

  /* ═══════ SIDEBAR ═══════ */
  const isSearching = sidebarSearch.trim().length > 0;

  const renderSidebar = () => {
    if (view === 'settings') return renderSettingsMain();
    if (view === 'settings-detail') return renderSettingsDetail();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>Чаты</span>
          <button onClick={() => setModal({ open: true, type: null, step: 0, name: '', desc: '', members: [], search: '' })}
            style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer', padding: 4 }}>{ic.write}</button>
        </div>
        {/* Search bar — searches users globally */}
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, borderRadius: 12, padding: '8px 12px' }}>
            <span style={{ color: C.muted }}>{ic.search}</span>
            <input placeholder="Поиск людей..." value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              style={{ background: 'none', border: 'none', flex: 1, color: C.text, fontSize: 14 }} />
            {sidebarSearch && (
              <button onClick={() => { setSidebarSearch(''); clearSearch(); }}
                style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 2 }}>{ic.close}</button>
            )}
          </div>
        </div>

        {/* Content: either user search results OR conversations */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isSearching ? (
            // USER SEARCH RESULTS
            <div>
              {searching && <div style={{ padding: 20, textAlign: 'center', color: C.muted }}>Поиск...</div>}
              {!searching && userSearchResults.filter(u => u.id !== user?.id).length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 14 }}>Пользователи не найдены</div>
              )}
              {userSearchResults.filter(u => u.id !== user?.id).map(u => (
                <div key={u.id} onClick={() => handleUserClick(u.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <Avatar src={u.avatar_url} name={u.display_name} size={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{u.display_name}</div>
                    {u.username && <div style={{ fontSize: 13, color: C.sub }}>@{u.username}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // CONVERSATIONS
            <>
              {convsLoading ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Загрузка...</div> :
                conversations.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 14, lineHeight: 1.6 }}>У вас пока нет чатов.<br />Найдите человека через поиск.</div> :
                conversations.map(cv => {
                  const active = activeConvId === cv.id;
                  return (
                    <div key={cv.id} onClick={() => setActiveConvPersist(cv.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', background: active ? C.hover : 'transparent', transition: 'background 0.1s' }}>
                      <Avatar src={getAvatar(cv)} name={getName(cv)} size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getName(cv)}</span>
                          {cv.lastMessage && <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{new Date(cv.lastMessage.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>}
                        </div>
                        <div style={{ fontSize: 13, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getPreview(cv)}</div>
                      </div>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      </div>
    );
  };

  /* ═══════ WELCOME SCREEN for empty DMs ═══════ */
  const renderWelcome = () => {
    if (!activeConv || activeConv.type !== 'direct' || !activeConv.otherUser) return null;
    const other = activeConv.otherUser;
    const emoji = other.profile_emoji || '👋';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, flex: 1 }}>
        <div style={{ background: C.surface, borderRadius: 20, padding: '40px 48px', textAlign: 'center', backdropFilter: 'blur(10px)', maxWidth: 360 }}>
          <Avatar src={other.avatar_url} name={other.display_name} size={72} />
          <div style={{ fontSize: 20, fontWeight: 600, marginTop: 16 }}>{other.display_name}</div>
          {other.username && <div style={{ fontSize: 14, color: C.sub, marginTop: 4 }}>@{other.username}</div>}
          {other.bio && <div style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{other.bio}</div>}
          <div style={{ marginTop: 20 }}><EmojiDisplay emoji={emoji} size={48} /></div>
          <div style={{ fontSize: 14, color: C.sub, marginTop: 8 }}>Поприветствуйте {other.display_name.split(' ')[0]}!</div>
          <button onClick={() => { setInputText((emoji.startsWith('/emoji/') ? `![emoji](${emoji})` : emoji) + ' Привет!'); inputRef.current?.focus(); }}
            style={{ marginTop: 16, padding: '10px 24px', borderRadius: 50, background: C.hover, color: C.text, border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <EmojiDisplay emoji={emoji} size={18} /> Отправить приветствие
          </button>
        </div>
      </div>
    );
  };

  /* ═══════ CHAT AREA ═══════ */
  const renderChat = () => {
    if (!activeConv) return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: C.bg }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: C.muted }}>{ic.chat}</div>
        <div style={{ color: C.muted, fontSize: 15 }}>Выберите чат или найдите человека</div>
      </div>
    );
    const hasMessages = messages.length > 0;
    // Status check icon
    const StatusIcon = ({ status }: { status?: MessageStatus }) => {
      if (status === 'sending') return <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>⏳</span>;
      if (status === 'read') return <span style={{ fontSize: 11, color: C.blue, marginLeft: 4 }}>✓✓</span>;
      if (status === 'error') return <span style={{ fontSize: 11, color: C.danger, marginLeft: 4 }}>!</span>;
      return <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>✓</span>; // sent
    };

    return (
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.bg, minWidth: 0, position: 'relative', overflow: 'hidden' }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Drag & drop overlay */}
        {dragOver && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(77,166,255,0.08)', border: `2px dashed ${C.blue}`, borderRadius: 12, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 18, color: C.blue, fontWeight: 600 }}>📎 Перетащите файл сюда</div>
          </div>
        )}
        <div style={{ padding: '10px 16px', background: 'transparent', zIndex: 10, position: 'absolute', top: 0, left: 0, right: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(13,13,13,0.6)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderRadius: 50, padding: '8px 16px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div onClick={() => {
              if (activeConv.type === 'direct' && activeConv.otherUser) {
                setProfilePopup({ id: activeConv.otherUser.id, name: activeConv.otherUser.display_name, username: activeConv.otherUser.username, avatar: activeConv.otherUser.avatar_url, emoji: activeConv.otherUser.profile_emoji, color: activeConv.otherUser.profile_color, bio: activeConv.otherUser.bio, isOnline: activeConv.otherUser.is_online });
              }
            }} style={{ cursor: activeConv.type === 'direct' ? 'pointer' : 'default' }}>
              <Avatar src={getAvatar(activeConv)} name={getName(activeConv)} size={36} />
            </div>
            <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => {
              if (activeConv.type === 'direct' && activeConv.otherUser) {
                setProfilePopup({ id: activeConv.otherUser.id, name: activeConv.otherUser.display_name, username: activeConv.otherUser.username, avatar: activeConv.otherUser.avatar_url, emoji: activeConv.otherUser.profile_emoji, color: activeConv.otherUser.profile_color, bio: activeConv.otherUser.bio, isOnline: activeConv.otherUser.is_online });
              } else if (activeConv.type === 'group' || activeConv.type === 'channel') {
                setChannelSettings({ open: true, name: activeConv.name || '', desc: activeConv.description || '', saving: false });
              }
            }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{getName(activeConv)}</div>
              <div style={{ fontSize: 12, color: activeConv.type === 'direct' && activeConv.otherUser?.is_online ? C.online : C.muted }}>
                {activeConv.type === 'direct' ? (activeConv.otherUser?.is_online ? 'в сети' : 'не в сети') : `${activeConv.members.length} участн.`}
              </div>
            </div>
          </div>
        </div>
        {/* Upload progress bar */}
        {uploadingMedia && uploadProgress > 0 && (
          <div style={{ height: 3, background: C.surface }}><div style={{ height: '100%', width: `${uploadProgress}%`, background: C.blue, transition: 'width 0.2s', borderRadius: 2 }} /></div>
        )}
        {/* Messages or Welcome */}
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: hasMessages ? 68 : 0, paddingBottom: hasMessages ? 72 : 0, paddingLeft: 24, paddingRight: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {hasMessages ? messages.map(msg => {
            const mine = msg.sender_id === user?.id;
            const isSending = msg._status === 'sending';
            const displayContent = getMessageContent(msg);
            const isImage = msg.media_url && msg.type === 'image';
            const isVideo = msg.media_url && msg.type === 'video';
            const isVoice = msg.media_url && msg.type === 'voice';
            const isMediaOnly = (isImage || isVideo) && (!displayContent || displayContent.startsWith('📷') || displayContent.startsWith('🎬'));
            const hasCaption = (isImage || isVideo) && displayContent && !displayContent.startsWith('📷') && !displayContent.startsWith('🎬');

            // Time + status badge (used for both overlay and inline)
            const timeBadge = (overlay?: boolean) => (
              <span style={{
                fontSize: 11, color: overlay ? '#fff' : C.muted, marginLeft: 8,
                ...(overlay ? { position: 'absolute' as const, bottom: 6, right: 8, background: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: '2px 8px', backdropFilter: 'blur(4px)' } : {}),
                whiteSpace: 'nowrap', lineHeight: '20px',
              }}>
                {new Date(msg.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}{msg.is_edited && ' (ред.)'}
                {mine && <StatusIcon status={msg._status} />}
              </span>
            );

            return (
              <div key={msg.id || msg._tempId} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', opacity: isSending ? 0.7 : 1, transition: 'opacity 0.2s' }}
                onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, msgId: msg.id }); }}>

                {/* ═══ MEDIA-ONLY (no caption) — no bubble, just rounded media ═══ */}
                {isMediaOnly ? (
                  <div style={{ maxWidth: 320, position: 'relative', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                    {isImage && (
                      <img src={msg.media_url!} alt="" loading="lazy"
                        style={{ display: 'block', width: '100%', borderRadius: 16, cursor: 'pointer', minHeight: 80, background: C.surface, objectFit: 'cover' }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        onClick={() => { const idx = mediaItems.findIndex(m => m.messageId === msg.id); if (idx >= 0) setViewerOpen({ items: mediaItems, index: idx }); }} />
                    )}
                    {isVideo && (
                      <VideoPlayer src={msg.media_url!} />
                    )}
                    {timeBadge(true)}
                  </div>

                /* ═══ MEDIA + CAPTION  — bubble with media flush top ═══ */
                ) : hasCaption ? (
                  <div style={{ maxWidth: 420, borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px', overflow: 'hidden', background: mine ? C.sent : C.surface }}>
                    {isImage && (
                      <div style={{ position: 'relative' }}>
                        <img src={msg.media_url!} alt="" loading="lazy"
                          style={{ display: 'block', width: '100%', cursor: 'pointer', minHeight: 80, background: C.surface, objectFit: 'cover' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          onClick={() => { const idx = mediaItems.findIndex(m => m.messageId === msg.id); if (idx >= 0) setViewerOpen({ items: mediaItems, index: idx }); }} />
                      </div>
                    )}
                    {isVideo && (
                      <VideoPlayer src={msg.media_url!} />
                    )}
                    <div style={{ padding: '8px 14px 10px', fontSize }}>
                      {!mine && activeConv.type !== 'direct' && <div style={{ fontSize: 12, fontWeight: 600, color: C.blue, marginBottom: 4 }}>{msg.sender?.display_name}</div>}
                      <div>
                        {renderFormattedText(displayContent!)}
                        {timeBadge()}
                      </div>
                    </div>
                  </div>

                /* ═══ VOICE / TEXT — standard bubble ═══ */
                ) : (
                  <div style={{ background: mine ? C.sent : C.surface, borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px', padding: '10px 14px', maxWidth: 420, fontSize, lineHeight: 1.5 }}>
                    {!mine && activeConv.type !== 'direct' && <div style={{ fontSize: 12, fontWeight: 600, color: C.blue, marginBottom: 4 }}>{msg.sender?.display_name}</div>}
                    {isVoice && (
                      <VoicePlayer
                        src={msg.media_url!}
                        duration={msg.media_metadata ? JSON.parse(typeof msg.media_metadata === 'string' ? msg.media_metadata : JSON.stringify(msg.media_metadata))?.duration : undefined}
                        waveformPeaks={msg.media_metadata ? JSON.parse(typeof msg.media_metadata === 'string' ? msg.media_metadata : JSON.stringify(msg.media_metadata))?.waveform : undefined}
                        isMine={mine}
                      />
                    )}
                    {displayContent && !(msg.type === 'image' && displayContent.startsWith('📷')) && !(msg.type === 'video' && displayContent.startsWith('🎬')) && !(msg.type === 'voice' && displayContent.startsWith('🎤')) ? (
                      <div>
                        {renderFormattedText(displayContent)}
                        {timeBadge()}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: C.muted }}>{new Date(msg.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}{msg.is_edited && ' (ред.)'}</span>
                        {mine && <StatusIcon status={msg._status} />}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }) : renderWelcome()}
          <div ref={msgsEnd} />
        </div>
        {/* Reply bar */}
        {replyTo && (
          <div style={{ padding: '8px 24px', background: 'rgba(10,10,12,0.55)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, color: C.sub }}>Ответ: {replyTo.content?.substring(0, 40)}</div>
            <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer' }}>{ic.close}</button>
          </div>
        )}
        {/* Format toolbar */}
        <FormatToolbar textareaRef={inputRef} inputText={inputText} setInputText={setInputText} />
        {/* Attachment preview */}
        {attachedFiles.length > 0 && (
          <div style={{ position: 'absolute', bottom: 64, left: 16, right: 16, zIndex: 11, display: 'flex', gap: 6, padding: '10px 12px', background: 'rgba(13,13,13,0.7)', backdropFilter: 'blur(20px)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
            {attachedFiles.map((af, i) => (
              <div key={i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 10, overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(255,255,255,0.08)', background: '#1A1A1F' }}
                onClick={() => { if (af.type === 'image') setViewerOpen({ items: [{ url: af.url, type: 'image', messageId: '' }], index: 0 }); }}>
                {af.type === 'image' ? (
                  <img src={af.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : af.type === 'video' ? (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1A1A1F' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  </div>
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8E8E96" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style={{ fontSize: 8, color: '#8E8E96', marginTop: 2, maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{af.file.name.split('.').pop()?.toUpperCase()}</span>
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); setAttachedFiles(prev => prev.filter((_, j) => j !== i)); URL.revokeObjectURL(af.url); }}
                  style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              </div>
            ))}
          </div>
        )}
        {/* Context menu */}
        {contextMenu && (
          <>
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} onClick={() => setContextMenu(null)} />
            <div style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, background: 'rgba(10,10,12,0.8)', backdropFilter: 'blur(24px)', borderRadius: 10, padding: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.08)', zIndex: 1000, minWidth: 150 }}>
              <button onClick={() => { deleteMessage(contextMenu.msgId); setContextMenu(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', color: '#EB5757', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(235,87,87,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                Удалить
              </button>
              <button onClick={() => { const msg = messages.find(m => m.id === contextMenu.msgId); if (msg?.content) { navigator.clipboard.writeText(msg.content); } setContextMenu(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', color: '#E8E8E8', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                Копировать
              </button>
              <button onClick={() => { setReplyTo(messages.find(m => m.id === contextMenu.msgId) || null); setContextMenu(null); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'none', border: 'none', color: '#E8E8E8', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
                Ответить
              </button>
            </div>
          </>
        )}
        {/* Input — fully rounded pill */}
        <input ref={mediaInputRef} type="file" accept="*/*" hidden multiple onChange={handleMediaUpload} />
        <div style={{ padding: '10px 16px', background: 'transparent', zIndex: 10, position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(13,13,13,0.6)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderRadius: 50, padding: '8px 10px 8px 20px', border: '1px solid rgba(255,255,255,0.06)' }}>
            {recording ? (
              <VoiceRecorder onSend={handleVoiceSend} onCancel={() => setRecording(false)} />
            ) : (
              <>
                {/* Attach button */}
                <button onClick={() => mediaInputRef.current?.click()} disabled={uploadingMedia}
                  style={{ background: 'none', border: 'none', color: uploadingMedia ? C.blue : C.muted, cursor: 'pointer', padding: 4, flexShrink: 0, display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}>
                  {uploadingMedia ? <span style={{ fontSize: 13 }}>⏳</span> : ic.attach}
                </button>
                {/* Emoji button */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button onClick={() => setEmojiOpen(v => !v)}
                    style={{ background: 'none', border: 'none', color: emojiOpen ? C.blue : C.muted, cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                  </button>
                  {emojiOpen && (
                    <EmojiPicker
                      onSelect={(url, name) => {
                        setEmojiOpen(false);
                        // Insert emoji inline into text
                        const emojiMd = `![${name}](${url})`;
                        setInputText(prev => prev + emojiMd);
                        inputRef.current?.focus();
                      }}
                      onClose={() => setEmojiOpen(false)}
                    />
                  )}
                </div>
                {/* Textarea with emoji preview */}
                <div style={{ flex: 1, position: 'relative', minHeight: 22, display: 'flex', alignItems: 'center' }}>
                  <textarea
                    ref={inputRef}
                    placeholder="Написать сообщение..."
                    value={inputText}
                    rows={1}
                    onChange={e => {
                      setInputText(e.target.value);
                      sendTyping();
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); }
                      if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); }
                    }}
                    onPaste={handlePaste}
                    style={{
                      width: '100%', background: 'transparent', border: 'none', color: inputText.includes('![') ? 'transparent' : C.text, fontSize: 14,
                      resize: 'none', lineHeight: '22px', maxHeight: 200, minHeight: 22,
                      fontFamily: 'inherit', padding: '5px 0', position: 'relative', zIndex: 2,
                      caretColor: C.text,
                    }}
                  />
                  {/* Emoji preview overlay */}
                  {inputText.includes('![') && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      fontSize: 14, lineHeight: '22px', padding: '5px 0',
                      pointerEvents: 'none', zIndex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      color: C.text,
                    }}>
                      {inputText.split(/(!\[[^\]]+\]\([^)]+\))/).map((part, i) => {
                        const emojiMatch = part.match(/^!\[([^\]]+)\]\(([^)]+)\)$/);
                        if (emojiMatch) {
                          return <img key={i} src={emojiMatch[2]} alt={emojiMatch[1]} style={{ height: '1.3em', verticalAlign: 'middle', display: 'inline' }} />;
                        }
                        return <span key={i}>{part}</span>;
                      })}
                    </div>
                  )}
                </div>
                {/* Mic button */}
                {!inputText.trim() && attachedFiles.length === 0 && (
                  <button onClick={() => setRecording(true)} style={{ width: 36, height: 36, borderRadius: '50%', background: C.hover, color: C.muted, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                  </button>
                )}
                {/* Send button */}
                {(inputText.trim() || attachedFiles.length > 0) && (
                  <button onClick={handleSend}
                    style={{ width: 36, height: 36, borderRadius: '50%', background: '#FFFFFF', color: '#0D0D0D', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ═══════ LAYOUT ═══════ */
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: C.bg, color: C.text, fontFamily: "'Inter', sans-serif", justifyContent: 'center' }}>
      <div style={{ display: 'flex', width: '100%', maxWidth: 1200, height: '100%' }}>
        {renderNav()}
        <div style={{ width: 320, borderRight: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}`, background: C.sidebar, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>{renderSidebar()}</div>
        {renderChat()}
      </div>
      {renderModal()}

      {/* ═══ Channel / Group Info Panel ═══ */}
      {channelSettings.open && activeConvId && (() => {
        const conv = conversations.find(c => c.id === activeConvId);
        if (!conv || (conv.type !== 'group' && conv.type !== 'channel')) return null;
        const myRole = conv.members.find((m: any) => m.user_id === user?.id)?.role || 'member';
        const isOwner = myRole === 'owner';
        const usernameLink = conv.invite_link ? `@${conv.invite_link}` : '';
        const adminMode = (channelSettings as any).admin;
        const setAdmin = (v: boolean) => setChannelSettings(s => ({ ...s, admin: v } as any));

        const handleSaveSettings = async () => {
          if (!user) return;
          setChannelSettings(s => ({ ...s, saving: true }));
          try {
            const body: any = { action: 'update_conversation', userId: user.id, conversationId: activeConvId, name: channelSettings.name, description: channelSettings.desc };
            const uname = (channelSettings as any).username;
            if (uname !== undefined) body.inviteLink = uname;
            await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          } catch (e) { console.error(e); }
          setChannelSettings(s => ({ ...s, saving: false }));
          await refreshConversations();
        };

        const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          if (!file || !user) return;
          const formData = new FormData();
          formData.append('file', file, file.name);
          formData.append('path', `conv_avatars/${activeConvId}_${Date.now()}.webp`);
          formData.append('bucket', 'media');
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const data = await res.json();
          if (data.url) {
            await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'update_conversation', userId: user.id, conversationId: activeConvId, avatarUrl: data.url }) });
            await refreshConversations();
          }
          e.target.value = '';
        };

        const toggleAdminRole = async (targetId: string, currentRole: string) => {
          if (!user) return;
          const newRole = currentRole === 'admin' ? 'member' : 'admin';
          await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_member_role', userId: user.id, conversationId: activeConvId, targetUserId: targetId, newRole }) });
        };

        const removeMember = async (targetId: string) => {
          if (!user) return;
          await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove_member', userId: user.id, conversationId: activeConvId, targetUserId: targetId }) });
        };

        const mediaCount = messages.filter(m => m.media_url && (m.type === 'image' || m.type === 'video')).length;
        const fileCount = messages.filter(m => m.media_url && m.type === 'file').length;
        const linkCount = messages.filter(m => m.content && /https?:\/\//.test(m.content)).length;

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250 }}
            onClick={e => { if (e.target === e.currentTarget) setChannelSettings(s => ({ ...s, open: false })); }}>
            <div style={{ width: 400, maxHeight: '85vh', background: 'rgba(10,10,12,0.55)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', animation: 'fadeIn 0.2s ease', boxShadow: '0 32px 80px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }}
              onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                {adminMode ? (
                  <button onClick={() => setAdmin(false)} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    Назад
                  </button>
                ) : (
                  <span style={{ fontSize: 16, fontWeight: 600 }}>Информация</span>
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {isOwner && !adminMode && (
                    <button onClick={() => setAdmin(true)} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: C.sub, cursor: 'pointer', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Настройки">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2m-9-11h2m18 0h2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                    </button>
                  )}
                  <button onClick={() => setChannelSettings(s => ({ ...s, open: false }))} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: C.sub, cursor: 'pointer', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{ic.close}</button>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {adminMode ? (
                  /* ═══ ADMIN MODE ═══ */
                  <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        {conv.avatar_url ? (
                          <img src={conv.avatar_url} alt="" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 80, height: 80, borderRadius: '50%', background: C.hover, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 32, color: C.blue }}>
                            {(conv.name || '?')[0]?.toUpperCase()}
                          </div>
                        )}
                        <label style={{ position: 'absolute', bottom: -2, right: -2, width: 28, height: 28, borderRadius: '50%', background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '3px solid rgba(10,10,12,0.55)' }}>
                          {ic.camera}
                          <input type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
                        </label>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: C.sub, marginBottom: 3, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Название</label>
                      <input value={channelSettings.name} onChange={e => setChannelSettings(s => ({ ...s, name: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: C.text, fontSize: 14, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: C.sub, marginBottom: 3, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Описание</label>
                      <textarea value={channelSettings.desc} onChange={e => setChannelSettings(s => ({ ...s, desc: e.target.value }))}
                        rows={3} style={{ width: '100%', padding: '9px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, color: C.text, fontSize: 14, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                    </div>
                    {/* Username */}
                    <div>
                      <label style={{ fontSize: 11, color: C.sub, marginBottom: 3, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Username</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                        <span style={{ padding: '9px 0 9px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRight: 'none', borderRadius: '10px 0 0 10px', color: C.muted, fontSize: 14 }}>@</span>
                        <input value={(channelSettings as any).username ?? conv.invite_link ?? ''} onChange={e => setChannelSettings(s => ({ ...s, username: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') } as any))}
                          placeholder="username"
                          style={{ flex: 1, padding: '9px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderLeft: 'none', borderRadius: '0 10px 10px 0', color: C.text, fontSize: 14, boxSizing: 'border-box' }} />
                      </div>
                    </div>
                    <button onClick={handleSaveSettings} disabled={channelSettings.saving}
                      style={{ padding: '10px 0', borderRadius: 50, background: '#FFFFFF', color: '#0D0D0D', border: 'none', fontWeight: 600, fontSize: 14, cursor: channelSettings.saving ? 'wait' : 'pointer', opacity: channelSettings.saving ? 0.7 : 1 }}>
                      {channelSettings.saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                    <div>
                      <div style={{ fontSize: 11, color: C.sub, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Участники · {conv.members.length}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {conv.members.map((m: any) => (
                          <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.02)' }}>
                            <Avatar src={m.user?.avatar_url} name={m.user?.display_name || '?'} size={32} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 500 }}>{m.user?.display_name}</div>
                              <div style={{ fontSize: 11, color: m.role === 'owner' ? '#FFD60A' : m.role === 'admin' ? C.blue : C.muted }}>
                                {m.role === 'owner' ? 'Создатель' : m.role === 'admin' ? 'Админ' : 'Участник'}
                              </div>
                            </div>
                            {m.user_id !== user?.id && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={() => toggleAdminRole(m.user_id, m.role)}
                                  style={{ padding: '4px 8px', borderRadius: 6, background: m.role === 'admin' ? 'rgba(235,87,87,0.1)' : 'rgba(77,166,255,0.1)', color: m.role === 'admin' ? '#EB5757' : C.blue, border: 'none', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                                  {m.role === 'admin' ? '✕ Админ' : '★ Админ'}
                                </button>
                                <button onClick={() => removeMember(m.user_id)}
                                  style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(235,87,87,0.1)', color: '#EB5757', border: 'none', fontSize: 11, cursor: 'pointer' }}>✕</button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ═══ INFO VIEW ═══ */
                  <>
                    <div style={{ textAlign: 'center', padding: '24px 20px 16px' }}>
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        {conv.avatar_url ? (
                          <img src={conv.avatar_url} alt="" style={{ width: 100, height: 100, borderRadius: 22, objectFit: 'cover', cursor: 'pointer' }}
                            onClick={() => setViewerOpen({ items: [{ url: conv.avatar_url!, type: 'image', messageId: '' }], index: 0 })} />
                        ) : (
                          <div style={{ width: 100, height: 100, borderRadius: 22, background: C.hover, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 38, color: C.blue }}>
                            {(conv.name || '?')[0]?.toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 14 }}>{conv.name}</div>
                      {conv.description && <div style={{ fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 1.5, padding: '0 12px' }}>{conv.description}</div>}
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{conv.members.length} участников</div>
                    </div>
                    {usernameLink && (
                      <div style={{ padding: '0 20px 16px' }}>
                        <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 12 }}>
                          <div style={{ fontSize: 15, color: C.text }}>{usernameLink}</div>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Ссылка</div>
                        </div>
                      </div>
                    )}
                    <div style={{ padding: '0 20px 16px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      {mediaCount > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: C.sub, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Фото и видео · {mediaCount}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3, borderRadius: 8, overflow: 'hidden' }}>
                            {messages.filter(m => m.media_url && (m.type === 'image' || m.type === 'video')).slice(0, 8).map((m, i) => (
                              <div key={i} style={{ aspectRatio: '1', background: C.hover, overflow: 'hidden', cursor: 'pointer' }}
                                onClick={() => {
                                  const allMedia = messages.filter(mm => mm.media_url && (mm.type === 'image' || mm.type === 'video')).map(mm => ({ url: mm.media_url!, type: mm.type as 'image' | 'video', messageId: mm.id }));
                                  setViewerOpen({ items: allMedia, index: i });
                                }}>
                                {m.type === 'video' ? (
                                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.hover }}>
                                    <span style={{ fontSize: 22 }}>▶️</span>
                                  </div>
                                ) : (
                                  <img src={m.media_url!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {linkCount > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: C.sub, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ссылки · {linkCount}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {messages.filter(m => m.content && /https?:\/\//.test(m.content)).slice(0, 5).map((m, i) => {
                              const urlMatch = m.content?.match(/https?:\/\/[^\s<>\])"']+/);
                              return urlMatch ? (
                                <a key={i} href={urlMatch[0]} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 13, color: C.sub, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {urlMatch[0].replace(/^https?:\/\/(www\.)?/, '').substring(0, 45)}
                                </a>
                              ) : null;
                            })}
                          </div>
                        </div>
                      )}
                      {fileCount > 0 && (
                        <div>
                          <div style={{ fontSize: 11, color: C.sub, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Файлы · {fileCount}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {messages.filter(m => m.media_url && m.type === 'file').slice(0, 5).map((m, i) => (
                              <a key={i} href={m.media_url!} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 13, color: C.text, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>📄</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(m.media_metadata as any)?.name || 'Файл'}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}


      {mediaPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }} onClick={e => { if (e.target === e.currentTarget) { URL.revokeObjectURL(mediaPreview.url); setMediaPreview(null); setMediaCaption(''); } }}>
          <div style={{ width: 460, background: 'rgba(10,10,12,0.55)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Отправить {mediaPreview.type === 'image' ? 'фото' : 'видео'}</span>
              <button onClick={() => { URL.revokeObjectURL(mediaPreview.url); setMediaPreview(null); setMediaCaption(''); }} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer' }}>{ic.close}</button>
            </div>
            <div style={{ padding: 20, textAlign: 'center' }}>
              {mediaPreview.type === 'image' ? (
                <img src={mediaPreview.url} alt="" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 12, objectFit: 'contain' }} />
              ) : (
                <video src={mediaPreview.url} controls style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 12 }} />
              )}
              <input placeholder="Добавить подпись..." value={mediaCaption} onChange={e => setMediaCaption(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSendMediaPreview(); }}
                style={{ width: '100%', marginTop: 12, padding: '12px 16px', borderRadius: 12, background: C.hover, border: 'none', color: C.text, fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Pill onClick={() => { URL.revokeObjectURL(mediaPreview.url); setMediaPreview(null); setMediaCaption(''); }}>Отмена</Pill>
              <Pill primary onClick={handleSendMediaPreview}>Отправить</Pill>
            </div>
          </div>
        </div>
      )}
      {/* Media Viewer Overlay */}
      {viewerOpen && (
        <MediaViewer items={viewerOpen.items} initialIndex={viewerOpen.index} onClose={() => setViewerOpen(null)} />
      )}
      {/* Profile Popup */}
      {profilePopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 250 }} onClick={e => { if (e.target === e.currentTarget) setProfilePopup(null); }}>
          <div style={{ width: 380, background: 'rgba(10,10,12,0.55)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderRadius: 24, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', animation: 'fadeIn 0.2s ease', boxShadow: '0 32px 80px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            {/* Close */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' }}>
              <button onClick={() => setProfilePopup(null)} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: C.sub, cursor: 'pointer', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ic.close}</button>
            </div>
            {/* Avatar with emoji aura */}
            <div style={{ textAlign: 'center', padding: '8px 24px 20px' }}>
              <div style={{ position: 'relative', display: 'inline-block', marginBottom: 16 }}>
                {/* Emoji aura ring */}
                <div style={{ position: 'absolute', inset: -16, borderRadius: '50%', background: `radial-gradient(circle, ${profilePopup.color || 'rgba(77,166,255,0.15)'} 0%, transparent 70%)`, opacity: 0.6, animation: 'pulse 3s ease-in-out infinite' }} />
                {profilePopup.emoji && (
                  <>
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
                      <div key={i} style={{ position: 'absolute', fontSize: 16, left: '50%', top: '50%', transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-52px)`, opacity: 0.5 + (i % 2) * 0.3 }}>
                        {profilePopup.emoji}
                      </div>
                    ))}
                  </>
                )}
                <div style={{ cursor: profilePopup.avatar ? 'pointer' : 'default' }}
                  onClick={() => { if (profilePopup.avatar) setViewerOpen({ items: [{ url: profilePopup.avatar, type: 'image', messageId: '' }], index: 0 }); }}>
                  <Avatar src={profilePopup.avatar} name={profilePopup.name} size={80} color={profilePopup.color || undefined} />
                </div>
                {/* Online indicator */}
                {profilePopup.isOnline && (
                  <div style={{ position: 'absolute', bottom: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: C.online, border: `3px solid ${C.surface}` }} />
                )}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{profilePopup.name}</div>
              {profilePopup.username && (
                <div style={{ fontSize: 14, color: C.blue, marginTop: 4, fontWeight: 500 }}>@{profilePopup.username}</div>
              )}
              <div style={{ fontSize: 13, color: profilePopup.isOnline ? C.online : C.muted, marginTop: 4 }}>
                {profilePopup.isOnline ? 'в сети' : 'не в сети'}
              </div>
              {profilePopup.bio && (
                <div style={{ fontSize: 14, color: C.sub, marginTop: 12, lineHeight: 1.5, padding: '0 12px' }}>{profilePopup.bio}</div>
              )}
            </div>
            {/* Actions */}
            <div style={{ padding: '0 24px 24px', display: 'flex', gap: 10 }}>
              <button onClick={() => {
                const existing = conversations.find(c => c.type === 'direct' && c.otherUser?.id === profilePopup.id);
                if (existing) { setActiveConvPersist(existing.id); setProfilePopup(null); }
                else { createDM(profilePopup.id).then(id => { if (id) { setActiveConvPersist(id); setProfilePopup(null); } }); }
              }} style={{ flex: 1, padding: '14px 0', borderRadius: 50, background: '#FFFFFF', color: '#0D0D0D', border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', transition: 'all 0.15s' }}>
                Написать сообщение
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; outline: none; }
        body { margin: 0; background: ${C.bg}; overflow: hidden; }
        input:focus { outline: none; }
        input::placeholder { color: #4A4A54; }
        textarea::placeholder { color: #4A4A54; }
        textarea:focus { outline: none; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #222228; border-radius: 3px; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

/* ═══════ SHARED ═══════ */
const inputStyle: React.CSSProperties = { width: '100%', padding: '14px 16px', borderRadius: 12, background: '#141416', border: 'none', color: '#E8E8E8', fontSize: 15, boxSizing: 'border-box' };
const labelStyle: React.CSSProperties = { fontSize: 13, color: '#8E8E96', fontWeight: 500, marginBottom: 6, display: 'block' };

function NavBtn({ icon, active, onClick }: { icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: active ? '#222228' : 'transparent', color: active ? '#E8E8E8' : '#55555E',
      border: 'none', cursor: 'pointer', transition: 'all 0.15s',
    }}>{icon}</button>
  );
}

function Pill({ children, onClick, primary, danger, disabled, fullWidth }: {
  children: React.ReactNode; onClick?: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; fullWidth?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: fullWidth ? undefined : 1, width: fullWidth ? '100%' : undefined,
      padding: '14px 0', borderRadius: 50, fontSize: 14, fontWeight: 600,
      background: disabled ? '#222228' : danger ? 'rgba(235,87,87,0.1)' : primary ? '#E8E8E8' : '#222228',
      color: disabled ? '#55555E' : danger ? '#EB5757' : primary ? '#0D0D0D' : '#E8E8E8',
      border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
    }}>{children}</button>
  );
}

function SInput({ label, value, onChange, prefix }: { label: string; value: string; onChange: (v: string) => void; prefix?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        {prefix && <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#55555E', fontSize: 14 }}>{prefix}</span>}
        <input value={value} onChange={e => onChange(e.target.value)}
          style={{ width: '100%', padding: prefix ? '12px 14px 12px 30px' : '12px 14px', background: '#222228', border: 'none', borderRadius: 10, color: '#E8E8E8', fontSize: 14, boxSizing: 'border-box' }} />
      </div>
    </div>
  );
}
