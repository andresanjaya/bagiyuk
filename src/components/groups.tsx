'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Plus, Users } from 'lucide-react';
import { Button } from './ui/button';
import { useBills } from '@/lib/store';
import { archiveGroup, listGroups, loadGroup, saveGroup, type FriendGroup } from '@/lib/groups-client';

function GroupLayout({ title, children, back = '/' }: { title: string; children: React.ReactNode; back?: string }) {
  return <main className="app-shell split-together"><header className="app-header"><Button variant="outline" size="icon" asChild><Link href={back} aria-label="Kembali"><ArrowLeft size={20} /></Link></Button><h1>{title}</h1><span className="header-spacer" /></header><div className="hero-gap" aria-hidden="true" /><div className="page-content over-hero">{children}</div></main>;
}

export function GroupHomeBlock() {
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  useEffect(() => { void listGroups(false).then(setGroups).catch(() => {}); }, []);
  return <section aria-label="Grup kamu"><div className="section-heading history-heading"><h2>Grup kamu</h2><Link className="text-link" href="/groups">Lihat semua <ArrowRight size={15} /></Link></div>{groups.slice(0, 2).map(group => <Link key={group.id} className="draft-card" href={`/groups/${group.id}`}><Users size={20} /><span className="grow"><strong>{group.name}</strong><small>{group.member_count} nama · Buat tagihan bareng lagi</small></span><ArrowRight size={17} /></Link>)}{!groups.length && <Link className="draft-card" href="/groups/new"><Plus size={20} /><span className="grow"><strong>Buat grup teman</strong><small>Nama yang sering patungan, siap dipakai lagi.</small></span><ArrowRight size={17} /></Link>}</section>;
}

export function GroupsList() {
  const [groups, setGroups] = useState<FriendGroup[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => { void listGroups().then(setGroups).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  return <GroupLayout title="Grup kamu"><div className="split-intro"><span className="eyebrow">TEMAN PATUNGAN</span><h2>Ketemu lagi, bagi lagi.</h2><p>Nama di grup hanya template. Teman tetap bergabung lewat undangan saat tagihan dibuat.</p></div>{loading && <p className="info-message">Memuat grup…</p>}{error && <p className="error-message" role="alert">{error}</p>}{!loading && !error && !groups.length && <div className="empty"><span className="empty-icon"><Users size={25} /></span><h3>Belum ada grup</h3><p>Biar patungan berikutnya lebih cepat, buat grup dulu, yuk.</p></div>}{groups.map(group => <Link className="split-card" href={`/groups/${group.id}`} key={group.id}><strong>{group.name}</strong><small>{group.member_count} nama · {group.last_used_at ? `Terakhir dipakai ${new Date(group.last_used_at).toLocaleDateString('id-ID')}` : 'Belum dipakai untuk tagihan online'} · Buat tagihan</small></Link>)}<div className="bottom-action"><Button className="full-width" asChild><Link href="/groups/new"><Plus size={17} /> Buat grup</Link></Button></div></GroupLayout>;
}

type EditableMember = { id: string; display_name: string };
export function GroupEditor() {
  const { groupId } = useParams<{ groupId?: string }>();
  const router = useRouter();
  const [name, setName] = useState(''), [members, setMembers] = useState<EditableMember[]>([]), [selected, setSelected] = useState<string[]>([]), [oneOffText, setOneOffText] = useState(''), [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(!!groupId), [error, setError] = useState('');
  useEffect(() => { if (groupId) void loadGroup(groupId).then(({ group, members }) => { setName(group.name); setMembers(members); setSelected(members.map(m => m.id)); }).catch(e => setError(e.message)).finally(() => setLoading(false)); if (!useBills.getState().ready) useBills.getState().hydrate(); }, [groupId]);
  const chosen = members.filter(member => selected.includes(member.id));
  const oneOff = oneOffText.split(',').map(value => value.trim()).filter(Boolean);
  function add() { const value = entry.trim(); if (!value || value.length > 40 || members.length >= 30) return; const member = { id: crypto.randomUUID(), display_name: value }; setMembers(previous => [...previous, member]); setSelected(previous => [...previous, member.id]); setEntry(''); }
  async function save() { if (!name.trim() || members.some(m => !m.display_name.trim()) || busy) return; setBusy(true); setError(''); try { const id = await saveGroup(groupId ?? null, name.trim(), members.map(m => ({ id: m.id, display_name: m.display_name.trim() }))); router.replace(`/groups/${id}`); if (groupId) setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Gagal menyimpan grup.'); } finally { setBusy(false); } }
  async function archive() { if (!groupId || !window.confirm('Arsipkan grup ini? Tagihan lama tetap tersimpan.')) return; setBusy(true); setError(''); try { await archiveGroup(groupId); router.replace('/groups'); } catch (e) { setError(e instanceof Error ? e.message : 'Gagal mengarsipkan grup.'); } finally { setBusy(false); } }
  function startBill() {
    if (!groupId || chosen.length + oneOff.length > 7 || oneOff.some(value => value.length > 40)) { setError('Pilih maksimal 7 nama tambahan, masing-masing hingga 40 karakter.'); return; }
    const store = useBills.getState();
    if (store.draft && !store.history.some(b => b.id === store.draft?.id) && (store.draft.name || store.draft.items.length) && !window.confirm('Ganti draf yang belum selesai dengan tagihan dari grup?')) return;
    store.start(); const draft = useBills.getState().draft!;
    store.update({ groupId, people: [draft.people[0], ...[...chosen.map(m => m.display_name), ...oneOff].map(displayName => ({ id: crypto.randomUUID(), name: displayName, phone: '' }))] });
    window.location.assign('/#create');
  }
  return <GroupLayout title={groupId ? 'Detail grup' : 'Buat grup'} back="/groups">{loading ? <p className="info-message">Memuat grup…</p> : <><div className="split-intro"><span className="eyebrow">GRUP TEMAN</span><h2>{groupId ? 'Siap patungan lagi?' : 'Siapa temanmu?'}</h2><p>Grup privat tersimpan untuk identitas browser ini. Jika data browser dihapus, grup tidak bisa dipulihkan tanpa akun.</p></div><label>Nama grup<input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Contoh: Weekend Crew" /></label><h2 className="split-heading">Nama teman</h2>{members.map((member, i) => <div className="split-card" key={member.id}><label>Nama {i + 1}<input value={member.display_name} maxLength={40} onChange={e => setMembers(previous => previous.map(m => m.id === member.id ? { ...m, display_name: e.target.value } : m))} /></label><div className="split-actions">{groupId && <label className="group-check"><input type="checkbox" checked={selected.includes(member.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, member.id] : previous.filter(id => id !== member.id))} /> Pakai di tagihan berikut</label>}<Button variant="outline" size="small" disabled={i === 0} onClick={() => setMembers(previous => { const next = [...previous]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; })}>Naik</Button><Button variant="outline" size="small" onClick={() => { setMembers(previous => previous.filter(m => m.id !== member.id)); setSelected(previous => previous.filter(id => id !== member.id)); }}>Hapus</Button></div></div>)}<div className="split-card"><label>Tambah nama<input value={entry} maxLength={40} onChange={e => setEntry(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="Nama teman" /></label><Button variant="outline" disabled={!entry.trim() || members.length >= 30} onClick={add}><Plus size={16} /> Tambah anggota</Button></div>{groupId && <div className="split-card"><strong>Nama sekali pakai</strong><small>Tidak disimpan di grup; hanya untuk draf ini.</small><label>Tambah nama<input value={oneOffText} onChange={e => setOneOffText(e.target.value)} placeholder="Pisahkan dengan koma" /></label></div>}{error && <p className="error-message" role="alert">{error}</p>}{groupId && <><Button className="full-width" disabled={busy || chosen.length + oneOff.length > 7} onClick={startBill}>Buat tagihan dari grup</Button><Button variant="ghost" className="full-width" disabled={busy} onClick={archive}>Arsipkan grup</Button></>}<div className="bottom-action"><Button className="full-width" disabled={busy || !name.trim() || members.some(m => !m.display_name.trim())} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan grup'}</Button></div></>}</GroupLayout>;
}
