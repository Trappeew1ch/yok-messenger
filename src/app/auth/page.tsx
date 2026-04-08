'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { generateSeedPhrase, hashSeedPhrase, validateSeedPhrase } from '@/lib/seedPhrase';

type AuthMode = 'login' | 'register' | 'recovery' | 'seed-setup' | 'seed-verify' | 'legacy-reset';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [checking, setChecking] = useState(true);

  // Seed phrase state
  const [generatedPhrase, setGeneratedPhrase] = useState<string[]>([]);
  const [verifyInput, setVerifyInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [registeredUserId, setRegisteredUserId] = useState('');

  // Recovery state
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  // Legacy reset state
  const [legacyUserId, setLegacyUserId] = useState('');

  const verifyRef = useRef<HTMLTextAreaElement>(null);

  // Helper for safe fetch+JSON
  const safeFetch = async (url: string, opts: RequestInit) => {
    const res = await fetch(url, opts);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    return { res, data };
  };

  // ── Check session on load ──
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          supabase.from('users').select('display_name, recovery_phrase_hash')
            .eq('id', session.user.id).single().then(({ data: p }) => {
              if (!p?.recovery_phrase_hash) {
                setRegisteredUserId(session.user.id);
                setMode('seed-setup');
                setChecking(false);
              } else {
                router.push(p?.display_name ? '/chat' : '/onboarding');
              }
            });
        } else setChecking(false);
      });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          supabase.from('users').select('display_name, recovery_phrase_hash')
            .eq('id', session.user.id).single().then(({ data: p }) => {
              if (!p?.recovery_phrase_hash) {
                setRegisteredUserId(session.user.id);
                setMode('seed-setup');
                setChecking(false);
              } else {
                router.push(p?.display_name ? '/chat' : '/onboarding');
              }
            });
        } else setChecking(false);
      });
    }
  }, [router]);

  // Generate seed phrase when entering setup mode
  useEffect(() => {
    if (mode === 'seed-setup' && generatedPhrase.length === 0) {
      setGeneratedPhrase(generateSeedPhrase());
    }
  }, [mode, generatedPhrase.length]);

  const handleAuth = useCallback(async () => {
    if (loading) return;
    setError('');
    setSuccess('');

    // ── SEED VERIFY: paste 12 words ──
    if (mode === 'seed-verify') {
      const input = verifyInput.trim().toLowerCase().replace(/\s+/g, ' ');
      const words = input.split(' ');
      if (words.length !== 12) {
        setError(`Нужно 12 слов (у вас ${words.length})`);
        return;
      }
      const original = generatedPhrase.join(' ').toLowerCase();
      if (input !== original) {
        setError('Фраза не совпадает. Проверьте порядок слов.');
        return;
      }
      setLoading(true);
      try {
        const session = await supabase.auth.getSession();
        const userId = session.data.session?.user?.id || registeredUserId;
        if (!userId) throw new Error('Не удалось определить пользователя');

        const hash = await hashSeedPhrase(generatedPhrase, userId);
        const token = session.data.session?.access_token;
        const { res, data } = await safeFetch('/api/recovery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ action: 'save_hash', hash, userId }),
        });
        if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');

        const { data: profile } = await supabase.from('users').select('display_name').eq('id', userId).single();
        router.push(profile?.display_name ? '/chat' : '/onboarding');
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }

    // ── RECOVERY: 12 words + new password ──
    if (mode === 'recovery') {
      if (!recoveryIdentifier.trim()) { setError('Введите email'); return; }
      const words = recoveryInput.trim().toLowerCase().replace(/\s+/g, ' ').split(' ');
      if (words.length !== 12) { setError(`Нужно 12 слов (у вас ${words.length})`); return; }
      const invalid = validateSeedPhrase(words);
      if (invalid.length > 0) { setError(`Неверные слова: ${invalid.join(', ')}`); return; }
      if (!newPassword || newPassword.length < 6) { setError('Пароль: минимум 6 символов'); return; }
      if (newPassword !== confirmPassword) { setError('Пароли не совпадают'); return; }

      setLoading(true);
      try {
        const { res, data } = await safeFetch('/api/recovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'verify_and_reset',
            identifier: recoveryIdentifier.trim(),
            seedPhrase: words,
            newPassword,
          }),
        });

        if (data.needsClientVerification && data.userId) {
          const hash = await hashSeedPhrase(words, data.userId);
          const { res: res2, data: data2 } = await safeFetch('/api/recovery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'verify_hash',
              identifier: recoveryIdentifier.trim(),
              computedHash: hash,
              newPassword,
            }),
          });
          if (!res2.ok) throw new Error(data2.error || 'Неверная фраза');
        } else if (!res.ok) {
          throw new Error(data.error || 'Ошибка восстановления');
        }

        // Success — try to log in with new password
        const { error: loginErr } = await supabase.auth.signInWithPassword({
          email: recoveryIdentifier.includes('@') ? recoveryIdentifier.trim() : '',
          password: newPassword,
        });
        if (loginErr) {
          setSuccess('Пароль изменён! Войдите с новым паролем.');
          setMode('login');
          setEmail(recoveryIdentifier.includes('@') ? recoveryIdentifier.trim() : '');
          setPassword('');
        } else {
          router.push('/chat');
        }
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }

    // ── LEGACY RESET: direct password reset without verification ──
    if (mode === 'legacy-reset') {
      if (!newPassword || newPassword.length < 6) { setError('Пароль: минимум 6 символов'); return; }
      if (newPassword !== confirmPassword) { setError('Пароли не совпадают'); return; }

      setLoading(true);
      try {
        const { res, data } = await safeFetch('/api/recovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reset_legacy',
            identifier: email.trim(),
            newPassword,
          }),
        });
        if (!res.ok) throw new Error(data.error || 'Ошибка сброса');

        // Log in with new password
        const { error: loginErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: newPassword,
        });
        if (loginErr) throw loginErr;

        // Now set up seed phrase
        setRegisteredUserId(data.userId || legacyUserId);
        setGeneratedPhrase([]);
        setMode('seed-setup');
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }

    // ── SEED-SETUP: continue to verify ──
    if (mode === 'seed-setup') {
      setVerifyInput('');
      setMode('seed-verify');
      return;
    }

    // ── LOGIN / REGISTER ──
    if (!email.trim()) { setError('Введите email'); return; }
    if (!password) { setError('Введите пароль'); return; }
    if (mode === 'register' && !displayName.trim()) { setError('Введите имя'); return; }

    setLoading(true);
    try {
      if (mode === 'register') {
        const { data, error: e } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        });
        if (e) throw e;
        if (data.user) {
          setRegisteredUserId(data.user.id);
          setGeneratedPhrase([]);
          setMode('seed-setup');
        }
      } else {
        // Login
        const { error: e } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (e) throw e;

        // Check seed phrase status
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: profile } = await supabase.from('users')
            .select('recovery_phrase_hash, display_name')
            .eq('id', session.user.id).single();
          if (!profile?.recovery_phrase_hash) {
            setRegisteredUserId(session.user.id);
            setGeneratedPhrase([]);
            setMode('seed-setup');
          } else {
            router.push(profile?.display_name ? '/chat' : '/onboarding');
          }
        }
      }
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (msg.includes('Invalid login')) setError('Неверный email или пароль');
      else setError(msg);
    } finally { setLoading(false); }
  }, [email, password, displayName, mode, loading, router, generatedPhrase, verifyInput,
      recoveryIdentifier, recoveryInput, newPassword, confirmPassword, registeredUserId, legacyUserId]);

  // ── Forgot password handler ──
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Сначала введите email');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { res, data } = await safeFetch('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_legacy', identifier: email.trim() }),
      });

      if (!res.ok) {
        throw new Error(data.error || 'Аккаунт не найден');
      }

      if (data.isLegacy) {
        // No seed phrase — show direct password reset form
        setLegacyUserId(data.userId);
        setNewPassword('');
        setConfirmPassword('');
        setMode('legacy-reset');
      } else {
        // Has seed phrase — go to recovery mode
        setRecoveryIdentifier(email.trim());
        setRecoveryInput('');
        setNewPassword('');
        setConfirmPassword('');
        setMode('recovery');
      }
    } catch (err: unknown) { setError((err as Error).message); }
    setLoading(false);
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(generatedPhrase.join(' '));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Styles ──
  const S = {
    bg: '#0D0D0D',
    card: 'rgba(255,255,255,0.04)',
    cardBorder: 'rgba(255,255,255,0.08)',
    input: '#141416',
    inputBorder: '#2A2A30',
    text: '#E8E8E8',
    sub: '#8B8B96',
    muted: '#5B5B66',
    btn: '#E8E8E8',
    btnText: '#0D0D0D',
    btnDisabled: '#2A2A30',
    btnDisabledText: '#5B5B66',
    link: '#4DA6FF',
    error: '#EB5757',
    warn: '#FFC107',
    success: '#34C759',
  };

  const titles: Record<AuthMode, [string, string]> = {
    login: ['Вход', 'Добро пожаловать'],
    register: ['Регистрация', 'Создайте аккаунт'],
    recovery: ['Восстановление', 'Введите seed-фразу и новый пароль'],
    'seed-setup': ['Фраза восстановления', 'Запишите эти 12 слов и сохраните'],
    'seed-verify': ['Подтверждение', 'Вставьте фразу для проверки'],
    'legacy-reset': ['Сброс пароля', 'Придумайте новый пароль'],
  };

  if (checking) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: S.bg, color: '#fff', fontFamily: "'Inter', sans-serif" }}>
      <img src="/yokicon.png" alt="YOK" style={{ width: 48, height: 48, objectFit: 'contain', animation: 'pulse 1.5s infinite' }} />
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
    </div>
  );

  const isDisabled = loading || (mode === 'seed-verify' && verifyInput.trim().split(/\s+/).length !== 12);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: S.bg, fontFamily: "'Inter', system-ui, sans-serif", color: S.text,
      padding: '20px 0',
    }}>
      <div style={{
        width: '100%',
        maxWidth: ['seed-setup', 'seed-verify', 'recovery'].includes(mode) ? 560 : 420,
        padding: '0 20px',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <img src="/yokicon.png" alt="YOK" style={{ width: 56, height: 56, objectFit: 'contain' }} />
        </div>

        {/* Title */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.3px' }}>{titles[mode][0]}</h1>
          <p style={{ fontSize: 14, color: S.sub }}>{titles[mode][1]}</p>
        </div>

        {/* Messages */}
        {error && (
          <div style={{
            padding: '11px 14px', marginBottom: 16, borderRadius: 10,
            background: 'rgba(235, 87, 87, 0.1)', color: S.error, fontSize: 13, lineHeight: 1.4,
          }}>{error}</div>
        )}
        {success && (
          <div style={{
            padding: '11px 14px', marginBottom: 16, borderRadius: 10,
            background: 'rgba(52, 199, 89, 0.1)', color: S.success, fontSize: 13, lineHeight: 1.4,
          }}>{success}</div>
        )}

        {/* ═══ SEED SETUP ═══ */}
        {mode === 'seed-setup' && (
          <div>
            <div style={{
              padding: 18, borderRadius: 14,
              background: S.card, border: `1px solid ${S.cardBorder}`,
              marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 12, color: S.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Секретная фраза</span>
                <button onClick={copyToClipboard} style={{
                  padding: '5px 12px', borderRadius: 8, border: `1px solid ${S.cardBorder}`,
                  background: copied ? 'rgba(52,199,89,0.15)' : 'transparent',
                  color: copied ? S.success : S.sub, fontSize: 12, cursor: 'pointer', fontWeight: 600,
                }}>
                  {copied ? '✓ Скопировано' : 'Копировать'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {generatedPhrase.map((word, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.03)',
                  }}>
                    <span style={{ fontSize: 11, color: S.muted, fontWeight: 600, minWidth: 20 }}>{i + 1}.</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: S.text, fontFamily: 'monospace' }}>{word}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 16,
              background: 'rgba(255, 193, 7, 0.06)', border: '1px solid rgba(255, 193, 7, 0.12)',
            }}>
              <p style={{ fontSize: 12, color: S.warn, lineHeight: 1.5 }}>
                ⚠ Запишите эти 12 слов. Это единственный способ восстановить аккаунт.
              </p>
            </div>
          </div>
        )}

        {/* ═══ SEED VERIFY ═══ */}
        {mode === 'seed-verify' && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: S.sub, marginBottom: 12, lineHeight: 1.5 }}>
              Вставьте 12 слов через пробел
            </p>
            <textarea
              ref={verifyRef}
              value={verifyInput}
              onChange={e => setVerifyInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAuth(); } }}
              placeholder="word1 word2 word3 ..."
              rows={3}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 12,
                background: S.input, border: `1px solid ${S.inputBorder}`, color: S.text,
                fontSize: 14, boxSizing: 'border-box', resize: 'none',
                fontFamily: 'monospace', lineHeight: 1.6,
              }}
            />
            {verifyInput.trim() && (
              <div style={{ marginTop: 8, fontSize: 12, color: S.sub }}>
                Слов: {verifyInput.trim().split(/\s+/).length}/12
                {verifyInput.trim().split(/\s+/).length === 12 && ' ✓'}
              </div>
            )}
          </div>
        )}

        {/* ═══ RECOVERY (has seed phrase) ═══ */}
        {mode === 'recovery' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle(S)}>Email или username</label>
              <input type="text" value={recoveryIdentifier} onChange={e => setRecoveryIdentifier(e.target.value)}
                placeholder="you@example.com" style={inputStyle(S)} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle(S)}>12 слов через пробел</label>
              <textarea value={recoveryInput} onChange={e => setRecoveryInput(e.target.value)}
                placeholder="word1 word2 word3 ..." rows={3}
                style={{ ...inputStyle(S), resize: 'none' as const, fontFamily: 'monospace', lineHeight: 1.6 }} />
              {recoveryInput.trim() && (
                <div style={{ marginTop: 6, fontSize: 12, color: S.sub }}>
                  Слов: {recoveryInput.trim().split(/\s+/).length}/12
                </div>
              )}
            </div>
            <PasswordFields
              S={S}
              newPassword={newPassword} setNewPassword={setNewPassword}
              confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
              showNewPwd={showNewPwd} setShowNewPwd={setShowNewPwd}
              showConfirmPwd={showConfirmPwd} setShowConfirmPwd={setShowConfirmPwd}
              onEnter={handleAuth}
            />
          </div>
        )}

        {/* ═══ LEGACY RESET (no seed phrase — direct reset) ═══ */}
        {mode === 'legacy-reset' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 16,
              background: 'rgba(52, 199, 89, 0.06)', border: '1px solid rgba(52, 199, 89, 0.12)',
            }}>
              <p style={{ fontSize: 12, color: S.success, lineHeight: 1.5 }}>
                Ваш аккаунт <strong>{email}</strong> найден. Придумайте новый пароль — после этого мы создадим для вас seed-фразу.
              </p>
            </div>
            <PasswordFields
              S={S}
              newPassword={newPassword} setNewPassword={setNewPassword}
              confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
              showNewPwd={showNewPwd} setShowNewPwd={setShowNewPwd}
              showConfirmPwd={showConfirmPwd} setShowConfirmPwd={setShowConfirmPwd}
              onEnter={handleAuth}
            />
          </div>
        )}

        {/* ═══ LOGIN / REGISTER FORM ═══ */}
        {(mode === 'login' || mode === 'register') && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {mode === 'register' && (
                <Field label="Имя" value={displayName} onChange={setDisplayName} placeholder="Ваше имя" S={S} />
              )}
              <Field label="E-Mail" type="email" value={email} onChange={setEmail} placeholder="you@example.com" S={S} />
              <div>
                <label style={labelStyle(S)}>Пароль</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPwd ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAuth(); }}
                    placeholder="Минимум 6 символов"
                    style={{ ...inputStyle(S), paddingRight: 44 }} />
                  <EyeBtn show={showPwd} toggle={() => setShowPwd(!showPwd)} S={S} />
                </div>
              </div>
            </div>
            {mode === 'login' && (
              <p style={{ textAlign: 'right', marginTop: 6 }}>
                <span onClick={handleForgotPassword}
                  style={{ color: S.sub, cursor: 'pointer', fontSize: 12, transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = S.link)}
                  onMouseLeave={e => (e.currentTarget.style.color = S.sub)}
                >Забыли пароль?</span>
              </p>
            )}
          </>
        )}

        {/* ═══ MAIN BUTTON ═══ */}
        <button onClick={handleAuth} disabled={isDisabled}
          style={{
            width: '100%', padding: '14px 0', marginTop: 20, borderRadius: 50,
            background: isDisabled ? S.btnDisabled : S.btn,
            color: isDisabled ? S.btnDisabledText : S.btnText,
            fontSize: 15, fontWeight: 600, border: 'none',
            cursor: isDisabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
          }}>
          {loading ? 'Подождите...' : ({
            login: 'Войти',
            register: 'Создать аккаунт',
            recovery: 'Восстановить доступ',
            'seed-setup': 'Я записал — продолжить',
            'seed-verify': 'Подтвердить',
            'legacy-reset': 'Сменить пароль',
          }[mode])}
        </button>

        {/* ═══ BOTTOM LINKS ═══ */}
        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: S.sub }}>
          {mode === 'login' ? (
            <>Нет аккаунта? <Lnk onClick={() => { setMode('register'); setError(''); setSuccess(''); }}>Создать</Lnk></>
          ) : mode === 'register' ? (
            <>Уже есть? <Lnk onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>Войти</Lnk></>
          ) : mode === 'recovery' || mode === 'legacy-reset' ? (
            <Lnk onClick={() => { setMode('login'); setError(''); }}>Назад ко входу</Lnk>
          ) : mode === 'seed-setup' ? (
            <span style={{ fontSize: 12, color: S.muted }}>Не закрывайте страницу, пока не запишете фразу</span>
          ) : mode === 'seed-verify' ? (
            <Lnk onClick={() => { setMode('seed-setup'); setError(''); }}>Показать фразу снова</Lnk>
          ) : null}
        </p>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; background: ${S.bg}; }
        input:focus, textarea:focus { outline: none; border-color: #3A3A44 !important; }
        input::placeholder, textarea::placeholder { color: #4A4A54; }
      `}</style>
    </div>
  );
}

// ── Shared sub-components ──

function Lnk({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <span onClick={onClick} style={{ color: '#4DA6FF', cursor: 'pointer', fontWeight: 600 }}>{children}</span>;
}

function labelStyle(S: Record<string, string>) {
  return { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: S.text } as const;
}

function inputStyle(S: Record<string, string>) {
  return {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    background: S.input, border: `1px solid ${S.inputBorder}`, color: S.text,
    fontSize: 14, boxSizing: 'border-box' as const,
  };
}

function EyeBtn({ show, toggle, S }: { show: boolean; toggle: () => void; S: Record<string, string> }) {
  return (
    <button onClick={toggle} style={{
      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
      background: 'none', border: 'none', color: S.sub, cursor: 'pointer', fontSize: 15,
    }}>{show ? '🙈' : '👁'}</button>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', S }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
  S: Record<string, string>;
}) {
  return (
    <div>
      <label style={labelStyle(S)}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={inputStyle(S)} />
    </div>
  );
}

function PasswordFields({ S, newPassword, setNewPassword, confirmPassword, setConfirmPassword,
  showNewPwd, setShowNewPwd, showConfirmPwd, setShowConfirmPwd, onEnter }: {
  S: Record<string, string>;
  newPassword: string; setNewPassword: (v: string) => void;
  confirmPassword: string; setConfirmPassword: (v: string) => void;
  showNewPwd: boolean; setShowNewPwd: (v: boolean) => void;
  showConfirmPwd: boolean; setShowConfirmPwd: (v: boolean) => void;
  onEnter: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={labelStyle(S)}>Новый пароль</label>
        <div style={{ position: 'relative' }}>
          <input type={showNewPwd ? 'text' : 'password'} value={newPassword}
            onChange={e => setNewPassword(e.target.value)} placeholder="Минимум 6 символов"
            style={{ ...inputStyle(S), paddingRight: 44 }} />
          <EyeBtn show={showNewPwd} toggle={() => setShowNewPwd(!showNewPwd)} S={S} />
        </div>
      </div>
      <div>
        <label style={labelStyle(S)}>Подтвердите</label>
        <div style={{ position: 'relative' }}>
          <input type={showConfirmPwd ? 'text' : 'password'} value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onEnter(); }}
            placeholder="Повторите пароль"
            style={{ ...inputStyle(S), paddingRight: 44 }} />
          <EyeBtn show={showConfirmPwd} toggle={() => setShowConfirmPwd(!showConfirmPwd)} S={S} />
        </div>
      </div>
    </div>
  );
}
