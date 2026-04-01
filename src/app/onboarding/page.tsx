'use client';

import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [bio, setBio] = useState('');
  const [profileColor, setProfileColor] = useState('#7C6BF0');
  const [profileEmoji, setProfileEmoji] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const checkTimeout = useRef<NodeJS.Timeout | null>(null);

  const COLORS = {
    bg: '#111114', surface: '#1E1E23', surfaceHover: '#252529',
    text: '#E8E8EC', textSecondary: '#8E8E96', textMuted: '#55555E',
    accent: '#7C6BF0', border: '#2A2A30', danger: '#F04747', online: '#3DD68C',
  };

  const COLOR_OPTIONS = [
    '#7C6BF0', '#3B82F6', '#06B6D4', '#10B981',
    '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6',
    '#F97316', '#6366F1', '#14B8A6', '#D946EF',
  ];

  const EMOJI_OPTIONS = ['🚀', '💻', '🎨', '🎮', '📸', '🎵', '⚡', '🔥', '💎', '🌟', '🎯', '🦊'];

  // Check username availability
  useEffect(() => {
    if (username.length < 5) {
      setUsernameAvailable(null);
      return;
    }
    setUsernameChecking(true);
    if (checkTimeout.current) clearTimeout(checkTimeout.current);
    checkTimeout.current = setTimeout(async () => {
      const { data } = await supabase
        .from('users')
        .select('username')
        .eq('username', username)
        .maybeSingle();
      setUsernameAvailable(!data);
      setUsernameChecking(false);
    }, 500);
  }, [username]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleFinish = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Не авторизован');

      let avatarUrl = null;
      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop();
        const path = `${user.id}/avatar.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, { upsert: true });
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        avatarUrl = urlData.publicUrl;
      }

      const { error: updateErr } = await supabase
        .from('users')
        .update({
          display_name: displayName,
          username: username.length >= 5 ? username : null,
          bio: bio || null,
          avatar_url: avatarUrl,
          profile_color: profileColor,
          profile_emoji: profileEmoji || null,
        })
        .eq('id', user.id);

      if (updateErr) throw updateErr;
      router.push('/chat');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    if (step === 1) return displayName.trim().length > 0;
    return true;
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: COLORS.bg, fontFamily: "'Inter', sans-serif", color: COLORS.text,
    }}>
      <div style={{ width: 440, padding: 40, background: COLORS.surface, borderRadius: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Настройка профиля</h1>
          <p style={{ fontSize: 13, color: COLORS.textSecondary }}>Шаг {step} из 5</p>
          {/* Progress bar */}
          <div style={{
            height: 3, background: COLORS.bg, borderRadius: 2, marginTop: 12, overflow: 'hidden',
          }}>
            <div style={{
              width: `${step * 20}%`, height: '100%',
              background: COLORS.accent, borderRadius: 2, transition: 'width 0.3s',
            }} />
          </div>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', marginBottom: 16,
            background: COLORS.danger + '15', color: COLORS.danger,
            borderRadius: 8, fontSize: 13,
          }}>{error}</div>
        )}

        {/* Step 1: Name */}
        {step === 1 && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Как вас зовут?</h3>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Введите имя"
              autoFocus
              style={{
                width: '100%', padding: '12px 16px', background: COLORS.bg,
                color: COLORS.text, border: `1px solid ${COLORS.border}`,
                borderRadius: 10, fontSize: 15, boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* Step 2: Avatar */}
        {step === 2 && (
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Аватарка</h3>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: 120, height: 120, borderRadius: '50%', margin: '0 auto 20px',
                background: avatarPreview ? `url(${avatarPreview}) center/cover` : COLORS.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', border: `3px solid ${COLORS.accent}`,
                fontSize: 40,
              }}
            >
              {!avatarPreview && '📷'}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
            <p style={{ fontSize: 12, color: COLORS.textMuted }}>Нажмите для загрузки (опционально)</p>
          </div>
        )}

        {/* Step 3: Username */}
        {step === 3 && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Юзернейм</h3>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                color: COLORS.textMuted, fontSize: 15,
              }}>@</span>
              <input
                value={username}
                onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
                placeholder="минимум 5 символов"
                style={{
                  width: '100%', padding: '12px 16px 12px 32px', background: COLORS.bg,
                  color: COLORS.text, border: `1px solid ${
                    username.length >= 5
                      ? usernameAvailable ? COLORS.online : COLORS.danger
                      : COLORS.border
                  }`,
                  borderRadius: 10, fontSize: 15, boxSizing: 'border-box', transition: 'border 0.15s',
                }}
              />
            </div>
            {username.length >= 5 && !usernameChecking && (
              <p style={{
                fontSize: 12, marginTop: 6,
                color: usernameAvailable ? COLORS.online : COLORS.danger,
              }}>
                {usernameAvailable ? '✓ Юзернейм свободен' : '✗ Юзернейм занят'}
              </p>
            )}
            {usernameChecking && (
              <p style={{ fontSize: 12, marginTop: 6, color: COLORS.textMuted }}>Проверяем...</p>
            )}
            <p style={{ fontSize: 12, marginTop: 6, color: COLORS.textMuted }}>Опционально. Кириллица, латиница, цифры.</p>
          </div>
        )}

        {/* Step 4: Bio */}
        {step === 4 && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>О себе</h3>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value.slice(0, 200))}
              placeholder="Расскажите о себе..."
              rows={4}
              style={{
                width: '100%', padding: '12px 16px', background: COLORS.bg,
                color: COLORS.text, border: `1px solid ${COLORS.border}`,
                borderRadius: 10, fontSize: 14, resize: 'none', boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: 12, color: COLORS.textMuted, textAlign: 'right' }}>{bio.length}/200</p>
          </div>
        )}

        {/* Step 5: Color & Emoji */}
        {step === 5 && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Цвет и эмодзи</h3>

            <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 10 }}>Цвет профиля</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {COLOR_OPTIONS.map(c => (
                <div key={c} onClick={() => setProfileColor(c)} style={{
                  width: 36, height: 36, borderRadius: '50%', background: c,
                  cursor: 'pointer', border: profileColor === c ? '3px solid #fff' : '3px solid transparent',
                  transition: 'border 0.15s',
                }} />
              ))}
            </div>

            <p style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 10 }}>Эмодзи профиля</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {EMOJI_OPTIONS.map(em => (
                <div key={em} onClick={() => setProfileEmoji(em === profileEmoji ? '' : em)} style={{
                  width: 42, height: 42, borderRadius: 10, fontSize: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: profileEmoji === em ? COLORS.accent + '30' : COLORS.bg,
                  border: profileEmoji === em ? `2px solid ${COLORS.accent}` : '2px solid transparent',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>{em}</div>
              ))}
            </div>

            {/* Preview */}
            <div style={{
              marginTop: 24, padding: 16, background: COLORS.bg, borderRadius: 12,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 50, height: 50, borderRadius: '50%',
                border: `3px solid ${profileColor}`,
                background: avatarPreview ? `url(${avatarPreview}) center/cover` : COLORS.surface,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, position: 'relative',
              }}>
                {!avatarPreview && (displayName?.[0] || '?')}
                {profileEmoji && (
                  <span style={{
                    position: 'absolute', bottom: -4, right: -4,
                    fontSize: 14, background: COLORS.surface, borderRadius: '50%',
                    width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `2px solid ${profileColor}`,
                  }}>{profileEmoji}</span>
                )}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{displayName || 'Ваше имя'}</div>
                <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  {username ? `@${username}` : 'без юзернейма'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              style={{
                flex: 1, padding: '12px 0', background: COLORS.bg,
                color: COLORS.textSecondary, borderRadius: 10, fontSize: 14,
                fontWeight: 600, cursor: 'pointer',
              }}
            >Назад</button>
          )}
          {step < 5 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              style={{
                flex: 1, padding: '12px 0',
                background: canProceed() ? COLORS.accent : COLORS.textMuted,
                color: '#fff', borderRadius: 10, fontSize: 14,
                fontWeight: 600, cursor: canProceed() ? 'pointer' : 'not-allowed',
              }}
            >Далее</button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={loading}
              style={{
                flex: 1, padding: '12px 0',
                background: loading ? COLORS.textMuted : COLORS.accent,
                color: '#fff', borderRadius: 10, fontSize: 14,
                fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
              }}
            >{loading ? 'Сохраняем...' : 'Начать общение'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
