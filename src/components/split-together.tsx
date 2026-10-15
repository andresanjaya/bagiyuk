'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, Check, Copy, LoaderCircle, Share2, Users } from 'lucide-react';
import { Button } from './ui/button';
import { useBills } from '@/lib/store';
import { itemTotal, rupiah, total } from '@/lib/bill';
import { finalizedAmounts, roomAmounts, type Room } from '@/lib/split';
import { settlementPlan } from '@/lib/settlement';
import { browserSupabase } from '@/lib/supabase';
import { cloudIdentity, fetchRoom, splitApi } from '@/lib/split-client';

function Layout({ title, children }: { title: string; children: React.ReactNode }) {
  const path = usePathname();
  const back = /\/(invite|claim|finalize|payments)$/.test(path) ? path.replace(/\/(invite|claim|finalize|payments)$/, '') : '/';
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
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const refresh = useCallback(async () => { setSyncing(true); try { const next = await fetchRoom(sessionId); setRoom(previous => !previous || next.session.version >= previous.session.version ? next : previous); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Koneksi terputus.'); } finally { setSyncing(false); } }, [sessionId]);
  useEffect(() => {
    void refresh();
    let client: ReturnType<typeof browserSupabase>;
    try { client = browserSupabase(); } catch (e) { setError(e instanceof Error ? e.message : 'Split Together belum dikonfigurasi.'); return; }
    const channel = client.channel(`split-${sessionId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'split_sessions', filter: `id=eq.${sessionId}` }, () => void refresh()).subscribe(status => { if (status === 'SUBSCRIBED') { setConnection('connected'); void refresh(); } if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnection('reconnecting'); });
    const resume = () => { if (document.visibilityState === 'visible' && navigator.onLine) void refresh(); };
    const offline = () => { setConnection('reconnecting'); setError('Kamu sedang offline. Pilihan baru belum dapat disimpan.'); };
    window.addEventListener('online', resume); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', resume);
    return () => { client.removeChannel(channel); window.removeEventListener('online', resume); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', resume); };
  }, [sessionId, refresh]);
  return { room, error, syncing, connection, refresh, setError };
}

function TransferTracker({ room, busy, mutate, setError }: { room: Room; busy: boolean; mutate: (action: string, data: unknown) => Promise<void>; setError: (message: string) => void }) {
  const isHost = room.session.host_user_id === room.me;
  const paid = room.transfers.filter(row => row.status === 'paid');
  const outstanding = room.transfers.filter(row => row.status === 'unpaid');
  const person = (id: string) => room.participants.find(p => p.id === id)?.display_name ?? 'Teman';
  function message(transfer: Room['transfers'][number]) { return `Hai ${person(transfer.from_participant_id)}! 👋\nPatungan di "${room.session.title}" masih ada ${rupiah(transfer.amount_idr)} yang perlu kamu transfer ke ${person(transfer.to_participant_id)}.\nKalau sudah transfer, kabari ya. Makasih! 💜\n— Bagiyuk`; }
  async function remind(transfer: Room['transfers'][number], copyOnly: boolean) {
    try {
      const text = message(transfer);
      if (copyOnly) await navigator.clipboard.writeText(text);
      else if (navigator.share) await navigator.share({ text });
      else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    } catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) setError('Pengingat belum bisa dibagikan. Coba salin teksnya.'); }
  }
  return <><div className="split-intro"><span className="eyebrow">SMART SETTLEMENT</span><h2>Bagi tagihan, beresin patungan.</h2><p>Status transfer dicatat manual oleh host, bukan verifikasi bank.</p></div><div className="split-card"><strong>{outstanding.length ? `${paid.length} dari ${room.transfers.length} transfer selesai` : 'Semua sudah beres!'}</strong><div className="split-line"><span>Sudah ditandai lunas</span><strong>{rupiah(paid.reduce((sum, row) => sum + row.amount_idr, 0))}</strong></div><div className="split-line"><span>Masih perlu ditransfer</span><strong>{rupiah(outstanding.reduce((sum, row) => sum + row.amount_idr, 0))}</strong></div></div>{!room.transfers.length && <div className="split-card"><strong>Sudah beres! Tidak ada transfer yang diperlukan.</strong><small>Kontribusi awal tiap orang sudah menutup bagiannya.</small></div>}{room.transfers.map(transfer => <div className="split-card" key={transfer.id}><div className="split-line"><span>{person(transfer.from_participant_id)} → {person(transfer.to_participant_id)}<small>{transfer.status === 'paid' ? `Ditandai lunas oleh host${transfer.paid_at ? ` · ${new Date(transfer.paid_at).toLocaleString('id-ID')}` : ''}` : 'Belum dibayar'}</small></span><strong>{rupiah(transfer.amount_idr)}</strong></div>{isHost && transfer.status === 'unpaid' && <div className="split-actions"><Button variant="outline" onClick={() => void remind(transfer, false)}>Ingatkan</Button><Button variant="outline" onClick={() => void remind(transfer, true)}>Salin pengingat</Button></div>}{isHost && <Button variant="outline" disabled={busy} onClick={() => void mutate('transfers', { transferId: transfer.id, status: transfer.status === 'paid' ? 'unpaid' : 'paid' })}>{busy ? 'Menyimpan…' : transfer.status === 'paid' ? 'Tandai belum dibayar' : 'Tandai lunas'}</Button>}</div>)}</>;
}

export function SplitRoom() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const view = pathname.endsWith('/invite') ? 'invite' : pathname.endsWith('/claim') ? 'claim' : pathname.endsWith('/finalize') ? 'finalize' : pathname.endsWith('/payments') ? 'payments' : 'room';
  const { room, error, syncing, connection, refresh, setError } = useRoom(sessionId);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState('');
  const [expiry, setExpiry] = useState('');
  const [qr, setQr] = useState('');
  const [paidInputs, setPaidInputs] = useState<Record<string, string>>({});
  const isHost = room?.session.host_user_id === room?.me;
  useEffect(() => { if (room) setPaidInputs(Object.fromEntries(room.participants.map(p => [p.id, String(room.contributions.find(c => c.participant_id === p.id)?.amount_idr ?? (room.contributions.length ? 0 : p.role === 'host' ? room.session.grand_total_amount : 0))]))); }, [room]);
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
  async function finalize() {
    if (busy) return;
    setBusy(true); setError('');
    try { await splitApi(`${sessionId}/finalize`, {}); await refresh(); router.replace(`/split/${sessionId}/payments`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Finalisasi belum tersimpan.'); await refresh(); }
    finally { setBusy(false); }
  }
  async function saveContributions() {
    if (!room || busy) return;
    setBusy(true); setError('');
    try { await splitApi(`${sessionId}/contributions`, { expectedVersion: room.session.version, rows: room.participants.map(p => ({ participantId: p.id, amount: Number(paidInputs[p.id] ?? 0) })) }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Pembayaran awal belum tersimpan.'); await refresh(); }
    finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(invite); } catch { setError('Gagal menyalin. Pilih dan salin tautan di bawah.'); } }
  function correct(itemId: string, participantId: string, participantName: string, value: number | boolean) {
    if (!window.confirm(`Ubah klaim ${participantName}? Perkiraan semua peserta dapat berubah.`)) return;
    void mutate('host-claim', { itemId, participantId, ...(typeof value === 'number' ? { units: value } : { shared: value }) });
  }
  const title = view === 'invite' ? 'Ajak teman' : view === 'claim' ? 'Pilih pesananmu' : view === 'finalize' ? 'Tinjau patungan' : view === 'payments' ? 'Status pembayaran' : 'Ruang patungan';
  if (!room) return <Layout title={title}>{syncing && <Loading />}<Notice message={error} /><Button variant="outline" onClick={() => void refresh()}>Coba lagi</Button></Layout>;
  const progress = roomAmounts(room);
  const me = room.participants.find(p => p.user_id === room.me);
  const mine = progress.people.find(p => p.user_id === room.me);
  const expired = new Date(room.session.expires_at).getTime() <= Date.now();
  let finalRows: ReturnType<typeof finalizedAmounts> = [], reviewError = '';
  if (view === 'finalize' && room.session.state === 'claiming') {
    try { finalRows = finalizedAmounts(room); } catch (e) { reviewError = e instanceof Error && e.message === 'INCOMPLETE_ALLOCATION' ? 'Semua unit dan item bersama harus dipilih sebelum finalisasi.' : 'Total pembagian belum cocok dengan tagihan.'; }
  }
  const guestSettlements = room.settlements.filter(row => room.participants.some(p => p.id === row.participant_id && p.role === 'guest'));
  const received = guestSettlements.filter(row => row.status === 'paid').reduce((sum, row) => sum + row.amount_due, 0);
  const outstanding = guestSettlements.filter(row => row.status === 'unpaid').reduce((sum, row) => sum + row.amount_due, 0);
  const paidRows = room.participants.map(p => ({ participantId: p.id, amount: Number(paidInputs[p.id] ?? (room.contributions.find(c => c.participant_id === p.id)?.amount_idr ?? (room.contributions.length ? 0 : p.role === 'host' ? room.session.grand_total_amount : 0))) }));
  const paidValid = paidRows.every(row => Number.isSafeInteger(row.amount) && row.amount >= 0 && row.amount <= room.session.grand_total_amount);
  const paidTotal = paidRows.reduce((sum, row) => sum + row.amount, 0);
  const paidDirty = room.contributions.length > 0 && room.contributions.length !== room.participants.length || paidRows.some(row => row.amount !== (room.contributions.find(c => c.participant_id === row.participantId)?.amount_idr ?? (room.contributions.length ? 0 : room.participants.find(p => p.id === row.participantId)?.role === 'host' ? room.session.grand_total_amount : 0)));
  let previewTransfers: ReturnType<typeof settlementPlan> = [];
  if (view === 'finalize' && finalRows.length && !reviewError && paidValid && paidTotal === room.session.grand_total_amount) {
    try { previewTransfers = settlementPlan(finalRows.map(row => ({ participantId: row.participant_id, amount: row.final_amount })), paidRows, room.session.grand_total_amount); } catch { /* The server still validates the authoritative snapshot. */ }
  }
  return <Layout title={title}>
    {syncing && <p className="info-message"><LoaderCircle className="spin" size={15} /> Menyelaraskan perubahan…</p>}
    {connection !== 'connected' && <p className="info-message" role="status">{connection === 'connecting' ? 'Menghubungkan pembaruan langsung…' : 'Menyambung ulang pembaruan langsung…'}</p>}
    <Notice message={error} />{expired && room.session.state !== 'finalized' && <Notice message="Sesi sudah kedaluwarsa. Klaim tidak dapat diubah." />}
    {view === 'finalize' && <><div className="split-intro"><span className="eyebrow">TINJAU AKHIR</span><h2>{room.session.title}</h2><p>Setelah selesai, klaim terkunci. Jumlah per orang disimpan dan host dapat mencatat pembayaran.</p></div>
      {room.session.state === 'finalized' ? <div className="split-card"><strong>Tagihan sudah difinalisasi</strong><Button asChild><Link href={`/split/${sessionId}/payments`}>Lihat status pembayaran</Link></Button></div> : <><div className="split-card"><strong>{progress.covered} / {progress.assignable} bagian terpilih</strong><progress max={progress.assignable || 1} value={progress.covered} className="split-progress" />{room.items.map(item => { const claims = room.claims.filter(c => c.item_id === item.id); const count = item.allocation_mode === 'shared' ? claims.filter(c => c.is_shared_member).length : claims.reduce((sum, c) => sum + c.claimed_units, 0); const complete = item.allocation_mode === 'shared' ? count > 0 : count === item.quantity; return <div className="split-line" key={item.id}><span>{item.name}</span><strong>{complete ? 'Lengkap' : 'Belum lengkap'}</strong></div>; })}</div>
      <div className="split-card"><strong>Total {rupiah(room.session.grand_total_amount)}</strong>{finalRows.map(row => <div className="split-line" key={row.participant_id}><span>{room.participants.find(p => p.id === row.participant_id)?.display_name}</span><strong>{rupiah(row.final_amount)}</strong></div>)}</div><Notice message={reviewError} />
      <div className="split-card"><strong>Siapa yang bayar duluan?</strong><small>Ini uang yang sudah dibayar ke restoran, bukan transfer antar teman.</small>{room.participants.map(p => <label key={p.id}>{p.display_name}<input type="number" min="0" step="1" inputMode="numeric" disabled={!isHost || busy} value={paidInputs[p.id] ?? String(p.role === 'host' ? room.session.grand_total_amount : 0)} onChange={e => setPaidInputs(previous => ({ ...previous, [p.id]: e.target.value }))} /></label>)}<div className="split-line"><span>Sudah dibayar di restoran</span><strong>{paidValid ? rupiah(paidTotal) : 'Periksa angka'}</strong></div>{paidValid && paidTotal !== room.session.grand_total_amount && <small role="alert">{paidTotal < room.session.grand_total_amount ? `Masih kurang ${rupiah(room.session.grand_total_amount - paidTotal)} dari total pembayaran.` : `Jumlah pembayaran melebihi total tagihan ${rupiah(paidTotal - room.session.grand_total_amount)}.`}</small>}{isHost && <Button variant="outline" disabled={busy || !paidValid} onClick={saveContributions}>Simpan pembayaran awal</Button>}</div>
      {!!finalRows.length && !reviewError && paidValid && paidTotal === room.session.grand_total_amount && <div className="split-card"><strong>Rencana transfer</strong>{previewTransfers.length ? previewTransfers.map(row => <div className="split-line" key={`${row.fromParticipantId}:${row.toParticipantId}`}><span>{room.participants.find(p => p.id === row.fromParticipantId)?.display_name} → {room.participants.find(p => p.id === row.toParticipantId)?.display_name}</span><strong>{rupiah(row.amount)}</strong></div>) : <small>Tidak ada transfer yang diperlukan.</small>}</div>}
      {isHost ? <div className="bottom-action"><Button className="full-width" disabled={busy || expired || !!reviewError || !finalRows.length || !paidValid || paidTotal !== room.session.grand_total_amount || paidDirty} onClick={finalize}>{busy ? 'Menyimpan…' : 'Selesaikan patungan'}</Button>{paidDirty && <small>Simpan pembayaran awal sebelum menyelesaikan.</small>}</div> : <Notice message="Hanya host yang dapat menyelesaikan patungan." />}</>}</>}
    {view === 'payments' && room.session.state === 'finalized' && room.contributions.length > 0 && <TransferTracker room={room} busy={busy} mutate={mutate} setError={setError} />}
    {view === 'payments' && (room.session.state !== 'finalized' ? <Notice message="Tagihan belum difinalisasi oleh host." /> : !room.contributions.length ? <><div className="split-intro"><span className="eyebrow">PEMBAYARAN</span><h2>{room.session.title}</h2><p>Catatan manual oleh host. Bagiyuk tidak memproses transfer uang.</p></div><div className="split-card"><strong>Total tagihan {rupiah(room.session.grand_total_amount)}</strong><div className="split-line"><span>Diterima dari teman</span><strong>{rupiah(received)}</strong></div><div className="split-line"><span>Belum dibayar teman</span><strong>{rupiah(outstanding)}</strong></div><small>Bagian host dianggap sudah dibayar dan tidak termasuk tagihan teman.</small></div>
      <h2 className="split-heading">Rincian per orang</h2>{room.participants.map(p => { const summary = room.summaries.find(row => row.participant_id === p.id); const payment = room.settlements.find(row => row.participant_id === p.id); return <div className="split-card" key={p.id}><div className="split-line"><span>{p.display_name} {p.role === 'host' ? '· Host' : ''}<small>{payment?.status === 'paid' ? `Lunas${payment.paid_at ? ` · ${new Date(payment.paid_at).toLocaleString('id-ID')}` : ''}` : 'Belum dibayar'}</small></span><strong>{rupiah(summary?.final_amount ?? 0)}</strong></div>{summary && <details><summary>Rincian jumlah</summary><small>Item {rupiah(summary.item_amount)} · Diskon {rupiah(summary.discount_share)} · Pajak {rupiah(summary.tax_share)} · Layanan {rupiah(summary.service_share)} · Tip {rupiah(summary.tip_share)} · Pembulatan {rupiah(summary.rounding_share)}</small></details>}{isHost && p.role === 'guest' && payment && <Button variant="outline" disabled={busy} onClick={() => mutate('settlements', { participantId: p.id, status: payment.status === 'paid' ? 'unpaid' : 'paid' })}>{busy ? 'Menyimpan…' : payment.status === 'paid' ? 'Tandai belum dibayar' : 'Tandai lunas'}</Button>}</div>; })}</> : null)}
    {view === 'invite' && <><div className="split-intro"><span className="eyebrow">UNDANG TEMAN</span><h2>Bagikan satu tagihan, pilih bareng.</h2><p>{room.session.title} · {room.participants.length}/{room.session.max_participants} orang · {room.session.state === 'claiming' ? 'Klaim dibuka' : 'Menunggu klaim'}</p></div>
      {isHost ? <><div className="split-card invite-card">{qr ? <img src={qr} alt="Kode QR undangan Bagiyuk" width={220} height={220} /> : <Users size={60} />}<strong>Pindai untuk bergabung</strong><small>Undangan berlaku sampai {new Date(expiry || room.session.expires_at).toLocaleDateString('id-ID')}</small></div>
        {invite ? <><label>Tautan undangan<input readOnly value={invite} onFocus={e => e.currentTarget.select()} /></label>{['localhost', '127.0.0.1', '[::1]'].includes(new URL(invite).hostname) && <p className="info-message" role="status">Tautan lokal hanya bisa dibuka di perangkat ini. Untuk teman lewat internet, buka Bagiyuk di Vercel dan buat tautan baru.</p>}<div className="split-actions"><Button variant="outline" onClick={copy}><Copy size={16} /> Salin link</Button><Button variant="outline" onClick={() => navigator.share ? navigator.share({ url: invite }).catch(() => {}) : window.open(`https://wa.me/?text=${encodeURIComponent(invite)}`, '_blank', 'noopener,noreferrer')}><Share2 size={16} /> Bagikan</Button></div><a className="text-link" href={`https://wa.me/?text=${encodeURIComponent(invite)}`} target="_blank" rel="noreferrer">Bagikan via WhatsApp</a><Button variant="ghost" disabled={busy || expired} onClick={createInvite}>Buat tautan baru</Button></> : <Button className="full-width" disabled={busy || expired} onClick={createInvite}>Buat tautan undangan</Button>}
        <small>Tautan baru tidak membatalkan tautan sebelumnya. Simpan tautan ini sebelum menutup halaman.</small></> : <Notice message="Hanya host yang dapat membuat undangan." />}
      <div className="bottom-action"><Button className="full-width" asChild><Link href={`/split/${sessionId}`}>Lihat ruang patungan</Link></Button></div></>}
    {view === 'room' && <><div className="split-intro"><span className="eyebrow">SPLIT TOGETHER</span><h2>{room.session.title}</h2><p>{room.session.state === 'finalized' ? 'Tagihan sudah selesai' : room.session.state === 'claiming' ? 'Pesanan sedang dipilih' : 'Menunggu host membuka klaim'} · {room.participants.length} orang</p></div>
      <div className="split-card"><strong>{progress.covered} / {progress.assignable} bagian terpilih</strong><progress max={progress.assignable || 1} value={progress.covered} className="split-progress" /><small>{progress.assignable - progress.covered} bagian belum dipilih. Item bersama dihitung terpilih setelah ada peserta.</small></div>
      <h2 className="split-heading">Teman patungan</h2><div className="split-card">{room.participants.map(p => <div className="split-line" key={p.id}><span>{p.display_name} {p.role === 'host' ? '· Host' : ''}<small>{room.claims.filter(c => c.participant_id === p.id).length} item</small></span><strong>{room.session.state === 'finalized' ? rupiah(room.summaries.find(x => x.participant_id === p.id)?.final_amount ?? 0) : `~${rupiah(progress.people.find(x => x.id === p.id)?.estimate ?? 0)}`}</strong></div>)}</div>
      <h2 className="split-heading">Item</h2><div className="split-card">{room.items.map(i => { const claims = room.claims.filter(c => c.item_id === i.id); const covered = i.allocation_mode === 'shared' ? claims.filter(c => c.is_shared_member).length : claims.reduce((n, c) => n + c.claimed_units, 0); return <div key={i.id}><div className="split-line"><span>{i.name}<small>{i.allocation_mode === 'shared' ? `${covered} orang berbagi` : `${covered}/${i.quantity} unit terpilih`}</small></span><strong>{rupiah(i.total_amount)}</strong></div>{isHost && room.session.state === 'claiming' && <details className="host-fix"><summary>Perbaiki pembagian</summary>{room.participants.map(p => { const claimed = claims.find(c => c.participant_id === p.id); const units = claimed?.claimed_units ?? 0; return <div className="split-line" key={p.id}><span>{p.display_name}<small>{i.allocation_mode === 'shared' ? claimed?.is_shared_member ? 'Ikut berbagi' : 'Belum ikut' : `${units} unit`}</small></span>{i.allocation_mode === 'shared' ? <Button size="small" variant="outline" disabled={busy || expired} onClick={() => correct(i.id, p.id, p.display_name, !claimed?.is_shared_member)}>Ubah</Button> : <div className="claim-controls"><Button size="icon" variant="outline" aria-label={`Kurangi klaim ${p.display_name}`} disabled={busy || expired || units === 0} onClick={() => correct(i.id, p.id, p.display_name, units - 1)}>−</Button><Button size="icon" variant="outline" aria-label={`Tambah klaim ${p.display_name}`} disabled={busy || expired || covered >= i.quantity} onClick={() => correct(i.id, p.id, p.display_name, units + 1)}>+</Button></div>}</div>; })}</details>}</div>; })}</div>
      <div className="split-actions">{isHost && room.session.state !== 'finalized' && <Button variant="outline" asChild><Link href={`/split/${sessionId}/invite`}>Ajak teman</Link></Button>}{(room.session.state === 'claiming' || isHost && room.session.state === 'draft') && <Button variant="outline" asChild><Link href={`/split/${sessionId}/claim`}>{room.session.state === 'draft' ? 'Atur item bersama' : 'Pilih pesananku'}</Link></Button>}{room.session.state === 'finalized' && <Button asChild><Link href={`/split/${sessionId}/payments`}>Lihat status pembayaran</Link></Button>}{isHost && room.session.state === 'claiming' && <Button asChild><Link href={`/split/${sessionId}/finalize`}>Tinjau patungan</Link></Button>}</div>
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
