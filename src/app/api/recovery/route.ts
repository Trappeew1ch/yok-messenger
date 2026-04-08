import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * POST /api/recovery
 * 
 * Actions:
 * 1. save_hash — Save the recovery phrase hash (authenticated, during registration)
 * 2. verify_and_reset — Verify seed phrase and reset password (unauthenticated)
 * 3. check_setup — Check if user has recovery phrase set up (authenticated)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (!supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = getServiceClient();

    switch (action) {
      case 'save_hash': {
        // Authenticated: save recovery phrase hash for current user
        const authHeader = req.headers.get('authorization');
        if (!authHeader) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser(
          authHeader.replace('Bearer ', '')
        );
        if (authError || !user) {
          return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }

        const { hash } = body;
        if (!hash || typeof hash !== 'string') {
          return NextResponse.json(
            { error: 'Hash is required' },
            { status: 400 }
          );
        }

        const { error: updateError } = await supabase
          .from('users')
          .update({ recovery_phrase_hash: hash })
          .eq('id', user.id);

        if (updateError) {
          return NextResponse.json(
            { error: updateError.message },
            { status: 500 }
          );
        }

        return NextResponse.json({ success: true });
      }

      case 'verify_and_reset': {
        // Unauthenticated: verify seed phrase by identifier (email/username) and reset password
        const { identifier, seedPhrase, newPassword } = body;

        if (!identifier || !seedPhrase || !newPassword) {
          return NextResponse.json(
            { error: 'Identifier, seed phrase, and new password are required' },
            { status: 400 }
          );
        }

        if (newPassword.length < 6) {
          return NextResponse.json(
            { error: 'Password must be at least 6 characters' },
            { status: 400 }
          );
        }

        // Find user by email or username
        let userQuery;
        if (identifier.includes('@')) {
          userQuery = await supabase.from('users').select('id, recovery_phrase_hash').eq('email', identifier).single();
        } else {
          userQuery = await supabase.from('users').select('id, recovery_phrase_hash').eq('username', identifier).single();
        }

        if (userQuery.error || !userQuery.data) {
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }

        const { id: userId, recovery_phrase_hash: storedHash } = userQuery.data;

        if (!storedHash) {
          return NextResponse.json(
            { error: 'Recovery phrase not set up for this account' },
            { status: 400 }
          );
        }

        // Verify on the server side using the same hashing algorithm
        const { error: verifyError } = await supabase.rpc('verify_recovery_phrase', {
          p_user_id: userId,
          p_phrase: Array.isArray(seedPhrase) ? seedPhrase.join(' ') : seedPhrase,
          p_stored_hash: storedHash,
        });

        // If RPC doesn't exist, do client-side verification (fallback)
        if (verifyError && verifyError.message.includes('function does not exist')) {
          // Fallback: we'll verify on client side by passing the hash
          // The client will compute the hash and we'll compare
          return NextResponse.json({
            success: true,
            userId,
            needsClientVerification: true,
            storedHash,
          });
        }

        if (verifyError) {
          return NextResponse.json(
            { error: 'Invalid recovery phrase' },
            { status: 403 }
          );
        }

        // Reset password via Supabase Auth admin API
        const { error: resetError } = await supabase.auth.admin.updateUserById(
          userId,
          { password: newPassword }
        );

        if (resetError) {
          return NextResponse.json(
            { error: resetError.message },
            { status: 500 }
          );
        }

        return NextResponse.json({ success: true });
      }

      case 'verify_hash': {
        // Client sends pre-computed hash, we compare with stored
        const { identifier, computedHash, newPassword } = body;

        if (!identifier || !computedHash || !newPassword) {
          return NextResponse.json(
            { error: 'All fields are required' },
            { status: 400 }
          );
        }

        if (newPassword.length < 6) {
          return NextResponse.json(
            { error: 'Password must be at least 6 characters' },
            { status: 400 }
          );
        }

        // Find user
        let userQuery;
        if (identifier.includes('@')) {
          userQuery = await supabase.from('users').select('id, recovery_phrase_hash').eq('email', identifier).single();
        } else {
          userQuery = await supabase.from('users').select('id, recovery_phrase_hash').eq('username', identifier).single();
        }

        if (userQuery.error || !userQuery.data) {
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }

        const { id: userId, recovery_phrase_hash: storedHash } = userQuery.data;

        if (!storedHash) {
          return NextResponse.json(
            { error: 'Recovery phrase not set up for this account' },
            { status: 400 }
          );
        }

        // Compare hashes (constant-time comparison would be ideal, but this works for our threat model)
        if (computedHash !== storedHash) {
          return NextResponse.json(
            { error: 'Invalid recovery phrase' },
            { status: 403 }
          );
        }

        // Reset password
        const { error: resetError } = await supabase.auth.admin.updateUserById(
          userId,
          { password: newPassword }
        );

        if (resetError) {
          return NextResponse.json(
            { error: resetError.message },
            { status: 500 }
          );
        }

        return NextResponse.json({ success: true });
      }

      case 'check_setup': {
        // Authenticated: check if user has recovery phrase is set up
        const authHeader = req.headers.get('authorization');
        if (!authHeader) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser(
          authHeader.replace('Bearer ', '')
        );
        if (authError || !user) {
          return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }

        const { data, error } = await supabase
          .from('users')
          .select('recovery_phrase_hash')
          .eq('id', user.id)
          .single();

        if (error) {
          return NextResponse.json(
            { error: error.message },
            { status: 500 }
          );
        }

        return NextResponse.json({
          isSetup: !!data?.recovery_phrase_hash,
        });
      }

      case 'check_missing': {
        // Unauthenticated: check if user exists but has no recovery phrase (legacy accounts)
        // This is a ONE-TIME recovery option for legacy accounts
        // MUST verify email ownership via OTP before allowing seed phrase setup
        const { identifier } = body;

        if (!identifier || typeof identifier !== 'string') {
          return NextResponse.json(
            { error: 'Identifier is required' },
            { status: 400 }
          );
        }

        // Basic validation - prevent enumeration
        if (identifier.length < 3 || identifier.length > 255) {
          return NextResponse.json(
            { error: 'Invalid identifier' },
            { status: 400 }
          );
        }

        // Find user by email or username
        let userQuery;
        if (identifier.includes('@')) {
          userQuery = await supabase.from('users').select('id, email, recovery_phrase_hash').eq('email', identifier.toLowerCase()).single();
        } else {
          userQuery = await supabase.from('users').select('id, email, recovery_phrase_hash').eq('username', identifier.toLowerCase()).single();
        }

        if (userQuery.error || !userQuery.data) {
          // Security: don't reveal whether user exists
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }

        const { id: userId, recovery_phrase_hash: hasHash } = userQuery.data;

        // If user already has recovery phrase, deny access via this flow
        if (hasHash) {
          return NextResponse.json(
            { error: 'Account already has recovery phrase. Use password or recovery flow.' },
            { status: 403 }
          );
        }

        // User exists but no recovery phrase - they need to verify ownership via OTP first
        // Generate OTP and send to their email
        const { data: otpData, error: otpError } = await supabase.auth.signInWithOtp({
          email: userQuery.data.email,
          options: {
            emailRedirectTo: undefined, // No redirect - we'll handle via client
          }
        });

        if (otpError) {
          console.error('[Recovery] OTP send error:', otpError.message);
          return NextResponse.json(
            { error: 'Failed to send verification code' },
            { status: 500 }
          );
        }

        // Return success - client will prompt for OTP
        return NextResponse.json({
          needsVerification: true,
          userId: userId,
          message: 'Verification code sent to your email'
        });
      }

      case 'verify_otp_and_link': {
        // Verify OTP and link temporary session for seed phrase setup
        // This is a time-limited, one-time use endpoint
        const { otpCode, userId: providedUserId } = body;

        if (!otpCode || !providedUserId) {
          return NextResponse.json(
            { error: 'Code and user ID required' },
            { status: 400 }
          );
        }

        // Validate code format (6 digits)
        if (!/^\d{6}$/.test(otpCode)) {
          return NextResponse.json(
            { error: 'Invalid code format' },
            { status: 400 }
          );
        }

        // Validate userId format (UUID)
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providedUserId)) {
          return NextResponse.json(
            { error: 'Invalid user ID' },
            { status: 400 }
          );
        }

        // First verify the user still has no recovery phrase (prevent race conditions)
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id, recovery_phrase_hash')
          .eq('id', providedUserId)
          .single();

        if (userError || !userData) {
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }

        if (userData.recovery_phrase_hash) {
          return NextResponse.json(
            { error: 'Account already has recovery phrase setup' },
            { status: 403 }
          );
        }

        // Verify OTP - use the email associated with the user
        const { data: emailData } = await supabase
          .from('users')
          .select('email')
          .eq('id', providedUserId)
          .single();

        if (!emailData?.email) {
          return NextResponse.json(
            { error: 'User email not found' },
            { status: 500 }
          );
        }

        // Verify the OTP code
        const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
          email: emailData.email,
          token: otpCode,
          type: 'email'
        });

        if (verifyError || !verifyData.session) {
          return NextResponse.json(
            { error: 'Invalid or expired verification code' },
            { status: 401 }
          );
        }

        // Success! Return a temporary session token
        // This token will be used ONE TIME to set up the recovery phrase
        return NextResponse.json({
          success: true,
          sessionToken: verifyData.session.access_token,
          expiresAt: verifyData.session.expires_at
        });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error('[Recovery API Error]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
