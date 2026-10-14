import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient<any> | undefined;
export function browserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Split Together belum dikonfigurasi.');
  return client ??= createClient<any>(url, key);
}
