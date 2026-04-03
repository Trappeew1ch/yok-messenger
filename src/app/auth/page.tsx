'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('type=recovery')) {
      // Recovery link from email — switch to reset mode
      supabase.auth.getSession().then(({ data: { session } }) => {
        setMode('reset');
        setChecking(false);
      });
    } else if (hash && hash.includes('access_token')) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          supabase.from('users').select('display_name').eq('id', session.user.id).single()
            .then(({ data: p }) => router.push(p?.display_name ? '/chat' : '/onboarding'));
        } else setChecking(false);
      });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) router.push('/chat');
        else setChecking(false);
      });
    }
  }, [router]);

  const handleAuth = useCallback(async () => {
    if (loading) return;
    if (mode === 'reset') {
      if (!newPassword || newPassword.length < 6) { setError('Пароль должен быть не менее 6 символов'); return; }
      if (newPassword !== confirmPassword) { setError('Пароли не совпадают'); return; }
      setLoading(true); setError('');
      try {
        const { error: e } = await supabase.auth.updateUser({ password: newPassword });
        if (e) throw e;
        alert('Пароль успешно изменён!');
        router.push('/chat');
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }
    if (mode === 'forgot') {
      if (!email) { setError('Введите email'); return; }
      setLoading(true); setError('');
      try {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/auth',
        });
        if (e) throw e;
        setError('');
        setMode('login');
        alert('Письмо для сброса пароля отправлено на ' + email);
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }
    if (!email || !password) { setError('Введите email и пароль'); return; }
    if (mode === 'register' && !displayName.trim()) { setError('Введите имя'); return; }
    setLoading(true);
    setError('');
    try {
      const timeout = setTimeout(() => { throw new Error('timeout'); }, 15000);
      if (mode === 'register') {
        const { error: e } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
        clearTimeout(timeout);
        if (e) throw e;
        router.push('/onboarding');
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password });
        clearTimeout(timeout);
        if (e) throw e;
        router.push('/chat');
      }
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (msg.includes('Invalid login')) setError('Неверный email или пароль');
      else if (msg.includes('timeout')) setError('Превышено время ожидания');
      else setError(msg);
    } finally { setLoading(false); }
  }, [email, password, displayName, newPassword, confirmPassword, mode, loading, router]);

  if (checking) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0D0D0D', color: '#fff', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' }}>YOK</div>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0D0D0D', fontFamily: "'Inter', sans-serif", color: '#E8E8E8',
    }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 20px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <img src="/yokicon.png" alt="YOK" style={{ width: 64, height: 64, objectFit: 'contain' }} />
        </div>

        {/* Title */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>
            {mode === 'login' ? 'Вход' : mode === 'register' ? 'Регистрация' : mode === 'reset' ? 'Новый пароль' : 'Сброс пароля'}
          </h1>
          <p style={{ fontSize: 15, color: '#6B6B76' }}>
            {mode === 'login' ? 'Пожалуйста, введите ваши данные' : mode === 'register' ? 'Создайте новый аккаунт' : mode === 'reset' ? 'Введите новый пароль' : 'Введите email для восстановления'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: '12px 16px', marginBottom: 20, borderRadius: 12,
            background: 'rgba(235, 87, 87, 0.1)', color: '#EB5757', fontSize: 14,
          }}>{error}</div>
        )}

        {/* Form Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {mode === 'register' && (
            <Field label="Имя" value={displayName} onChange={setDisplayName} placeholder="Ваше имя" />
          )}
          {mode === 'reset' ? (
            <>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>Новый пароль</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                  style={{
                    width: '100%', padding: '14px 16px', borderRadius: 12,
                    background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
                    fontSize: 15, boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>Подтвердите пароль</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAuth(); }}
                  placeholder="Повторите пароль"
                  style={{
                    width: '100%', padding: '14px 16px', borderRadius: 12,
                    background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
                    fontSize: 15, boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <Field label="E-Mail" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
          {mode !== 'forgot' && (
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>Пароль</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAuth(); }}
                  placeholder="••••••••••"
                  style={{
                    width: '100%', padding: '14px 50px 14px 16px', borderRadius: 12,
                    background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
                    fontSize: 15, boxSizing: 'border-box',
                  }}
                />
                <button onClick={() => setShowPwd(!showPwd)}
                  style={{
                    position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: '#6B6B76', cursor: 'pointer', fontSize: 18,
                  }}>
                  {showPwd ? '🙈' : '👁'}
                </button>
              </div>
            </div>
          )}
            </>
          )}
        </div>

        {/* Forgot password link */}
        {mode === 'login' && (
          <p style={{ textAlign: 'right', marginTop: 8 }}>
            <span onClick={() => { setMode('forgot'); setError(''); }} style={{ color: '#6B6B76', cursor: 'pointer', fontSize: 13 }}>Забыли пароль?</span>
          </p>
        )}

        {/* Submit Button — Pill shape */}
        <button onClick={handleAuth} disabled={loading}
          style={{
            width: '100%', padding: '16px 0', marginTop: mode === 'login' ? 16 : 32, borderRadius: 50,
            background: loading ? '#2A2A30' : '#E8E8E8', color: loading ? '#6B6B76' : '#0D0D0D',
            fontSize: 16, fontWeight: 600, border: 'none',
            cursor: loading ? 'wait' : 'pointer', transition: 'all 0.2s',
          }}>
          {loading ? 'Подождите...' : mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать аккаунт' : mode === 'reset' ? 'Сменить пароль' : 'Отправить ссылку'}
        </button>

        {/* Toggle */}
        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: '#6B6B76' }}>
          {mode === 'forgot' ? (
            <span onClick={() => { setMode('login'); setError(''); }} style={{ color: '#4DA6FF', cursor: 'pointer', fontWeight: 600 }}>Назад ко входу</span>
          ) : (
            <>
              {mode === 'login' ? 'Еще нет аккаунта? ' : 'Уже есть аккаунт? '}
              <span onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
                style={{ color: '#4DA6FF', cursor: 'pointer', fontWeight: 600 }}>
                {mode === 'login' ? 'Создать аккаунт' : 'Войти'}
              </span>
            </>
          )}
        </p>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; background: #0D0D0D; }
        input:focus { outline: none; border-color: #3A3A44 !important; }
        input::placeholder { color: #4A4A54; }
      `}</style>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', padding: '14px 16px', borderRadius: 12,
          background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
          fontSize: 15, boxSizing: 'border-box',
        }} />
    </div>
  );
}
