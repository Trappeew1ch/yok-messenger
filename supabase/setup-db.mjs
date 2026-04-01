// Run: node supabase/setup-db.mjs
// Execute schema SQL against Supabase using the /pg/query endpoint
import { readFileSync } from 'fs';

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwbWdodXV3bWZ3eGJweWdrbWxpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDQ2MDkyNiwiZXhwIjoyMDkwMDM2OTI2fQ.IqFH9Yg6Tetl0ynUdLWJ5ilFIxk5EyFVf8wn5njl3AU';
const SUPABASE_URL = 'https://rpmghuuwmfwxbpygkmli.supabase.co';

const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Split SQL into separate statements (split on semicolons followed by newline)
const statements = sql
  .split(/;\s*\n/)
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

console.log(`Found ${statements.length} SQL statements to execute.\n`);

// Execute each statement via Supabase's PostgREST RPC or raw SQL
// We'll use a custom RPC function approach
// First, let's create a helper function via the API

async function execSQL(query) {
  // Try the PostgREST /rpc endpoint with a custom function
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ sql_query: query }),
  });
  return res;
}

// First, create the exec_sql function using the service role
async function bootstrap() {
  // Try to create an exec_sql RPC function first
  const createFnSQL = `
    CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE sql_query;
    END;
    $$;
  `;
  
  // We need to do this through a raw SQL endpoint
  // Supabase has a /pg endpoint that accepts SQL queries
  // Try the pg meta endpoint
  const endpoints = [
    `${SUPABASE_URL}/pg/query`,
    `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
  ];
  
  // First try: see if we can use the PostgREST endpoint to execute RPC
  console.log('Checking available endpoints...');
  
  // Try creating the function via the pg/query endpoint
  let pgRes = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: createFnSQL }),
  });
  
  if (pgRes.ok) {
    console.log('✅ pg/query endpoint works! Using it to execute schema.\n');
    
    // Execute the full schema
    const fullRes = await fetch(`${SUPABASE_URL}/pg/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });
    
    if (fullRes.ok) {
      console.log('✅ Schema applied successfully!');
      const result = await fullRes.json().catch(() => null);
      if (result) console.log('Result:', JSON.stringify(result, null, 2));
    } else {
      console.error('❌ Schema execution failed:', fullRes.status);
      const err = await fullRes.text();
      console.error(err);
      
      // Try statement by statement
      console.log('\nTrying statement by statement...');
      let success = 0, failed = 0;
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const r = await fetch(`${SUPABASE_URL}/pg/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: stmt + ';' }),
        });
        if (r.ok) {
          success++;
          process.stdout.write('.');
        } else {
          failed++;
          const errText = await r.text();
          console.log(`\n❌ Statement ${i + 1} failed: ${errText.substring(0, 100)}`);
        }
      }
      console.log(`\n\nDone: ${success} ✅, ${failed} ❌`);
    }
    return;
  }
  
  console.log(`pg/query returned: ${pgRes.status}`);
  const pgErr = await pgRes.text();
  console.log(pgErr.substring(0, 200));
  
  // Alternative: use Supabase Management API
  console.log('\nTrying Supabase Management API...');
  
  const mgmtRes = await fetch('https://api.supabase.com/v1/projects/rpmghuuwmfwxbpygkmli/database/query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  
  console.log(`Management API: ${mgmtRes.status}`);
  const mgmtBody = await mgmtRes.text();
  console.log(mgmtBody.substring(0, 500));
  
  // If nothing works, print instructions
  console.log(`
\n==================================
MANUAL SETUP REQUIRED
==================================
Copy and paste the contents of supabase/schema.sql
into the Supabase SQL Editor at:
https://supabase.com/dashboard/project/rpmghuuwmfwxbpygkmli/sql/new

Then run it manually.
==================================
`);
}

bootstrap().catch(console.error);
