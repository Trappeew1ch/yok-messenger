'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase, type Database } from './supabase';
import type { User, Session } from '@supabase/supabase-js';

type UserProfile = Database['public']['Tables']['users']['Row'];

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null, session: null, profile: null, loading: true,
  signOut: async () => {}, refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch profile via API (bypasses RLS)
  const fetchProfile = useCallback(async (uid: string) => {
    try {
      const res = await fetch(`/api/profile?userId=${uid}`);
      const data = await res.json();
      if (data.profile) setProfile(data.profile);
    } catch (err) {
      console.error('[YOK] fetchProfile error:', err);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user.id).then(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          await fetchProfile(s.user.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // Online status heartbeat via API
  useEffect(() => {
    if (!user) return;

    const updateOnline = (online: boolean) => {
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_profile', userId: user.id, isOnline: online }),
      }).catch(() => {});
    };

    updateOnline(true);
    const interval = setInterval(() => updateOnline(true), 30000);

    const handleBeforeUnload = () => {
      // Use sendBeacon for reliability on tab close
      navigator.sendBeacon?.('/api/chat', JSON.stringify({
        action: 'update_profile', userId: user.id, isOnline: false,
      }));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      updateOnline(false);
    };
  }, [user]);

  const signOut = useCallback(async () => {
    if (user) {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_profile', userId: user.id, isOnline: false }),
      }).catch(() => {});
    }
    await supabase.auth.signOut();
    setProfile(null);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
