import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: buckets } = await supabase.storage.listBuckets();
  console.log('Existing buckets:', buckets?.map(b => b.name));

  if (!buckets?.find(b => b.name === 'media')) {
    const { data, error } = await supabase.storage.createBucket('media', { public: true });
    if (error) console.error('Error:', error);
    else console.log('Created media bucket:', data);
  } else {
    console.log('media bucket already exists');
  }

  const { data: final } = await supabase.storage.listBuckets();
  console.log('Final:', final?.map(b => `${b.name} (public:${b.public})`));
}
main().catch(console.error);
