// Run: node supabase/run-schema.mjs
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://rpmghuuwmfwxbpygkmli.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwbWdodXV3bWZ3eGJweWdrbWxpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDQ2MDkyNiwiZXhwIjoyMDkwMDM2OTI2fQ.IqFH9Yg6Tetl0ynUdLWJ5ilFIxk5EyFVf8wn5njl3AU';
const DB_PASSWORD = 'Tt89509540097';

// Split SQL into individual statements and run them via REST
const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// We'll use the Supabase pg endpoint (requires project ref)
const projectRef = 'rpmghuuwmfwxbpygkmli';

// Use the SQL API endpoint
const response = await fetch(`https://${projectRef}.supabase.co/pg`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: sql }),
});

if (!response.ok) {
  console.error('Status:', response.status);
  console.error('Body:', await response.text());
  
  // Fallback: try splitting into statements
  console.log('\nTrying statement-by-statement...');
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  let success = 0, failed = 0;
  for (const stmt of statements) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: stmt + ';' }),
      });
      if (r.ok) success++;
      else failed++;
    } catch (e) {
      failed++;
    }
  }
  console.log(`Done: ${success} success, ${failed} failed`);
} else {
  console.log('Schema applied successfully!');
  console.log(await response.json());
}
