'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { generateSeedPhrase, hashSeedPhrase, normalizeSeedPhrase, validateSeedPhrase } from '@/lib/seedPhrase';

type AuthMode = 'login' | 'register' | 'recovery' | 'seed-setup' | 'seed-verify' | 'magic-sent';

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

  const verifyRef = useRef<HTMLTextAreaElement>(null);

  // ── Check session on load ──
  useEffect(() => {
    const hash = window.location.hash;
    // Magic link or recovery callback
    if (hash && hash.includes('access_token')) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          // Check if user needs seed phrase setup (legacy account)
          supabase.from('users').select('display_name, recovery_phrase_hash')
            .eq('id', session.user.id).single().then(({ data: p }) => {
              if (!p?.recovery_phrase_hash) {
                // Legacy account — needs seed phrase setup
                setRegisteredUserId(session.user.id);
                setMode('seed-setup');
                setChecking(false);
              } else if (!p?.display_name) {
                router.push('/onboarding');
              } else {
                router.push('/chat');
              }
            });
        } else setChecking(false);
      });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          // Check if seed phrase is set up
          supabase.from('users').select('display_name, recovery_phrase_hash')
            .eq('id', session.user.id).single().then(({ data: p }) => {
              if (!p?.recovery_phrase_hash) {
                setRegisteredUserId(session.user.id);
                setMode('seed-setup');
                setChecking(false);
              } else if (!p?.display_name) {
                router.push('/onboarding');
              } else {
                router.push('/chat');
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

    // ── SEED VERIFY: paste 12 words and confirm ──
    if (mode === 'seed-verify') {
      const input = verifyInput.trim().toLowerCase().replace(/\s+/g, ' ');
      const words = input.split(' ');
      if (words.length !== 12) {
        setError(`Введите ровно 12 слов (у вас ${words.length})`);
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
        const res = await fetch('/api/recovery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ action: 'save_hash', hash }),
        });
        const resText = await res.text();
        const data = resText ? JSON.parse(resText) : {};
        if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');

        // Check if user needs onboarding
        const { data: profile } = await supabase.from('users').select('display_name').eq('id', userId).single();
        router.push(profile?.display_name ? '/chat' : '/onboarding');
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }

    // ── RECOVERY: 12 words + new password ──
    if (mode === 'recovery') {
      if (!recoveryIdentifier.trim()) { setError('Введите email или имя пользователя'); return; }
      const words = recoveryInput.trim().toLowerCase().replace(/\s+/g, ' ').split(' ');
      if (words.length !== 12) { setError(`Введите 12 слов (у вас ${words.length})`); return; }
      const invalid = validateSeedPhrase(words);
      if (invalid.length > 0) { setError(`Неверные слова: ${invalid.join(', ')}`); return; }
      if (!newPassword || newPassword.length < 6) { setError('Пароль: минимум 6 символов'); return; }
      if (newPassword !== confirmPassword) { setError('Пароли не совпадают'); return; }

      setLoading(true);
      try {
        // Step 1: ask server for userId
        const res = await fetch('/api/recovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'verify_and_reset',
            identifier: recoveryIdentifier.trim(),
            seedPhrase: words,
            newPassword,
          }),
        });
        const text1 = await res.text();
        const data = text1 ? JSON.parse(text1) : {};

        if (data.needsClientVerification && data.userId) {
          // Server can't hash — do it client-side and send computed hash
          const hash = await hashSeedPhrase(words, data.userId);
          const res2 = await fetch('/api/recovery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'verify_hash',
              identifier: recoveryIdentifier.trim(),
              computedHash: hash,
              newPassword,
            }),
          });
          const text2 = await res2.text();
          const data2 = text2 ? JSON.parse(text2) : {};
          if (!res2.ok) throw new Error(data2.error || 'Неверная фраза');
        } else if (!res.ok) {
          throw new Error(data.error || 'Ошибка восстановления');
        }

        // Success — log in with new password
        const { error: loginErr } = await supabase.auth.signInWithPassword({
          email: recoveryIdentifier.includes('@') ? recoveryIdentifier.trim() : '',
          password: newPassword,
        });
        if (loginErr) {
          setSuccess('Пароль изменён! Войдите с новым паролем.');
          setMode('login');
          setPassword('');
          setEmail(recoveryIdentifier.includes('@') ? recoveryIdentifier.trim() : '');
        } else {
          router.push('/chat');
        }
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }

    // ── MAGIC-SENT: nothing to do, just waiting ──
    if (mode === 'magic-sent') return;

    // ── SEED-SETUP: "I wrote it down" → go to verify ──
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
          setGeneratedPhrase([]); // reset so useEffect generates fresh
          setMode('seed-setup');
        }
      } else {
        // Login attempt
        const { error: e } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (e) {
          // Check if this is a legacy account (no seed phrase, forgot password)
          if (e.message.includes('Invalid login') || e.message.includes('invalid')) {
            try {
              const checkRes = await fetch('/api/recovery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'check_legacy', identifier: email.trim() }),
              });
              const text = await checkRes.text();
              const checkData = text ? JSON.parse(text) : null;
              if (checkRes.ok && checkData?.isLegacy) {
                setError('');
                setSuccess('');
                throw new Error('Неверный пароль. Нажмите «Забыли пароль?» ниже.');
              }
            } catch (checkErr) {
              if ((checkErr as Error).message.includes('Неверный пароль')) throw checkErr;
              // API unavailable — just show generic error
            }
          }
          throw e;
        }

        // Login success — check if seed phrase is set
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
      recoveryIdentifier, recoveryInput, newPassword, confirmPassword, registeredUserId]);

  // ── "Забыли пароль?" handler ──
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Сначала введите email');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Check if account has seed phrase
      let checkData: { isLegacy?: boolean; hasSeed?: boolean } | null = null;
      try {
        const checkRes = await fetch('/api/recovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check_legacy', identifier: email.trim() }),
        });
        const text = await checkRes.text();
        if (checkRes.ok && text) {
          checkData = JSON.parse(text);
        }
      } catch {
        // API unavailable — fall through to fallback
      }

      if (checkData?.isLegacy) {
        // No seed phrase — send magic link for open entry
        const { error: magicErr } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: window.location.origin + '/auth' },
        });
        if (magicErr) throw magicErr;
        setMode('magic-sent');
      } else if (checkData?.hasSeed) {
        // Has seed phrase — go to recovery mode
        setRecoveryIdentifier(email.trim());
        setMode('recovery');
      } else {
        // Fallback: send standard Supabase password reset email
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin + '/auth',
        });
        if (resetErr) throw resetErr;
        setSuccess('Ссылка для сброса отправлена на ' + email.trim());
      }
    } catch (err: unknown) { setError((err as Error).message); }
    setLoading(false);
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(generatedPhrase.join(' '));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Titles ──
  const titles: Record<AuthMode, [string, string]> = {
    login: ['Вход', 'Добро пожаловать'],
    register: ['Регистрация', 'Создайте аккаунт'],
    recovery: ['Восстановление', 'Введите вашу seed-фразу'],
    'seed-setup': ['Фраза восстановления', 'Запишите эти 12 слов и сохраните'],
    'seed-verify': ['Подтверждение', 'Вставьте фразу для проверки'],
    'magic-sent': ['Проверьте почту', 'Мы отправили ссылку для входа'],
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

        {/* ═══════════ SEED SETUP ═══════════ */}
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
                    <span style={{ fontSize: 14, fontWeight: 600, color: S.text, fontFamily: "'JetBrains Mono', monospace" }}>{word}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 16,
              background: 'rgba(255, 193, 7, 0.06)', border: '1px solid rgba(255, 193, 7, 0.12)',
            }}>
              <p style={{ fontSize: 12, color: S.warn, lineHeight: 1.5 }}>
                ⚠ Запишите эти 12 слов. Это единственный способ восстановить аккаунт. Никому не показывайте!
              </p>
            </div>
          </div>
        )}

        {/* ═══════════ SEED VERIFY ═══════════ */}
        {mode === 'seed-verify' && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: S.sub, marginBottom: 12, lineHeight: 1.5 }}>
              Вставьте вашу фразу из 12 слов через пробел, чтобы подтвердить запоминание
            </p>
            <textarea
              ref={verifyRef}
              value={verifyInput}
              onChange={e => setVerifyInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAuth(); } }}
              placeholder="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
              rows={3}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 12,
                background: S.input, border: `1px solid ${S.inputBorder}`, color: S.text,
                fontSize: 14, boxSizing: 'border-box', resize: 'none',
                fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6,
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

        {/* ═══════════ RECOVERY ═══════════ */}
        {mode === 'recovery' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: S.text }}>Email или username</label>
              <input type="text" value={recoveryIdentifier} onChange={e => setRecoveryIdentifier(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 10,
                  background: S.input, border: `1px solid ${S.inputBorder}`, color: S.text,
                  fontSize: 14, boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: S.text }}>12 слов через пробел</label>
              <textarea
                value={recoveryInput}
                onChange={e => setRecoveryInput(e.target.value)}
                placeholder="word1 word2 word3 ..."
                rows={3}
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 10,
                  background: S.input, border: `1px solid ${S.inputBorder}`, color: S.text,
                  fontSize: 14, boxSizing: 'border-box', resize: 'none',
                  fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6,
                }}
              />
              {recoveryInput.trim() && (
                <div style={{ marginTop: 6, fontSize: 12, color: S.sub }}>
                  Слов: {recoveryInput.trim().split(/\s+/).length}/12
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: S.text }}>Новый пароль</label>
                <div style={{ position: 'relative' }}>
                  <input type={showNewPwd ? 'text' : 'password'} value={newPassword}
                    onChange={e => setNewPassword(e.target.value)} placeholder="Минимум 6 символов"
                    style={{
                      width: '100%', padding: '12px 44px 12px 14px', borderRadius: 10,
                      background: S.input, border: `1px solid ${S.inputBorder}`, color: S.text,
                      fontSize: 14, boxSizing: 'border-box',
                    }} />
                  <button onClick={() => setShowNewPwd(!showNewPwd)} style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: S.sub, cursor: 'pointer', fontSize: 15,
                  }}>{showNewPwd ? '🙈' : '👁'}</button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: S.text }}>Подтвердите</label>
                <div style={{ position: 'relative' }}>
                  <input type={showConfirmPwd ? 'text' : 'password'} value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAuth(); }}
                    placeholder="Повторите пароль"
                    style={{
                      width: '100%', padding: '12px 44px 12px 14px', borderRadius: 10,
                      background: S.input, border: `1px solid ${S.inputBorder}`, color: S.text,
                      fontSize: 14, boxSizing: 'border-box',
                    }} />
                  <button onClick={() => setShowConfirmPwd(!showConfirmPwd)} style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: S.sub, cursor: 'pointer', fontSize: 15,
                  }}>{showConfirmPwd ? '🙈' : '👁'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════ MAGIC LINK SENT ═══════════ */}
        {mode === 'magic-sent' && (
          <div style={{
            padding: 20, borderRadius: 14, textAlign: 'center',
            background: S.card, border: `1px solid ${S.cardBorder}`,
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📩</div>
            <p style={{ fontSize: 15, color: S.text, lineHeight: 1.6, marginBottom: 8 }}>
              Ссылка для входа отправлена на<br />
              <strong>{email}</strong>
            </p>
            <p style={{ fontSize: 13, color: S.sub, lineHeight: 1.5 }}>
              Откройте письмо и перейдите по ссылке. После входа вы сможете создать фразу восстановления и новый пароль.
            </p>
          </div>
        )}

        {/* ═══════════ LOGIN / REGISTER FORM ═══════════ */}
        {(mode === 'login' || mode === 'register') && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {mode === 'register' && (
                <Field label="Имя" value={displayName} onChange={setDisplayName} placeholder="Ваше имя" S={S} />
              )}
              <Field label="E-Mail" type="email" value={email} onChange={setEmail} placeholder="you@example.com" S={S} />
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: S.text }}>Пароль</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPwd ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAuth(); }}
                    placeholder="Минимум 6 символов"
                    style={{
                      width: '100%', padding: '12px 44px 12px 14px', borderRadius: 10,
                      background: S.input, border: `1px solid ${S.inputBorder}`, color: S.text,
                      fontSize: 14, boxSizing: 'border-box',
                    }} />
                  <button onClick={() => setShowPwd(!showPwd)} style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: S.sub, cursor: 'pointer', fontSize: 15,
                  }}>{showPwd ? '🙈' : '👁'}</button>
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

        {/* ═══════════ MAIN BUTTON ═══════════ */}
        {mode !== 'magic-sent' && (
          <button onClick={handleAuth} disabled={isDisabled}
            style={{
              width: '100%', padding: '14px 0', marginTop: 20, borderRadius: 50,
              background: isDisabled ? S.btnDisabled : S.btn,
              color: isDisabled ? S.btnDisabledText : S.btnText,
              fontSize: 15, fontWeight: 600, border: 'none',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}>
            {loading ? 'Подождите...' : ({
              login: 'Войти',
              register: 'Создать аккаунт',
              recovery: 'Восстановить доступ',
              'seed-setup': 'Я записал — продолжить',
              'seed-verify': 'Подтвердить',
              'magic-sent': '',
            }[mode])}
          </button>
        )}

        {/* ═══════════ BOTTOM LINKS ═══════════ */}
        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: S.sub }}>
          {mode === 'login' ? (
            <>Нет аккаунта? <Link onClick={() => { setMode('register'); setError(''); setSuccess(''); }}>Создать</Link></>
          ) : mode === 'register' ? (
            <>Уже есть? <Link onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>Войти</Link></>
          ) : mode === 'recovery' ? (
            <Link onClick={() => { setMode('login'); setError(''); }}>Назад ко входу</Link>
          ) : mode === 'seed-setup' ? (
            <span style={{ fontSize: 12, color: S.muted }}>Не закрывайте эту страницу, пока не запишете фразу</span>
          ) : mode === 'seed-verify' ? (
            <Link onClick={() => { setMode('seed-setup'); setError(''); }}>Показать фразу снова</Link>
          ) : mode === 'magic-sent' ? (
            <Link onClick={() => { setMode('login'); setError(''); }}>Назад ко входу</Link>
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

function Link({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <span onClick={onClick} style={{ color: '#4DA6FF', cursor: 'pointer', fontWeight: 600 }}>{children}</span>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', S }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
  S: Record<string, string>;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: S.text }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 10,
          background: S.input, border: `1px solid ${S.inputBorder}`, color: S.text,
          fontSize: 14, boxSizing: 'border-box',
        }} />
    </div>
  );
}
