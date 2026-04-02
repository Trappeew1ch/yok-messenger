import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Content type mapping for reliable detection
const EXT_CONTENT_TYPES: Record<string, string> = {
  webm: 'audio/webm',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
};

// GET: Initialize/fix storage buckets (ensure 'media' is public, no size limit)
export async function GET() {
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const media = buckets?.find(b => b.name === 'media');
    const wantedConfig = { public: true, fileSizeLimit: 524288000 }; // 500MB
    if (!media) {
      await supabaseAdmin.storage.createBucket('media', wantedConfig);
      return NextResponse.json({ status: 'created', public: true, maxSize: '500MB' });
    }
    // Update if not public or size limit is too small
    if (!media.public || (media.file_size_limit && media.file_size_limit < 524288000)) {
      await supabaseAdmin.storage.updateBucket('media', wantedConfig);
      return NextResponse.json({ status: 'updated', public: true, maxSize: '500MB' });
    }
    return NextResponse.json({ status: 'ok', public: media.public });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const path = formData.get('path') as string;
    const bucket = formData.get('bucket') as string;

    if (!file || !path || !bucket) {
      return NextResponse.json({ error: 'file, path, and bucket required' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Determine content type: explicit file.type > extension-based > fallback
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const contentType = (file.type && file.type !== 'application/octet-stream')
      ? file.type
      : EXT_CONTENT_TYPES[ext] || 'application/octet-stream';

    // Ensure bucket exists & is public
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const existing = buckets?.find(b => b.name === bucket);
    if (!existing) {
      await supabaseAdmin.storage.createBucket(bucket, { public: true });
    } else if (!existing.public) {
      // Bucket exists but not public — fix it
      await supabaseAdmin.storage.updateBucket(bucket, { public: true });
    }

    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, buffer, { 
        upsert: true, 
        contentType,
      });

    if (error) {
      console.error('[API/upload] Supabase error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
    // Return clean URL without cache buster (cache busting breaks audio/video MIME detection)
    return NextResponse.json({ url: urlData.publicUrl });
  } catch (err) {
    console.error('[API/upload]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
