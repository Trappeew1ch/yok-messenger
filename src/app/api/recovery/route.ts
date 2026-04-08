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
 * Find user by email or username.
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

    if (!supabaseServiceKey || supabaseServiceKey === '') {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    const supabase = getServiceClient();

    switch (action) {

      // ── Save hash (authenticated, after registration/magic link) ──
      case 'save_hash': {
        const authHeader = req.headers.get('authorization');
        if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { data: { user }, error: authError } = await supabase.auth.getUser(
          authHeader.replace('Bearer ', '')
        );
        if (authError || !user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

        const { hash } = body;
        if (!hash || typeof hash !== 'string') {
          return NextResponse.json({ error: 'Hash is required' }, { status: 400 });
        }

        const { error: updateError } = await supabase
          .from('users')
          .update({ recovery_phrase_hash: hash })
          .eq('id', user.id);

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
          return NextResponse.json({ error: 'Seed-фраза не настроена для этого аккаунта' }, { status: 400 });
        }

        // Try server-side verification first
        try {
          const words = Array.isArray(seedPhrase) ? seedPhrase : seedPhrase.split(' ');
          const computedHash = await serverHashSeedPhrase(words, userData.id);
          if (computedHash !== userData.recovery_phrase_hash) {
            return NextResponse.json({ error: 'Неверная фраза восстановления' }, { status: 403 });
          }
        } catch {
          // If server-side crypto fails (edge runtime), fall back to client-side verification
          // DON'T send storedHash to client — only send userId for client to compute
          return NextResponse.json({
            needsClientVerification: true,
            userId: userData.id,
          });
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

        if (computedHash !== userData.recovery_phrase_hash) {
          return NextResponse.json({ error: 'Неверная фраза восстановления' }, { status: 403 });
        }

        const { error: resetError } = await supabase.auth.admin.updateUserById(
          userData.id, { password: newPassword }
        );
        if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 });
        return NextResponse.json({ success: true });
      }

      // ── Check if account is legacy (no seed phrase) or has seed ──
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
        });
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
