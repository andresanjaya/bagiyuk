import { browserSupabase } from './supabase';
import type { Room } from './split';

export async function cloudIdentity(create: boolean) {
  const client = browserSupabase();
  const { data } = await client.auth.getSession();
  if (data.session) return data.session;
  if (!create) throw new Error('Identitas browser ini tidak tersedia. Buka lagi tautan undangan untuk bergabung sebagai peserta baru.');
  const signed = await client.auth.signInAnonymously();
  if (signed.error || !signed.data.session) throw new Error('Belum bisa terhubung. Periksa koneksi dan pengaturan Supabase.');
  return signed.data.session;
}
export async function splitApi(path: string, payload: unknown) {
  const session = await cloudIdentity(true);
  const response = await fetch(`/api/split/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) {
    const messages: Record<string, string> = { CONFIG_MISSING: 'Split Together belum dikonfigurasi.', UNAUTHORIZED: 'Sesi kamu habis. Muat ulang halaman.', FORBIDDEN: 'Kamu tidak punya izin untuk tindakan ini.', FORBIDDEN_OR_EXPIRED: 'Sesi tidak tersedia atau sudah kedaluwarsa.', INVITE_EXPIRED: 'Tautan undangan sudah tidak berlaku.', ROOM_EXPIRED: 'Sesi sudah kedaluwarsa.', ROOM_CLOSED: 'Sesi sudah ditutup.', ROOM_NOT_DRAFT: 'Pengaturan item hanya bisa diubah sebelum klaim dibuka.', ROOM_NOT_CLAIMING: 'Klaim belum dibuka atau sudah ditutup.', ROOM_FULL: 'Ruang ini sudah penuh.', CLAIM_CONFLICT: 'Unit terakhir sudah dipilih temanmu. Daftar diperbarui.', ITEM_HAS_CLAIMS: 'Item ini sudah diklaim.', ITEM_NOT_FOUND: 'Item tidak ditemukan.', INVALID_INPUT: 'Periksa lagi data yang kamu isi.', RATE_LIMITED: 'Terlalu banyak percobaan. Coba lagi sebentar.' };
    throw new Error(messages[data.code] ?? 'Perubahan belum tersimpan. Coba lagi.');
  }
  return data;
}
export async function fetchRoom(sessionId: string): Promise<Room> {
  const session = await cloudIdentity(false);
  const client = browserSupabase();
  const [s, i, p, c] = await Promise.all([
    client.from('split_sessions').select('*').eq('id', sessionId).single(),
    client.from('split_session_items').select('*').eq('session_id', sessionId).order('sort_order'),
    client.from('split_participants').select('*').eq('session_id', sessionId).order('joined_at'),
    client.from('split_item_claims').select('*').eq('session_id', sessionId),
  ]);
  const claims = c.data;
  if (s.error || !s.data) throw new Error('Ruang tidak tersedia untuk identitas browser ini. Buka tautan undangan untuk bergabung.');
  if (i.error || p.error || c.error) throw new Error('Belum bisa memuat ruang. Coba lagi saat terhubung.');
  return { session: s.data, items: i.data, participants: p.data, claims, me: session.user.id } as Room;
}
