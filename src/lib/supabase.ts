import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

// Browser client — uses cookies (synced with middleware/server)
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

// Helper to get current user
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Helper to get session
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          phone: string | null;
          display_name: string;
          username: string | null;
          avatar_url: string | null;
          bio: string | null;
          profile_color: string | null;
          profile_emoji: string | null;
          background_emoji: string[] | null;
          last_seen: string | null;
          is_online: boolean;
          public_key: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'created_at'>;
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };
      conversations: {
        Row: {
          id: string;
          type: 'direct' | 'group' | 'channel';
          name: string | null;
          description: string | null;
          avatar_url: string | null;
          username: string | null;
          is_public: boolean;
          invite_link: string | null;
          created_by: string;
          created_at: string;
          pinned_message_id: string | null;
        };
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          user_id: string;
          role: 'owner' | 'admin' | 'member';
          joined_at: string;
          muted_until: string | null;
          last_read_message_id: string | null;
        };
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          type: 'text' | 'image' | 'video' | 'voice' | 'file' | 'system';
          content: string | null;
          formatted_content: Record<string, unknown> | null;
          media_url: string | null;
          media_thumbnail_url: string | null;
          media_metadata: Record<string, unknown> | null;
          reply_to_id: string | null;
          forwarded_from_id: string | null;
          is_edited: boolean;
          is_pinned: boolean;
          deleted_at: string | null;
          created_at: string;
        };
      };
      message_reactions: {
        Row: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
      };
      blocked_users: {
        Row: {
          user_id: string;
          blocked_user_id: string;
          created_at: string;
        };
      };
      user_settings: {
        Row: {
          user_id: string;
          theme: 'dark' | 'light' | 'system';
          language: string;
          notifications_enabled: boolean;
          notification_sound: boolean;
          show_last_seen: 'everyone' | 'contacts' | 'nobody';
          show_phone: 'everyone' | 'contacts' | 'nobody';
          show_read_receipts: boolean;
          font_size: 'small' | 'medium' | 'large';
          chat_background: string | null;
          send_with_enter: boolean;
        };
      };
    };
  };
};
