import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Server-side PBKDF2 hash for seed phrase verification.
 * Must match the client-side implementation in seedPhrase.ts.
 */
async function serverHashSeedPhrase(phrase: string[], userId: string): Promise<string> {
  const { subtle } = globalThis.crypto;
  const normalized = phrase.map(w => w.toLowerCase().trim()).join(' ');
  const encoder = new TextEncoder();
  const salt = encoder.encode(`yok_recovery_${userId}`);
  const keyMaterial = encoder.encode(normalized);

  const key = await subtle.importKey('raw', keyMaterial, 'PBKDF2', false, ['deriveBits']);
  const derivedBits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
}

/**
 * Find user by email or username in public.users table.
 */
async function findUser(supabase: ReturnType<typeof getServiceClient>, identifier: string) {
  const isEmail = identifier.includes('@');
  const { data, error } = await supabase
    .from('users')
    .select('id, email, recovery_phrase_hash, display_name, username')
    .eq(isEmail ? 'email' : 'username', identifier.toLowerCase())
    .single();
  return { data, error };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (!supabaseServiceKey) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    const supabase = getServiceClient();

    switch (action) {

      // ── Save recovery phrase hash ──
      // Supports two modes:
      //   1. Authenticated (Bearer token) - for logged-in users
      //   2. By userId - for fresh registrations (before email confirmation)
      //      Only works if user has NO hash yet (prevents overwriting)
      case 'save_hash': {
        const { hash, userId: bodyUserId } = body;
        if (!hash || typeof hash !== 'string') {
          return NextResponse.json({ error: 'Hash is required' }, { status: 400 });
        }

        let targetUserId: string | null = null;

        // Try auth token first
        const authHeader = req.headers.get('authorization');
        if (authHeader && authHeader !== 'Bearer undefined' && authHeader !== 'Bearer null') {
          const { data: { user }, error: authError } = await supabase.auth.getUser(
            authHeader.replace('Bearer ', '')
          );
          if (!authError && user) {
            targetUserId = user.id;
          }
        }

        // Fallback: use provided userId (only if no hash exists yet — security)
        if (!targetUserId && bodyUserId) {
          const { data: existing } = await supabase
            .from('users')
            .select('id, recovery_phrase_hash')
            .eq('id', bodyUserId)
            .single();

          if (existing && !existing.recovery_phrase_hash) {
            targetUserId = existing.id;
          } else if (existing?.recovery_phrase_hash) {
            return NextResponse.json({ error: 'Hash already set' }, { status: 403 });
          }
        }

        if (!targetUserId) {
          return NextResponse.json({ error: 'Unable to identify user' }, { status: 401 });
        }

        const { error: updateError } = await supabase
          .from('users')
          .update({ recovery_phrase_hash: hash })
          .eq('id', targetUserId);

        if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
        return NextResponse.json({ success: true });
      }

      // ── Verify seed phrase and reset password ──
      case 'verify_and_reset': {
        const { identifier, seedPhrase, newPassword } = body;
        if (!identifier || !seedPhrase || !newPassword) {
          return NextResponse.json({ error: 'All fields required' }, { status: 400 });
        }
        if (newPassword.length < 6) {
          return NextResponse.json({ error: 'Password too short' }, { status: 400 });
        }

        const { data: userData, error: findErr } = await findUser(supabase, identifier);
        if (findErr || !userData) {
          return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
        }
        if (!userData.recovery_phrase_hash) {
          return NextResponse.json({ error: 'Seed-фраза не настроена' }, { status: 400 });
        }

        // Server-side verification
        try {
          const words = Array.isArray(seedPhrase) ? seedPhrase : seedPhrase.split(' ');
          const computedHash = await serverHashSeedPhrase(words, userData.id);
          if (computedHash !== userData.recovery_phrase_hash) {
            return NextResponse.json({ error: 'Неверная фраза восстановления' }, { status: 403 });
          }
        } catch {
          // Edge runtime crypto fallback — let client do it
          return NextResponse.json({ needsClientVerification: true, userId: userData.id });
        }

        // Reset password
        const { error: resetError } = await supabase.auth.admin.updateUserById(
          userData.id, { password: newPassword }
        );
        if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 });
        return NextResponse.json({ success: true });
      }

      // ── Client-side hash verification fallback ──
      case 'verify_hash': {
        const { identifier, computedHash, newPassword } = body;
        if (!identifier || !computedHash || !newPassword) {
          return NextResponse.json({ error: 'All fields required' }, { status: 400 });
        }

        const { data: userData, error: findErr } = await findUser(supabase, identifier);
        if (findErr || !userData || !userData.recovery_phrase_hash) {
          return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
        }

        if (computedHash !== userData.recovery_phrase_hash) {
          return NextResponse.json({ error: 'Неверная фраза восстановления' }, { status: 403 });
        }

        const { error: resetError } = await supabase.auth.admin.updateUserById(
          userData.id, { password: newPassword }
        );
        if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 });
        return NextResponse.json({ success: true });
      }

      // ── Check if account is legacy (no seed phrase) ──
      case 'check_legacy': {
        const { identifier } = body;
        if (!identifier) return NextResponse.json({ error: 'Identifier required' }, { status: 400 });

        const { data: userData, error: findErr } = await findUser(supabase, identifier);
        if (findErr || !userData) {
          return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
        }

        return NextResponse.json({
          isLegacy: !userData.recovery_phrase_hash,
          hasSeed: !!userData.recovery_phrase_hash,
          userId: userData.id,
        });
      }

      // ── Reset password for legacy account (no seed phrase = direct reset) ──
      case 'reset_legacy': {
        const { identifier, newPassword } = body;
        if (!identifier || !newPassword) {
          return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
        }
        if (newPassword.length < 6) {
          return NextResponse.json({ error: 'Password too short' }, { status: 400 });
        }

        const { data: userData, error: findErr } = await findUser(supabase, identifier);
        if (findErr || !userData) {
          return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
        }

        // Only allow direct reset if NO seed phrase is set (legacy account)
        if (userData.recovery_phrase_hash) {
          return NextResponse.json({
            error: 'У этого аккаунта есть seed-фраза. Используйте восстановление.',
          }, { status: 403 });
        }

        // Direct password reset via admin API
        const { error: resetError } = await supabase.auth.admin.updateUserById(
          userData.id, { password: newPassword }
        );
        if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 });

        return NextResponse.json({ success: true, userId: userData.id });
      }

      // ── Check setup status (authenticated) ──
      case 'check_setup': {
        const authHeader = req.headers.get('authorization');
        if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { data: { user }, error: authError } = await supabase.auth.getUser(
          authHeader.replace('Bearer ', '')
        );
        if (authError || !user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

        const { data } = await supabase
          .from('users')
          .select('recovery_phrase_hash')
          .eq('id', user.id)
          .single();

        return NextResponse.json({ isSetup: !!data?.recovery_phrase_hash });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (err) {
    console.error('[Recovery API Error]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
