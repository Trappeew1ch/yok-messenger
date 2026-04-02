import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Service role client — bypasses ALL RLS policies
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// GET: fetch conversations or messages
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  try {
    // ── Fetch conversations for a user ──
    if (action === 'conversations') {
      const userId = searchParams.get('userId');
      if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

      const { data: memberships } = await supabaseAdmin
        .from('conversation_members')
        .select('conversation_id, role, last_read_message_id')
        .eq('user_id', userId);

      if (!memberships || memberships.length === 0) return NextResponse.json({ conversations: [] });

      const convIds = memberships.map(m => m.conversation_id);

      const { data: convos } = await supabaseAdmin
        .from('conversations').select('*').in('id', convIds).order('created_at', { ascending: false });

      if (!convos) return NextResponse.json({ conversations: [] });

      const { data: allMembers } = await supabaseAdmin
        .from('conversation_members').select('conversation_id, user_id, role').in('conversation_id', convIds);

      const userIds = [...new Set(allMembers?.map(m => m.user_id) || [])];
      const { data: users } = await supabaseAdmin.from('users').select('*').in('id', userIds);
      const usersMap = new Map(users?.map(u => [u.id, u]) || []);

      // Last message for each conv
      const lastMessages: Record<string, any> = {};
      for (const cid of convIds) {
        const { data: msgs } = await supabaseAdmin.from('messages').select('*')
          .eq('conversation_id', cid).is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(1);
        if (msgs?.[0]) lastMessages[cid] = msgs[0];
      }

      const enriched = convos.map(conv => {
        const members = (allMembers || [])
          .filter(m => m.conversation_id === conv.id)
          .map(m => ({ user_id: m.user_id, role: m.role, user: usersMap.get(m.user_id) }))
          .filter(m => m.user);
        const otherUser = conv.type === 'direct'
          ? (members.find(m => m.user_id !== userId)?.user || members.find(m => m.user_id === userId)?.user)
          : undefined;
        return { ...conv, members, lastMessage: lastMessages[conv.id] || null, unreadCount: 0, otherUser };
      });

      enriched.sort((a, b) => {
        const aT = a.lastMessage?.created_at || a.created_at;
        const bT = b.lastMessage?.created_at || b.created_at;
        return new Date(bT).getTime() - new Date(aT).getTime();
      });

      return NextResponse.json({ conversations: enriched });
    }

    // ── Fetch messages ──
    if (action === 'messages') {
      const convId = searchParams.get('conversationId');
      const before = searchParams.get('before');
      const limit = parseInt(searchParams.get('limit') || '50');
      if (!convId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 });

      let query = supabaseAdmin.from('messages').select('*')
        .eq('conversation_id', convId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(limit);

      if (before) query = query.lt('created_at', before);
      const { data: msgs } = await query;
      if (!msgs) return NextResponse.json({ messages: [] });

      // Get sender info
      const senderIds = [...new Set(msgs.map(m => m.sender_id))];
      const { data: senders } = await supabaseAdmin.from('users').select('*').in('id', senderIds);
      const sendersMap = new Map(senders?.map(s => [s.id, s]) || []);

      const enriched = msgs.map(m => ({ ...m, sender: sendersMap.get(m.sender_id) || null })).reverse();
      return NextResponse.json({ messages: enriched });
    }

    // ── Search users ──
    if (action === 'search_users') {
      const q = (searchParams.get('q') || '').trim().replace(/^@/, '');
      if (!q) return NextResponse.json({ results: [] });

      const { data } = await supabaseAdmin.from('users').select('*')
        .or(`display_name.ilike.%${q}%,username.ilike.%${q}%`).limit(20);

      return NextResponse.json({ results: data || [] });
    }

    // ── Mark as read ──
    if (action === 'mark_read') {
      const userId = searchParams.get('userId');
      const convId = searchParams.get('conversationId');
      if (!userId || !convId) return NextResponse.json({ error: 'missing params' }, { status: 400 });

      const { data: lastMsg } = await supabaseAdmin.from('messages').select('id')
        .eq('conversation_id', convId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(1);

      if (lastMsg?.[0]) {
        await supabaseAdmin.from('conversation_members')
          .update({ last_read_message_id: lastMsg[0].id })
          .eq('conversation_id', convId).eq('user_id', userId);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[API/chat GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// POST: create conversations, send messages, update profile
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userId } = body;

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    // ── Create DM ──
    if (action === 'create_dm') {
      const { otherUserId } = body;
      if (!otherUserId) return NextResponse.json({ error: 'otherUserId required' }, { status: 400 });

      // Check existing DM
      const isSelf = userId === otherUserId;
      const { data: myMemberships } = await supabaseAdmin
        .from('conversation_members').select('conversation_id').eq('user_id', userId);

      if (myMemberships) {
        for (const m of myMemberships) {
          const { data: conv } = await supabaseAdmin.from('conversations')
            .select('*').eq('id', m.conversation_id).eq('type', 'direct').single();
          if (conv) {
            if (isSelf) {
              // For self-DM: check if this conv has NO member with a different user_id
              const { data: otherMembers } = await supabaseAdmin.from('conversation_members')
                .select('user_id').eq('conversation_id', conv.id).neq('user_id', userId).limit(1);
              if (!otherMembers || otherMembers.length === 0) return NextResponse.json({ id: conv.id });
            } else {
              // For regular DM: check if the other user is a member
              const { data: other } = await supabaseAdmin.from('conversation_members')
                .select('user_id').eq('conversation_id', conv.id).eq('user_id', otherUserId).single();
              if (other) return NextResponse.json({ id: conv.id });
            }
          }
        }
      }

      // Create new conversation
      const { data: newConv, error } = await supabaseAdmin.from('conversations')
        .insert({ type: 'direct', created_by: userId, name: isSelf ? 'Избранное' : null }).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      if (isSelf) {
        // Self-DM: only one member row
        await supabaseAdmin.from('conversation_members').insert([
          { conversation_id: newConv.id, user_id: userId, role: 'owner' },
        ]);
      } else {
        await supabaseAdmin.from('conversation_members').insert([
          { conversation_id: newConv.id, user_id: userId, role: 'member' },
          { conversation_id: newConv.id, user_id: otherUserId, role: 'member' },
        ]);
      }
      return NextResponse.json({ id: newConv.id });
    }

    // ── Create Group ──
    if (action === 'create_group') {
      const { name, memberIds, description } = body;
      if (!name || !memberIds?.length) return NextResponse.json({ error: 'name and memberIds required' }, { status: 400 });

      const { data: newConv, error } = await supabaseAdmin.from('conversations')
        .insert({ type: 'group', name, description: description || null, created_by: userId, invite_link: crypto.randomUUID() })
        .select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await supabaseAdmin.from('conversation_members').insert([
        { conversation_id: newConv.id, user_id: userId, role: 'owner' },
        ...memberIds.map((id: string) => ({ conversation_id: newConv.id, user_id: id, role: 'member' })),
      ]);
      return NextResponse.json({ id: newConv.id });
    }

    // ── Create Channel ──
    if (action === 'create_channel') {
      const { name, description } = body;
      if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

      const { data: newConv, error } = await supabaseAdmin.from('conversations')
        .insert({ type: 'channel', name, description: description || null, created_by: userId, invite_link: crypto.randomUUID() })
        .select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await supabaseAdmin.from('conversation_members').insert({ conversation_id: newConv.id, user_id: userId, role: 'owner' });
      return NextResponse.json({ id: newConv.id });
    }

    // ── Send Message ──
    if (action === 'send_message') {
      const { conversationId, content, type: msgType, replyToId, mediaUrl, mediaThumbnailUrl, mediaMetadata } = body;
      if (!conversationId || (!content && !mediaUrl)) return NextResponse.json({ error: 'content or mediaUrl required' }, { status: 400 });

      const insertData: Record<string, any> = {
        conversation_id: conversationId,
        sender_id: userId,
        content: content || '',
        type: msgType || 'text',
      };
      if (replyToId) insertData.reply_to_id = replyToId;
      if (mediaUrl) insertData.media_url = mediaUrl;
      if (mediaThumbnailUrl) insertData.media_thumbnail_url = mediaThumbnailUrl;
      if (mediaMetadata) insertData.media_metadata = typeof mediaMetadata === 'string' ? JSON.parse(mediaMetadata) : mediaMetadata;

      const { data: msg, error } = await supabaseAdmin.from('messages')
        .insert(insertData).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ message: msg });
    }

    // ── Update Profile ──
    if (action === 'update_profile') {
      const { displayName, username, bio, profileEmoji, avatarUrl, isOnline, publicKey } = body;
      const update: Record<string, any> = {};
      if (displayName !== undefined) update.display_name = displayName;
      if (username !== undefined) update.username = username && username.length >= 5 ? username : null;
      if (bio !== undefined) update.bio = bio || null;
      if (profileEmoji !== undefined) update.profile_emoji = profileEmoji || '👋';
      if (avatarUrl !== undefined) update.avatar_url = avatarUrl;
      if (isOnline !== undefined) {
        update.is_online = isOnline;
        update.last_seen = new Date().toISOString();
      }
      if (publicKey !== undefined) update.public_key = publicKey;

      const { error } = await supabaseAdmin.from('users').update(update).eq('id', userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', userId).single();
      return NextResponse.json({ profile });
    }

    // ── Update Conversation (channel/group settings) ──
    if (action === 'update_conversation') {
      const { conversationId, name, description, avatarUrl, regenerateInvite, inviteLink } = body;
      if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 });

      // Verify user is owner/admin
      const { data: membership } = await supabaseAdmin.from('conversation_members')
        .select('role').eq('conversation_id', conversationId).eq('user_id', userId).single();
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      }

      const update: Record<string, any> = {};
      if (name !== undefined) update.name = name;
      if (description !== undefined) update.description = description || null;
      if (avatarUrl !== undefined) update.avatar_url = avatarUrl;
      if (inviteLink !== undefined) update.invite_link = inviteLink || null;
      if (regenerateInvite) update.invite_link = crypto.randomUUID();

      const { data: conv, error } = await supabaseAdmin.from('conversations')
        .update(update).eq('id', conversationId).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ conversation: conv });
    }

    // ── Update Member Role ──
    if (action === 'update_member_role') {
      const { conversationId, targetUserId, newRole } = body;
      if (!conversationId || !targetUserId || !newRole) return NextResponse.json({ error: 'missing params' }, { status: 400 });

      // Verify user is owner
      const { data: membership } = await supabaseAdmin.from('conversation_members')
        .select('role').eq('conversation_id', conversationId).eq('user_id', userId).single();
      if (!membership || membership.role !== 'owner') {
        return NextResponse.json({ error: 'Only owner can change roles' }, { status: 403 });
      }

      const { error } = await supabaseAdmin.from('conversation_members')
        .update({ role: newRole }).eq('conversation_id', conversationId).eq('user_id', targetUserId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── Add Member to conversation ──
    if (action === 'add_member') {
      const { conversationId, targetUserId } = body;
      if (!conversationId || !targetUserId) return NextResponse.json({ error: 'missing params' }, { status: 400 });

      // Verify user is owner/admin
      const { data: membership } = await supabaseAdmin.from('conversation_members')
        .select('role').eq('conversation_id', conversationId).eq('user_id', userId).single();
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      }

      // Check not already member
      const { data: existing } = await supabaseAdmin.from('conversation_members')
        .select('user_id').eq('conversation_id', conversationId).eq('user_id', targetUserId).single();
      if (existing) return NextResponse.json({ error: 'Already a member' }, { status: 409 });

      const { error } = await supabaseAdmin.from('conversation_members')
        .insert({ conversation_id: conversationId, user_id: targetUserId, role: 'member' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── Remove Member ──
    if (action === 'remove_member') {
      const { conversationId, targetUserId } = body;
      if (!conversationId || !targetUserId) return NextResponse.json({ error: 'missing params' }, { status: 400 });

      const { data: membership } = await supabaseAdmin.from('conversation_members')
        .select('role').eq('conversation_id', conversationId).eq('user_id', userId).single();
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
      }

      const { error } = await supabaseAdmin.from('conversation_members')
        .delete().eq('conversation_id', conversationId).eq('user_id', targetUserId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── Delete Message ──
    if (action === 'delete_message') {
      const { messageId } = body;
      if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });

      const { data: msg } = await supabaseAdmin.from('messages').select('id, sender_id, conversation_id').eq('id', messageId).single();
      if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

      // Allow sender or conversation owner/admin to delete
      if (msg.sender_id !== userId) {
        const { data: membership } = await supabaseAdmin.from('conversation_members')
          .select('role').eq('conversation_id', msg.conversation_id).eq('user_id', userId).single();
        if (!membership || !['owner', 'admin'].includes(membership.role)) {
          return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
        }
      }

      const { error } = await supabaseAdmin.from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', messageId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[API/chat POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
