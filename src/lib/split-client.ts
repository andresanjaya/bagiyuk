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
    const messages: Record<string, string> = { CONFIG_MISSING: 'Split Together belum dikonfigurasi.', APP_URL_UNREACHABLE: 'Alamat aplikasi 0.0.0.0 tidak bisa dibagikan. Buka Bagiyuk dari URL publik atau atur NEXT_PUBLIC_APP_URL.', UNAUTHORIZED: 'Sesi kamu habis. Muat ulang halaman.', FORBIDDEN: 'Kamu tidak punya izin untuk tindakan ini.', FORBIDDEN_OR_EXPIRED: 'Sesi tidak tersedia atau sudah kedaluwarsa.', INVITE_EXPIRED: 'Tautan undangan sudah tidak berlaku.', ROOM_EXPIRED: 'Sesi sudah kedaluwarsa.', ROOM_CLOSED: 'Sesi sudah ditutup.', ROOM_NOT_DRAFT: 'Pengaturan item hanya bisa diubah sebelum klaim dibuka.', ROOM_NOT_CLAIMING: 'Klaim belum dibuka atau sudah ditutup.', ROOM_NOT_FINALIZED: 'Tagihan belum difinalisasi.', INCOMPLETE_ALLOCATION: 'Masih ada item yang belum dibagi.', VERSION_CONFLICT: 'Pilihan teman baru berubah. Tinjau ulang sebelum menyelesaikan.', TOTAL_MISMATCH: 'Total akhir tidak cocok dengan tagihan. Periksa pembagian.', CONTRIBUTION_MISMATCH: 'Jumlah bayar di restoran harus sama dengan total tagihan.', CONTRIBUTION_CONFLICT: 'Daftar pembayar berubah. Muat ulang dan simpan kembali.', GROUP_CONFLICT: 'Tagihan ini sudah terhubung ke grup lain.', ROOM_FULL: 'Ruang ini sudah penuh.', CLAIM_CONFLICT: 'Unit terakhir sudah dipilih temanmu. Daftar diperbarui.', ITEM_HAS_CLAIMS: 'Item ini sudah diklaim.', ITEM_NOT_FOUND: 'Item tidak ditemukan.', TRANSFER_NOT_FOUND: 'Transfer tidak ditemukan.', INVALID_INPUT: 'Periksa lagi data yang kamu isi.', RATE_LIMITED: 'Terlalu banyak percobaan. Coba lagi sebentar.' };
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
  const [advance, edges] = await Promise.all([
    client.from('split_upfront_contributions').select('participant_id,amount_idr').eq('session_id', sessionId),
    client.from('split_transfers').select('*').eq('session_id', sessionId).order('created_at'),
  ]);
  if (advance.error || edges.error) throw new Error('Data pembayaran belum bisa dimuat. Periksa migrasi MVP 3 dan koneksi.');
  let summaries: Room['summaries'] = [], settlements: Room['settlements'] = [];
  if (s.data.state === 'finalized') {
    const [final, payments] = await Promise.all([
      client.from('split_finalized_summaries').select('*').eq('session_id', sessionId),
      client.from('split_settlements').select('*').eq('session_id', sessionId),
    ]);
    if (final.error || payments.error || !final.data || !payments.data || final.data.length !== p.data.length || payments.data.length !== p.data.length) throw new Error('Ringkasan pembayaran belum bisa dimuat. Coba lagi saat terhubung.');
    summaries = final.data as Room['summaries']; settlements = payments.data as Room['settlements'];
  }
  return { session: s.data, items: i.data, participants: p.data, claims, summaries, settlements, contributions: advance.data, transfers: edges.data, me: session.user.id } as Room;
}
