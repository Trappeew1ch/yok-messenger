'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, type Database } from './supabase';

type Message = Database['public']['Tables']['messages']['Row'];
type UserProfile = Database['public']['Tables']['users']['Row'];

export type MessageStatus = 'sending' | 'sent' | 'read' | 'error';

export interface MessageWithSender extends Message {
  sender: UserProfile | null;
  replyTo?: Message | null;
  _status?: MessageStatus; // client-side status
  _tempId?: string; // temp ID for optimistic messages
}

const PAGE_SIZE = 50;

export function useMessages(conversationId: string | null, userId: string | undefined) {
  const [messages, setMessages] = useState<MessageWithSender[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const usersCache = useRef<Map<string, UserProfile>>(new Map());

  // Fetch user by ID (cached)
  const getUser = useCallback(async (uid: string): Promise<UserProfile | null> => {
    if (usersCache.current.has(uid)) return usersCache.current.get(uid)!;
    try {
      const res = await fetch(`/api/profile?userId=${uid}`);
      const data = await res.json();
      if (data.profile) { usersCache.current.set(uid, data.profile); return data.profile; }
    } catch {}
    return null;
  }, []);

  // Load messages via API
  const loadMessages = useCallback(async (beforeTimestamp?: string) => {
    if (!conversationId) return;
    setLoading(true);
    try {
      let url = `/api/chat?action=messages&conversationId=${conversationId}&limit=${PAGE_SIZE}`;
      if (beforeTimestamp) url += `&before=${encodeURIComponent(beforeTimestamp)}`;
      const res = await fetch(url);
      const data = await res.json();
      const msgs: MessageWithSender[] = (data.messages || []).map((m: any) => ({
        ...m, _status: 'sent' as MessageStatus,
      }));

      if (msgs.length < PAGE_SIZE) setHasMore(false);

      if (beforeTimestamp) {
        setMessages(prev => {
          const existing = new Set(prev.map(m => m.id));
          const newMsgs = msgs.filter(m => !existing.has(m.id));
          return [...newMsgs, ...prev].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });
      } else {
        setMessages(prev => {
          // Keep optimistic messages that haven't been confirmed yet
          const optimistic = prev.filter(m => m._status === 'sending');
          const serverIds = new Set(msgs.map(m => m.id));
          const remainingOptimistic = optimistic.filter(m => !serverIds.has(m.id) && !serverIds.has(m._tempId || ''));
          return [...msgs, ...remainingOptimistic];
        });
      }
    } catch (err) {
      console.error('[YOK] loadMessages error:', err);
    }
    setLoading(false);
  }, [conversationId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || messages.length === 0) return;
    const realMsgs = messages.filter(m => m._status !== 'sending');
    if (realMsgs.length > 0) await loadMessages(realMsgs[0].created_at);
  }, [hasMore, loading, messages, loadMessages]);

  // Initial load + mark as read
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    setMessages([]);
    setHasMore(true);
    loadMessages();
    if (userId) {
      fetch(`/api/chat?action=mark_read&userId=${userId}&conversationId=${conversationId}`).catch(() => {});
    }
  }, [conversationId, loadMessages, userId]);

  // Real-time messages
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, async (payload) => {
        const msg = payload.new as Message;
        // Skip if it's our own optimistic message
        setMessages(prev => {
          // Replace optimistic message with real one
          const idx = prev.findIndex(m => m._tempId === msg.id || (m._status === 'sending' && m.content === msg.content && m.sender_id === msg.sender_id));
          if (idx >= 0) {
            const updated = [...prev];
            const sender = updated[idx].sender;
            updated[idx] = { ...msg, sender, _status: 'sent' };
            return updated;
          }
          // If not found as optimistic, it's from another user — add it
          if (!prev.find(m => m.id === msg.id)) {
            return [...prev, { ...msg, sender: null, _status: 'sent' }];
          }
          return prev;
        });
        // Fetch sender info for messages from others
        if (msg.sender_id !== userId) {
          const sender = await getUser(msg.sender_id);
          setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, sender } : m));
          // Mark as read
          if (userId) {
            fetch(`/api/chat?action=mark_read&userId=${userId}&conversationId=${conversationId}`).catch(() => {});
          }
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const updated = payload.new as Message;
        if (updated.deleted_at) {
          setMessages(prev => prev.filter(m => m.id !== updated.id));
        } else {
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...updated, sender: m.sender, replyTo: m.replyTo, _status: m._status } : m));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, userId, getUser]);

  // Typing indicator
  useEffect(() => {
    if (!conversationId || !userId) return;
    typingChannel.current = supabase.channel(`typing:${conversationId}`, {
      config: { presence: { key: userId } },
    });
    typingChannel.current
      .on('presence', { event: 'sync' }, () => {
        const state = typingChannel.current?.presenceState() || {};
        setTypingUsers(Object.keys(state).filter(k => k !== userId));
      })
      .subscribe();
    return () => { if (typingChannel.current) supabase.removeChannel(typingChannel.current); };
  }, [conversationId, userId]);

  const sendTyping = useCallback(() => {
    if (typingChannel.current) {
      typingChannel.current.track({ typing: true });
      setTimeout(() => typingChannel.current?.untrack(), 3000);
    }
  }, []);

  // Send message — OPTIMISTIC UPDATE for instant feel
  const sendMessage = useCallback(async (
    content: string,
    type: 'text' | 'image' | 'video' | 'voice' | 'file' = 'text',
    extras?: { reply_to_id?: string; media_url?: string; media_thumbnail_url?: string; media_metadata?: string }
  ) => {
    if (!conversationId || !userId) return null;
    const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substring(2);

    // Get current user profile for display
    const currentUser = usersCache.current.get(userId) || null;

    // 1. Instantly add to UI (optimistic)
    const optimisticMsg: MessageWithSender = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: userId,
      content,
      type,
      formatted_content: null,
      media_url: extras?.media_url || null,
      media_thumbnail_url: extras?.media_thumbnail_url || null,
      media_metadata: extras?.media_metadata ? JSON.parse(extras.media_metadata) : null,
      reply_to_id: extras?.reply_to_id || null,
      forwarded_from_id: null,
      is_edited: false,
      is_pinned: false,
      deleted_at: null,
      created_at: new Date().toISOString(),
      sender: currentUser,
      _status: 'sending',
      _tempId: tempId,
    };

    setMessages(prev => [...prev, optimisticMsg]);
    typingChannel.current?.untrack();

    // 2. Send to server in background
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_message', userId, conversationId, content, type,
          replyToId: extras?.reply_to_id || null,
          mediaUrl: extras?.media_url || null,
          mediaThumbnailUrl: extras?.media_thumbnail_url || null,
          mediaMetadata: extras?.media_metadata || null,
        }),
      });
      const data = await res.json();
      if (data.error) {
        // Mark as error
        setMessages(prev => prev.map(m => m._tempId === tempId ? { ...m, _status: 'error' as MessageStatus } : m));
        console.error('[YOK] sendMessage error:', data.error);
        return null;
      }
      // Replace optimistic with real message
      setMessages(prev => prev.map(m =>
        m._tempId === tempId ? { ...data.message, sender: currentUser, _status: 'sent' as MessageStatus } : m
      ));
      return data.message;
    } catch (err) {
      setMessages(prev => prev.map(m => m._tempId === tempId ? { ...m, _status: 'error' as MessageStatus } : m));
      console.error('[YOK] sendMessage:', err);
      return null;
    }
  }, [conversationId, userId]);

  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    return false; // TODO
  }, []);

  const deleteMessage = useCallback(async (messageId: string) => {
    if (!userId) return false;
    // Optimistically remove from UI
    let removedMsg: MessageWithSender | undefined;
    setMessages(prev => {
      removedMsg = prev.find(m => m.id === messageId);
      return prev.filter(m => m.id !== messageId);
    });
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_message', userId, messageId }),
      });
      const data = await res.json();
      if (data.error) { if (removedMsg) setMessages(prev => [...prev, removedMsg!].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())); return false; }
      return true;
    } catch { if (removedMsg) setMessages(prev => [...prev, removedMsg!].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())); return false; }
  }, [userId]);

  return { messages, loading, hasMore, typingUsers, loadMore, sendMessage, editMessage, deleteMessage, sendTyping };
}
