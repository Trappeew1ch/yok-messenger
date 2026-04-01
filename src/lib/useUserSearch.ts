'use client';

import { useState, useCallback } from 'react';
import { type Database } from './supabase';

type UserProfile = Database['public']['Tables']['users']['Row'];

export function useUserSearch() {
  const [results, setResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (query: string) => {
    let q = query.trim().replace(/^@/, '');
    if (!q || q.length < 1) { setResults([]); return; }

    setSearching(true);
    try {
      const res = await fetch(`/api/chat?action=search_users&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error('[YOK] search error:', err);
      setResults([]);
    }
    setSearching(false);
  }, []);

  const clear = useCallback(() => { setResults([]); }, []);

  return { results, searching, search, clear };
}
