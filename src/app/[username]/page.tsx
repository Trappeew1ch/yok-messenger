'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Dynamic route: йок.space/[username]
 * Resolves a username to either a channel or user profile,
 * then redirects to the chat with join parameter.
 */
export default function UsernamePage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;
  const [status, setStatus] = useState<'loading' | 'not_found'>('loading');

  useEffect(() => {
    if (!username) return;

    async function resolve() {
      // First check: is it a channel/group username?
      const { data: conv } = await supabase
        .from('conversations')
        .select('id, type, name')
        .eq('username', username)
        .single();

      if (conv) {
        router.replace(`/chat?join=${username}`);
        return;
      }

      // Second check: is it a user username?
      const { data: user } = await supabase
        .from('users')
        .select('id, username')
        .eq('username', username)
        .single();

      if (user) {
        router.replace(`/chat?dm=${user.id}`);
        return;
      }

      setStatus('not_found');
    }

    resolve();
  }, [username, router]);

  if (status === 'not_found') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0A0A0C',
        color: '#fff',
        fontFamily: "'Inter', system-ui, sans-serif",
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{ fontSize: 48, opacity: 0.3 }}>404</div>
        <div style={{ fontSize: 18, color: '#8E8E93' }}>
          @{username} не найден
        </div>
        <button
          onClick={() => router.push('/chat')}
          style={{
            marginTop: 16,
            padding: '10px 28px',
            borderRadius: 50,
            background: 'rgba(77,166,255,0.15)',
            color: '#4DA6FF',
            border: '1px solid rgba(77,166,255,0.2)',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Открыть YOK Messenger
        </button>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0A0A0C',
      color: '#fff',
    }}>
      <div style={{ fontSize: 14, color: '#8E8E93' }}>Загрузка...</div>
    </div>
  );
}
