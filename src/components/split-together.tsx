'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, Check, Copy, LoaderCircle, Share2, Users } from 'lucide-react';
import { Button } from './ui/button';
import { useBills } from '@/lib/store';
import { itemTotal, rupiah, total } from '@/lib/bill';
import { roomAmounts, type Room } from '@/lib/split';
import { browserSupabase } from '@/lib/supabase';
import { cloudIdentity, fetchRoom, splitApi } from '@/lib/split-client';

function Layout({ title, children }: { title: string; children: React.ReactNode }) {
  const path = usePathname();
  const back = path.endsWith('/invite') || path.endsWith('/claim') ? path.replace(/\/(invite|claim)$/, '') : '/';
  return <main className="app-shell split-together"><header className="app-header"><Button variant="outline" size="icon" onClick={() => window.location.assign(back)} aria-label="Kembali"><ArrowLeft size={20} /></Button><h1>{title}</h1><span className="header-spacer" /></header><div className="page-content">{children}</div></main>;
}
function Notice({ message }: { message: string }) { return message ? <p className="error-message" role="alert">{message}</p> : null; }
function Loading() { return <p className="info-message" role="status"><LoaderCircle className="spin" size={17} /> Memuat ruang patungan…</p>; }

export function CreateRoom() {
  const { billId } = useParams<{ billId: string }>();
  const router = useRouter();
  const { history: bills, ready, hydrate } = useBills();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!ready) hydrate(); }, [ready, hydrate]);
  const bill = bills.find(b => b.id === billId);
  useEffect(() => { if (bill) setName(bill.people.find(p => p.id === bill.host)?.name === 'Kamu' ? '' : bill.people.find(p => p.id === bill.host)?.name ?? ''); }, [bill?.id]);
  async function create() {
    if (!bill || busy) return;
    setBusy(true); setError('');
    try { const cloudBill = { ...bill, people: [{ id: bill.host, name: name.trim(), phone: '' }], items: bill.items.map(i => ({ ...i, assigned: [] })) }; const result = await splitApi('sessions', { bill: cloudBill, hostName: name.trim() }); router.push(`/split/${result.sessionId}/invite`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Belum bisa membuat sesi.'); }
    finally { setBusy(false); }
  }
  return <Layout title="Bagi bareng">{!ready ? <Loading /> : !bill ? <Notice message="Tagihan lokal tidak ditemukan di browser ini." /> : <>
    <div className="split-intro"><span className="eyebrow">SPLIT TOGETHER</span><h2>One bill. Everyone picks their share.</h2><p>Buat salinan online dari tagihan ini. Hasil lokalmu tetap tersimpan.</p></div>
    <div className="split-card"><strong>{bill.name}</strong><small>{bill.items.length} jenis item · {bill.items.reduce((n, i) => n + i.quantity, 0)} unit · {rupiah(total(bill))}</small>{bill.items.map(i => <div className="split-line" key={i.id}><span>{i.quantity}× {i.name}</span><strong>{rupiah(itemTotal(i))}</strong></div>)}<div className="split-line"><span>Pajak, layanan, tip, diskon & pembulatan</span><strong>{rupiah(total(bill) - bill.items.reduce((n, i) => n + itemTotal(i), 0))}</strong></div></div>
    <label>Nama kamu<input value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="Nama yang dilihat teman" /></label><small>Ruang dapat diikuti maksimal 12 orang dan berlaku 7 hari. Perlu koneksi internet.</small><Notice message={error} />
    <div className="bottom-action"><Button className="full-width" disabled={busy || !name.trim()} onClick={create}>{busy ? 'Membuat sesi…' : 'Buat sesi'}</Button></div>
  </>}</Layout>;
}

export function JoinRoom() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [preview, setPreview] = useState<{ title: string; state: string; full: boolean; expires_at: string } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch(`/api/split/preview/${token}`, { cache: 'no-store' }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.code === 'CONFIG_MISSING' ? 'Split Together belum dikonfigurasi.' : 'Tautan tidak berlaku atau sudah kedaluwarsa.'); setPreview(data); }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, [token]);
  async function join() {
    setBusy(true); setError('');
    try { const result = await splitApi('join', { token, name: name.trim() }); router.replace(`/split/${result.sessionId}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Belum bisa bergabung.'); }
    finally { setBusy(false); }
  }
  return <Layout title="Gabung patungan">{loading ? <Loading /> : <><div className="split-intro"><span className="eyebrow">BAGIYUK BARENG</span><h2>{preview?.title ?? 'Undangan tidak tersedia'}</h2><p>Pilih pesananmu sendiri bersama teman, tanpa daftar akun.</p></div>{preview && <><div className="split-card"><strong>{preview.full ? 'Ruang sudah penuh untuk peserta baru' : preview.state === 'claiming' ? 'Klaim sedang dibuka' : 'Menunggu host membuka klaim'}</strong><small>Berlaku sampai {new Date(preview.expires_at).toLocaleDateString('id-ID')}</small></div><label>Nama kamu<input value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="Contoh: Nadia" /></label><small>Nama yang sama boleh dipakai. Identitas tersimpan di browser ini; jika data browser dihapus, klaim lama tidak dapat dipulihkan otomatis.</small><div className="bottom-action"><Button className="full-width" disabled={busy || !name.trim()} onClick={join}>{busy ? 'Bergabung…' : 'Gabung patungan'}</Button></div></>}<Notice message={error} /></>}</Layout>;
}

function useRoom(sessionId: string) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(true);
  const refresh = useCallback(async () => { setSyncing(true); try { setRoom(await fetchRoom(sessionId)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Koneksi terputus.'); } finally { setSyncing(false); } }, [sessionId]);
  useEffect(() => {
    void refresh();
    let client: ReturnType<typeof browserSupabase>;
    try { client = browserSupabase(); } catch (e) { setError(e instanceof Error ? e.message : 'Split Together belum dikonfigurasi.'); return; }
    const channel = client.channel(`split-${sessionId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'split_sessions', filter: `id=eq.${sessionId}` }, () => void refresh()).subscribe(status => { if (status === 'SUBSCRIBED') void refresh(); if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setError('Koneksi langsung terputus. Mencoba menyambung lagi…'); });
    const resume = () => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); };
    const offline = () => setError('Kamu sedang offline. Pilihan baru belum dapat disimpan.');
    window.addEventListener('online', resume); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', resume);
    return () => { client.removeChannel(channel); window.removeEventListener('online', resume); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', resume); };
  }, [sessionId, refresh]);
  return { room, error, syncing, refresh, setError };
}

export function SplitRoom() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const pathname = usePathname();
  const view = pathname.endsWith('/invite') ? 'invite' : pathname.endsWith('/claim') ? 'claim' : 'room';
  const { room, error, syncing, refresh, setError } = useRoom(sessionId);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState('');
  const [expiry, setExpiry] = useState('');
  const [qr, setQr] = useState('');
  const isHost = room?.session.host_user_id === room?.me;
  useEffect(() => { if (invite) QRCode.toDataURL(invite, { width: 256, margin: 2 }).then(setQr).catch(() => setError('QR belum bisa dibuat. Salin tautannya.')); }, [invite, setError]);
  async function mutate(action: string, data: unknown) {
    setBusy(true); setError('');
    try { await splitApi(`${sessionId}/${action}`, data); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Perubahan belum tersimpan.'); await refresh(); }
    finally { setBusy(false); }
  }
  async function createInvite() {
    setBusy(true); setError('');
    try { const result = await splitApi(`${sessionId}/invites`, {}); setInvite(result.url); setExpiry(result.expiresAt); }
    catch (e) { setError(e instanceof Error ? e.message : 'Undangan belum bisa dibuat.'); }
    finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(invite); } catch { setError('Gagal menyalin. Pilih dan salin tautan di bawah.'); } }
  function correct(itemId: string, participantId: string, participantName: string, value: number | boolean) {
    if (!window.confirm(`Ubah klaim ${participantName}? Perkiraan semua peserta dapat berubah.`)) return;
    void mutate('host-claim', { itemId, participantId, ...(typeof value === 'number' ? { units: value } : { shared: value }) });
  }
  const title = view === 'invite' ? 'Ajak teman' : view === 'claim' ? 'Pilih pesananmu' : 'Ruang patungan';
  if (!room) return <Layout title={title}>{syncing && <Loading />}<Notice message={error} /><Button variant="outline" onClick={() => void refresh()}>Coba lagi</Button></Layout>;
  const progress = roomAmounts(room);
  const me = room.participants.find(p => p.user_id === room.me);
  const mine = progress.people.find(p => p.user_id === room.me);
  const expired = new Date(room.session.expires_at).getTime() <= Date.now();
  return <Layout title={title}>
    {syncing && <p className="info-message"><LoaderCircle className="spin" size={15} /> Menyelaraskan perubahan…</p>}
    <Notice message={error} />{expired && <Notice message="Sesi sudah kedaluwarsa. Klaim tidak dapat diubah." />}
    {view === 'invite' && <><div className="split-intro"><span className="eyebrow">UNDANG TEMAN</span><h2>Bagikan satu tagihan, pilih bareng.</h2><p>{room.session.title} · {room.participants.length}/{room.session.max_participants} orang · {room.session.state === 'claiming' ? 'Klaim dibuka' : 'Menunggu klaim'}</p></div>
      {isHost ? <><div className="split-card invite-card">{qr ? <img src={qr} alt="Kode QR undangan Bagiyuk" width={220} height={220} /> : <Users size={60} />}<strong>Pindai untuk bergabung</strong><small>Undangan berlaku sampai {new Date(expiry || room.session.expires_at).toLocaleDateString('id-ID')}</small></div>
        {invite ? <><label>Tautan undangan<input readOnly value={invite} onFocus={e => e.currentTarget.select()} /></label><div className="split-actions"><Button variant="outline" onClick={copy}><Copy size={16} /> Salin link</Button><Button variant="outline" onClick={() => navigator.share ? navigator.share({ url: invite }).catch(() => {}) : window.open(`https://wa.me/?text=${encodeURIComponent(invite)}`, '_blank', 'noopener,noreferrer')}><Share2 size={16} /> Bagikan</Button></div><a className="text-link" href={`https://wa.me/?text=${encodeURIComponent(invite)}`} target="_blank" rel="noreferrer">Bagikan via WhatsApp</a><Button variant="ghost" disabled={busy || expired} onClick={createInvite}>Buat tautan baru</Button></> : <Button className="full-width" disabled={busy || expired} onClick={createInvite}>Buat tautan undangan</Button>}
        <small>Tautan baru tidak membatalkan tautan sebelumnya. Simpan tautan ini sebelum menutup halaman.</small></> : <Notice message="Hanya host yang dapat membuat undangan." />}
      <div className="bottom-action"><Button className="full-width" asChild><Link href={`/split/${sessionId}`}>Lihat ruang patungan</Link></Button></div></>}
    {view === 'room' && <><div className="split-intro"><span className="eyebrow">SPLIT TOGETHER</span><h2>{room.session.title}</h2><p>{room.session.state === 'claiming' ? 'Pesanan sedang dipilih' : 'Menunggu host membuka klaim'} · {room.participants.length} orang</p></div>
      <div className="split-card"><strong>{progress.covered} / {progress.assignable} bagian terpilih</strong><progress max={progress.assignable || 1} value={progress.covered} className="split-progress" /><small>{progress.assignable - progress.covered} bagian belum dipilih. Item bersama dihitung terpilih setelah ada peserta.</small></div>
      <h2 className="split-heading">Teman patungan</h2><div className="split-card">{room.participants.map(p => <div className="split-line" key={p.id}><span>{p.display_name} {p.role === 'host' ? '· Host' : ''}<small>{room.claims.filter(c => c.participant_id === p.id).length} item</small></span><strong>~{rupiah(progress.people.find(x => x.id === p.id)?.estimate ?? 0)}</strong></div>)}</div>
      <h2 className="split-heading">Item</h2><div className="split-card">{room.items.map(i => { const claims = room.claims.filter(c => c.item_id === i.id); const covered = i.allocation_mode === 'shared' ? claims.filter(c => c.is_shared_member).length : claims.reduce((n, c) => n + c.claimed_units, 0); return <div key={i.id}><div className="split-line"><span>{i.name}<small>{i.allocation_mode === 'shared' ? `${covered} orang berbagi` : `${covered}/${i.quantity} unit terpilih`}</small></span><strong>{rupiah(i.total_amount)}</strong></div>{isHost && room.session.state === 'claiming' && <details className="host-fix"><summary>Perbaiki pembagian</summary>{room.participants.map(p => { const claimed = claims.find(c => c.participant_id === p.id); const units = claimed?.claimed_units ?? 0; return <div className="split-line" key={p.id}><span>{p.display_name}<small>{i.allocation_mode === 'shared' ? claimed?.is_shared_member ? 'Ikut berbagi' : 'Belum ikut' : `${units} unit`}</small></span>{i.allocation_mode === 'shared' ? <Button size="small" variant="outline" disabled={busy || expired} onClick={() => correct(i.id, p.id, p.display_name, !claimed?.is_shared_member)}>Ubah</Button> : <div className="claim-controls"><Button size="icon" variant="outline" aria-label={`Kurangi klaim ${p.display_name}`} disabled={busy || expired || units === 0} onClick={() => correct(i.id, p.id, p.display_name, units - 1)}>−</Button><Button size="icon" variant="outline" aria-label={`Tambah klaim ${p.display_name}`} disabled={busy || expired || covered >= i.quantity} onClick={() => correct(i.id, p.id, p.display_name, units + 1)}>+</Button></div>}</div>; })}</details>}</div>; })}</div>
      <div className="split-actions">{isHost && <Button variant="outline" asChild><Link href={`/split/${sessionId}/invite`}>Ajak teman</Link></Button>}{(room.session.state === 'claiming' || isHost && room.session.state === 'draft') && <Button variant="outline" asChild><Link href={`/split/${sessionId}/claim`}>{room.session.state === 'draft' ? 'Atur item bersama' : 'Pilih pesananku'}</Link></Button>}</div>
      {isHost && room.session.state === 'draft' && <div className="bottom-action"><Button className="full-width" disabled={busy || expired} onClick={() => mutate('open', {})}>Buka klaim pesanan</Button></div>}</>}
    {view === 'claim' && <><div className="split-intro"><span className="eyebrow">PILIH PESANANMU</span><h2>{room.session.title}</h2><p>Setiap pilihan langsung tersimpan setelah server menyetujui. Perkiraan dapat berubah saat teman memilih item bersama.</p></div>
      {room.items.map(i => { const claims = room.claims.filter(c => c.item_id === i.id); const myClaim = claims.find(c => c.participant_id === me?.id); const used = claims.reduce((n, c) => n + c.claimed_units, 0); const available = i.quantity - used; return <div className="split-card claim-card" key={i.id}><strong>{i.name}</strong><small>{rupiah(i.total_amount)} · {i.allocation_mode === 'shared' ? `${claims.length} orang berbagi` : `${available} dari ${i.quantity} unit tersisa`}</small>
        {i.allocation_mode === 'exclusive' ? <div className="claim-controls"><Button variant="outline" size="icon" aria-label={`Kurangi ${i.name}`} disabled={busy || expired || room.session.state !== 'claiming' || !myClaim?.claimed_units} onClick={() => mutate('claims', { itemId: i.id, units: (myClaim?.claimed_units ?? 0) - 1 })}>−</Button><strong>{myClaim?.claimed_units ?? 0}</strong><Button variant="outline" size="icon" aria-label={`Tambah ${i.name}`} disabled={busy || expired || room.session.state !== 'claiming' || available < 1} onClick={() => mutate('claims', { itemId: i.id, units: (myClaim?.claimed_units ?? 0) + 1 })}>+</Button></div> : <Button variant={myClaim?.is_shared_member ? 'default' : 'outline'} disabled={busy || expired || room.session.state !== 'claiming'} onClick={() => mutate('claims', { itemId: i.id, shared: !myClaim?.is_shared_member })}>{myClaim?.is_shared_member ? <><Check size={16} /> Ikut berbagi</> : 'Ikut patungan item ini'}</Button>}
        {isHost && room.session.state === 'draft' && <Button variant="ghost" size="small" disabled={busy} onClick={() => mutate('mode', { itemId: i.id, mode: i.allocation_mode === 'shared' ? 'exclusive' : 'shared' })}>Ubah ke {i.allocation_mode === 'shared' ? 'unit terpisah' : 'item bersama'}</Button>}
      </div>; })}
      <div className="split-card"><strong>Perkiraan bagianmu: {rupiah(mine?.estimate ?? 0)}</strong><small>Termasuk perkiraan pajak, layanan, tip, diskon dan pembulatan. Nilai akhir ditentukan setelah semua pesanan lengkap.</small></div>
      <div className="bottom-action"><Button className="full-width" asChild><Link href={`/split/${sessionId}`}>Kembali ke ruang</Link></Button></div></>}
  </Layout>;
}
