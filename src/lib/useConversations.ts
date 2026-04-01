'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase, type Database } from './supabase';

type Conversation = Database['public']['Tables']['conversations']['Row'];
type UserProfile = Database['public']['Tables']['users']['Row'];
type Message = Database['public']['Tables']['messages']['Row'];

export interface ConversationWithDetails extends Conversation {
  members: { user_id: string; role: string; user: UserProfile }[];
  lastMessage: Message | null;
  unreadCount: number;
  otherUser?: UserProfile;
}

export function useConversations(userId: string | undefined) {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    if (!userId) return;

    try {
      const res = await fetch(`/api/chat?action=conversations&userId=${userId}`);
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch (err) {
      console.error('[YOK] fetchConversations error:', err);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Real-time: listen for changes via Supabase Realtime (doesn't need RLS for channels)
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('conversations-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        fetchConversations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, () => {
        fetchConversations();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchConversations]);

  const createDM = useCallback(async (otherUserId: string) => {
    if (!userId) return null;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_dm', userId, otherUserId }),
      });
      const data = await res.json();
      if (data.error) { console.error('[YOK] createDM error:', data.error); return null; }
      await fetchConversations();
      return data.id;
    } catch (err) { console.error('[YOK] createDM:', err); return null; }
  }, [userId, fetchConversations]);

  const createGroup = useCallback(async (name: string, memberIds: string[], description?: string) => {
    if (!userId) return null;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_group', userId, name, memberIds, description }),
      });
      const data = await res.json();
      if (data.error) { console.error('[YOK] createGroup error:', data.error); return null; }
      await fetchConversations();
      return data.id;
    } catch (err) { console.error('[YOK] createGroup:', err); return null; }
  }, [userId, fetchConversations]);

  const createChannel = useCallback(async (name: string, description?: string) => {
    if (!userId) return null;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_channel', userId, name, description }),
      });
      const data = await res.json();
      if (data.error) { console.error('[YOK] createChannel error:', data.error); return null; }
      await fetchConversations();
      return data.id;
    } catch (err) { console.error('[YOK] createChannel:', err); return null; }
  }, [userId, fetchConversations]);

  return { conversations, loading, createDM, createGroup, createChannel, refresh: fetchConversations };
}
