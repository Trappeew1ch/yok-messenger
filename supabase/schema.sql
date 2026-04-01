-- YOK Messenger Database Schema
-- Run this against your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- USERS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  username TEXT UNIQUE,
  avatar_url TEXT,
  bio TEXT CHECK (char_length(bio) <= 200),
  profile_color TEXT DEFAULT '#7C6BF0',
  profile_emoji TEXT,
  background_emoji TEXT[] DEFAULT '{}',
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  is_online BOOLEAN DEFAULT false,
  public_key TEXT, -- ECDH P-256 public key (JWK) for E2EE key exchange
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Username validation: min 5 chars
ALTER TABLE public.users ADD CONSTRAINT username_min_length
  CHECK (username IS NULL OR char_length(username) >= 5);

-- ==========================================
-- CONVERSATIONS
-- ==========================================
CREATE TYPE conversation_type AS ENUM ('direct', 'group', 'channel');

CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type conversation_type NOT NULL DEFAULT 'direct',
  name TEXT,
  description TEXT,
  avatar_url TEXT,
  username TEXT UNIQUE,
  is_public BOOLEAN DEFAULT false,
  invite_link TEXT UNIQUE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  pinned_message_id UUID
);

ALTER TABLE public.conversations ADD CONSTRAINT conv_username_min_length
  CHECK (username IS NULL OR char_length(username) >= 5);

-- ==========================================
-- CONVERSATION MEMBERS
-- ==========================================
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  muted_until TIMESTAMPTZ,
  last_read_message_id UUID,
  PRIMARY KEY (conversation_id, user_id)
);

-- ==========================================
-- MESSAGES
-- ==========================================
CREATE TYPE message_type AS ENUM ('text', 'image', 'video', 'voice', 'file', 'system');

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type message_type NOT NULL DEFAULT 'text',
  content TEXT,
  formatted_content JSONB,
  media_url TEXT,
  media_thumbnail_url TEXT,
  media_metadata JSONB,
  reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  forwarded_from_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  is_edited BOOLEAN DEFAULT false,
  is_pinned BOOLEAN DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add the FK for pinned_message now that messages table exists
ALTER TABLE public.conversations
  ADD CONSTRAINT fk_pinned_message
  FOREIGN KEY (pinned_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;

-- Indexes for fast queries
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON public.messages(sender_id);

-- ==========================================
-- MESSAGE REACTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- ==========================================
-- BLOCKED USERS
-- ==========================================
CREATE TABLE IF NOT EXISTS public.blocked_users (
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, blocked_user_id)
);

-- ==========================================
-- USER SETTINGS
-- ==========================================
CREATE TYPE visibility_setting AS ENUM ('everyone', 'contacts', 'nobody');
CREATE TYPE theme_setting AS ENUM ('dark', 'light', 'system');
CREATE TYPE font_size_setting AS ENUM ('small', 'medium', 'large');

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  theme theme_setting DEFAULT 'dark',
  language TEXT DEFAULT 'ru',
  notifications_enabled BOOLEAN DEFAULT true,
  notification_sound BOOLEAN DEFAULT true,
  show_last_seen visibility_setting DEFAULT 'everyone',
  show_phone visibility_setting DEFAULT 'contacts',
  show_read_receipts BOOLEAN DEFAULT true,
  font_size font_size_setting DEFAULT 'medium',
  chat_background TEXT,
  send_with_enter BOOLEAN DEFAULT true
);

-- ==========================================
-- ROW LEVEL SECURITY
-- ==========================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- USERS: anyone can read, only self can update
CREATE POLICY "Users are viewable by everyone" ON public.users
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- CONVERSATIONS: members can read
CREATE POLICY "Members can view conversations" ON public.conversations
  FOR SELECT USING (
    id IN (SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid())
    OR is_public = true
  );

CREATE POLICY "Authenticated users can create conversations" ON public.conversations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Owners and admins can update conversations" ON public.conversations
  FOR UPDATE USING (
    id IN (
      SELECT conversation_id FROM public.conversation_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- CONVERSATION MEMBERS
CREATE POLICY "Members can view members" ON public.conversation_members
  FOR SELECT USING (
    conversation_id IN (SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Authenticated users can join conversations" ON public.conversation_members
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Owners/admins can manage members" ON public.conversation_members
  FOR DELETE USING (
    conversation_id IN (
      SELECT conversation_id FROM public.conversation_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
    OR user_id = auth.uid()
  );

CREATE POLICY "Members can update their own membership" ON public.conversation_members
  FOR UPDATE USING (user_id = auth.uid());

-- MESSAGES: members can read and write
CREATE POLICY "Members can view messages" ON public.messages
  FOR SELECT USING (
    conversation_id IN (SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can send messages" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND conversation_id IN (SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Senders can update own messages" ON public.messages
  FOR UPDATE USING (auth.uid() = sender_id);

CREATE POLICY "Senders and admins can delete messages" ON public.messages
  FOR DELETE USING (
    auth.uid() = sender_id
    OR conversation_id IN (
      SELECT conversation_id FROM public.conversation_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- REACTIONS
CREATE POLICY "Members can view reactions" ON public.message_reactions
  FOR SELECT USING (
    message_id IN (
      SELECT id FROM public.messages WHERE conversation_id IN (
        SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can add reactions" ON public.message_reactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove own reactions" ON public.message_reactions
  FOR DELETE USING (auth.uid() = user_id);

-- BLOCKED USERS
CREATE POLICY "Users can view own blocks" ON public.blocked_users
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can block" ON public.blocked_users
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unblock" ON public.blocked_users
  FOR DELETE USING (auth.uid() = user_id);

-- USER SETTINGS
CREATE POLICY "Users can view own settings" ON public.user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own settings" ON public.user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON public.user_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- ==========================================
-- FUNCTIONS
-- ==========================================

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, phone, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.phone,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Generate random invite link
CREATE OR REPLACE FUNCTION public.generate_invite_link()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(16), 'hex');
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- REALTIME
-- ==========================================
-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;

-- ==========================================
-- STORAGE BUCKETS (run these separately via Supabase dashboard or API)
-- ==========================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('media', 'media', false);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('voice', 'voice', false);
