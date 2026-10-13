'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Camera, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Coffee, Copy, Download, Home, ImagePlus, LoaderCircle, Pencil, Plus, ReceiptText, ScanLine, Share2, ShieldCheck, ShoppingBag, Sparkles, Trash2, Users, Utensils, Wallet, X, Plane, History, Heart, CirclePlus } from 'lucide-react';
import { Button } from './ui/button';
import { useBills } from '@/lib/store';
import { calculate, freshBill, id, itemTotal, rupiah, subtotal, summaryText, total, type Bill, type Item, type Person } from '@/lib/bill';
import { receiptSchema } from '@/lib/receipt';

type Screen = 'home' | 'create' | 'items' | 'friends' | 'scan' | 'split' | 'result' | 'history';
const titles: Record<Screen, string> = { home: 'Bagiyuk', create: 'Buat patungan', items: 'Tambah item', friends: 'Teman patungan', scan: 'Scan struk', split: 'Bagi tagihan', result: 'Hasil patungan', history: 'Riwayat patungan' };
const categories = [{ name: 'Makan & minum', icon: Utensils }, { name: 'Jalan-jalan', icon: Plane }, { name: 'Belanja', icon: ShoppingBag }, { name: 'Seru-seruan', icon: Users }];
const fieldSchema = z.object({ name: z.string().trim().min(1, 'Nama item perlu diisi.').max(80), quantity: z.number().int().min(1).max(1000), price: z.number().int().min(0).max(1_000_000_000), discount: z.number().int().min(0).max(1_000_000_000) }).refine(v => v.discount <= v.price * v.quantity, { message: 'Diskon melebihi harga item.', path: ['discount'] });
type ItemFields = z.infer<typeof fieldSchema>;

function Avatar({ person, index = 0, small = false }: { person: Pick<Person, 'name'>; index?: number; small?: boolean }) { return <span className={`avatar avatar-${index % 5} ${small ? 'avatar-small' : ''}`} aria-hidden="true">{person.name.trim().split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase()}</span>; }
function AvatarStack({ people }: { people: Person[] }) { return <span className="avatar-stack">{people.slice(0, 3).map((p, i) => <Avatar key={p.id} person={p} index={i} small />)}{people.length > 3 && <span className="avatar avatar-small avatar-extra">+{people.length - 3}</span>}</span>; }
function Bottom({ children }: { children: ReactNode }) { return <div className="bottom-action">{children}</div>; }
function Empty({ icon = <ReceiptText />, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) { return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{children}</p></div>; }

function ItemEditor({ item, onSave, onClose }: { item?: Item; onSave: (item: Item) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<ItemFields>({ resolver: zodResolver(fieldSchema), defaultValues: item ?? { name: '', quantity: 1, price: 0, discount: 0 } });
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="sheet" aria-labelledby="item-editor-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sheet-head"><h2 id="item-editor-title">{item ? 'Edit item' : 'Item baru'}</h2><Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Tutup"><X /></Button></div>
    <form onSubmit={handleSubmit(values => onSave({ ...values, id: item?.id ?? id(), assigned: item?.assigned ?? [] }))}>
      <label>Nama item<input autoFocus placeholder="Contoh: Iced cappuccino" {...register('name')} /></label>
      {errors.name && <p className="field-error">{errors.name.message}</p>}
      <div className="field-pair"><label>Jumlah<input type="number" min="1" max="1000" {...register('quantity', { valueAsNumber: true })} /></label><label>Harga satuan (Rp)<input type="number" min="0" step="1" {...register('price', { valueAsNumber: true })} /></label></div>
      <label>Diskon item (Rp)<input type="number" min="0" step="1" {...register('discount', { valueAsNumber: true })} /></label>
      {(errors.quantity || errors.price || errors.discount) && <p className="field-error">{errors.discount?.message ?? 'Isi jumlah dan harga dengan angka bulat yang valid.'}</p>}
      <Button type="submit" className="full-width"><Check size={18} /> Simpan item</Button>
    </form>
  </dialog>;
}

function PersonRow({ person, index, isHost, onChange, onRemove, onHost }: { person: Person; index: number; isHost: boolean; onChange: (p: Person) => void; onRemove: () => void; onHost: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [phone, setPhone] = useState(person.phone);
  return <div className="person-card">
    <div className="person-main"><Avatar person={person} index={index} /><div className="grow"><strong>{person.name}</strong><small>{isHost ? 'Bayar duluan' : person.phone || 'Teman patungan'}</small></div><Button variant="ghost" size="icon" aria-label={`Edit ${person.name}`} onClick={() => setEditing(!editing)}><Pencil size={16} /></Button></div>
    {editing && <form className="person-edit" onSubmit={e => { e.preventDefault(); if (name.trim()) { onChange({ ...person, name: name.trim(), phone }); setEditing(false); } }}><label>Nama<input required maxLength={40} value={name} onChange={e => setName(e.target.value)} /></label><label>Nomor HP (opsional)<input type="tel" maxLength={30} value={phone} onChange={e => setPhone(e.target.value)} /></label><div className="row"><Button size="small" type="submit">Simpan</Button><Button type="button" size="small" variant="ghost" onClick={onRemove}><Trash2 size={15} /> Hapus</Button></div></form>}
    {!isHost && <button className="text-link host-link" onClick={onHost}>Jadikan pembayar</button>}
  </div>;
}

export default function Bagiyuk() {
  const store = useBills();
  const [screen, setScreen] = useState<Screen>('home');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Item | 'new' | null>(null);
  const [friendName, setFriendName] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [scanError, setScanError] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptTotal, setReceiptTotal] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [offline, setOffline] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), cameraInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [viewedBill, setViewedBill] = useState<Bill | null>(null);
  const b = screen === 'result' && viewedBill ? viewedBill : store.draft;
  const nav = (next: Screen, billId?: string) => { window.location.hash = next === 'home' ? '' : next === 'result' && billId ? `result/${billId}` : next; setScreen(next); setNotice(''); window.scrollTo({ top: 0, behavior: 'instant' }); };
  useEffect(() => {
    store.hydrate();
    const onHash = () => { const [hash, billId] = window.location.hash.slice(1).split('/') as [Screen, string | undefined]; if (hash === 'result') setViewedBill(useBills.getState().history.find(bill => bill.id === billId) ?? null); setScreen(hash in titles && (hash === 'home' || hash === 'scan' || hash === 'history' || hash === 'result' || useBills.getState().draft) ? hash : 'home'); window.scrollTo(0, 0); };
    onHash(); window.addEventListener('hashchange', onHash);
    const install = (e: Event) => { e.preventDefault(); setInstallPrompt(e as Event & { prompt: () => Promise<void> }); };
    const network = () => setOffline(!navigator.onLine); network();
    window.addEventListener('beforeinstallprompt', install); window.addEventListener('online', network); window.addEventListener('offline', network);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').then(async () => {
      const registration = await navigator.serviceWorker.ready;
      await document.fonts.ready;
      const urls = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => url.startsWith(`${location.origin}/_next/static/`));
      registration.active?.postMessage({ type: 'CACHE_ASSETS', urls });
    }).catch(() => {});
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('beforeinstallprompt', install); window.removeEventListener('online', network); window.removeEventListener('offline', network); request.current?.abort(); };
    // Store actions are stable; hydrate only on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  const start = (next: Screen) => { if (store.draft && !store.history.some(h => h.id === store.draft?.id) && (store.draft.name || store.draft.items.length) && !window.confirm('Ganti draf yang belum selesai dengan patungan baru?')) return; store.start(); setViewedBill(null); setReceiptTotal(null); setReceiptNote(''); setPreview(''); setScanError(''); nav(next); };
  const continueDraft = () => nav('create');
  const goBack = () => {
    if (busy) { request.current?.abort(); setBusy(false); }
    nav(screen === 'items' || screen === 'friends' || screen === 'split' ? 'create' : screen === 'result' ? 'history' : 'home');
  };
  const update = store.update;
  let rows: ReturnType<typeof calculate> = [];
  let calculationError = '';
  if (b) { try { rows = calculate(b); } catch (e) { calculationError = e instanceof z.ZodError ? 'Lengkapi nama, item, dan teman dulu, ya.' : e instanceof Error ? e.message : 'Periksa tagihan lagi, ya.'; } }
  const unassigned = b?.items.filter(i => !i.assigned.length).length ?? 0;
  const history = store.history;
  const itemCount = b?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  const displayHero = ['home', 'create', 'items', 'friends', 'split'].includes(screen);
  const demo = () => {
    if (store.draft && !store.history.some(h => h.id === store.draft?.id) && (store.draft.name || store.draft.items.length) && !window.confirm('Ganti draf yang belum selesai dengan tagihan contoh?')) return;
    const bill = freshBill(); const friend = { id: id(), name: 'Nadia', phone: '' }; const friend2 = { id: id(), name: 'Dimas', phone: '' };
    bill.name = 'Ngopi di Kopi Tuku'; bill.people.push(friend, friend2);
    bill.items = [{ id: id(), name: 'Es kopi susu', quantity: 2, price: 24000, discount: 0, assigned: [bill.host, friend.id] }, { id: id(), name: 'Matcha latte', quantity: 1, price: 32000, discount: 0, assigned: [friend2.id] }, { id: id(), name: 'French fries', quantity: 1, price: 28000, discount: 0, assigned: bill.people.map(p => p.id) }]; bill.tax = 10800;
    store.start(); update(bill); setViewedBill(null); setReceiptTotal(null); setReceiptNote('Ini tagihan contoh. Kamu bebas mengubahnya.'); nav('create');
  };
  async function scan(file?: File) {
    if (!file) return;
    setScanError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setScanError('Pilih foto JPG, PNG, atau WebP, maksimal 8 MB.'); return; }
    setPreview(URL.createObjectURL(file)); setBusy(true);
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 65000);
    try {
      const data = new FormData(); data.append('receipt', file);
      const response = await fetch('/api/receipt', { method: 'POST', body: data, signal: controller.signal });
      const json = await response.json(); if (!response.ok) throw new Error(json.error || 'Struk belum bisa dibaca. Coba foto yang lebih jelas.');
      const receipt = receiptSchema.parse(json);
      if (!useBills.getState().draft) store.start();
      update({ name: receipt.merchant_name, source: 'receipt', items: receipt.items.map(i => ({ id: id(), name: i.name, quantity: i.quantity, price: i.unit_price, discount: i.discount, assigned: [] })), service: receipt.service_charge, tax: receipt.tax, discount: receipt.discount, tip: 0, rounding: 0 });
      setReceiptTotal(receipt.grand_total); setReceiptNote('Struk berhasil dibaca. Cek nama, harga, dan totalnya sekali lagi, ya.'); nav('create');
    } catch (e) { setScanError(e instanceof Error && e.name === 'AbortError' ? 'Scan dibatalkan atau terlalu lama. Coba lagi atau lanjut manual.' : e instanceof Error ? e.message : 'Gagal membaca struk. Kamu tetap bisa lanjut manual.'); }
    finally { clearTimeout(timeout); setBusy(false); request.current = null; if (fileInput.current) fileInput.current.value = ''; if (cameraInput.current) cameraInput.current.value = ''; }
  }
  async function share(copy = false) {
    if (!b) return;
    try { const text = summaryText(b); if (!copy && navigator.share) await navigator.share({ title: `Bagiyuk • ${b.name}`, text }); else { await navigator.clipboard.writeText(text); setNotice('Hasil patungan berhasil disalin!'); } }
    catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) setNotice('Belum bisa membagikan. Coba simpan gambar hasilnya.'); }
  }
  async function saveImage() {
    if (!b) return;
    const lines = summaryText(b).split('\n');
    await document.fonts.ready;
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 160 + lines.length * 36;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#EDE8FF'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(28, 28, 744, canvas.height - 56);
    lines.forEach((line, i) => { ctx.font = i === 0 ? '600 32px Poppins' : '400 23px Poppins'; ctx.fillStyle = i === 0 ? '#5A35F2' : '#1F1F29'; ctx.fillText(line, 65, 85 + i * 36, 670); });
    canvas.toBlob(blob => { if (!blob) { setNotice('Gambar belum bisa disimpan.'); return; } const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `bagiyuk-${b.name.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Gambar hasil siap diunduh.'); });
  }
  const renderHistory = (bills: Bill[]) => bills.length ? <div className="history-list">{bills.map(bill => <button className="history-card" key={bill.id} onClick={() => { setViewedBill(bill); nav('result', bill.id); }}><div className="history-top"><span className="history-icon"><Coffee size={21} /></span><div className="grow"><strong>{bill.name}</strong><small>{new Date(bill.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} <span>•</span> {bill.people.length} orang</small></div><strong className="history-price">{rupiah(total(bill))}</strong></div><div className="history-bottom"><AvatarStack people={bill.people} /><span className="status"><Check size={12} /> Selesai dihitung</span></div></button>)}</div> : <Empty title="Belum ada patungan">Nanti, semua momen patunganmu<br />tersimpan rapi di sini.</Empty>;

  return <main className={`app-shell screen-${screen}`}>
    <header className={`app-header ${screen === 'home' ? 'home-header' : ''}`}>
      {screen === 'home' ? <a className="brand" href="#" aria-label="Bagiyuk beranda"><span className="brand-mark">b<span>•</span></span>bagiyuk<span className="brand-dot">.</span></a> : <Button variant="outline" size="icon" onClick={goBack} aria-label="Kembali"><ArrowLeft size={20} /></Button>}
      {screen !== 'home' && <h1>{titles[screen]}</h1>}
      <Button variant="ghost" size="icon" aria-label="Bantuan" onClick={() => setHelp(!help)}><CircleHelp size={21} /></Button>
    </header>
    {offline && <div className="offline-banner">Kamu sedang offline. Patungan manual tetap bisa.</div>}
    {help && <div className="help-box"><div className="section-heading"><strong>Patungan tanpa ribet</strong><button aria-label="Tutup bantuan" onClick={() => setHelp(false)}><X size={18} /></button></div><p>1. Foto struk atau tulis item.<br />2. Tambahkan teman dan pilih pesanannya.<br />3. Bagikan hasil, beres!</p><p>Data tersimpan di browser perangkat ini. Foto struk dikirim ke Google Gemini hanya saat scan.</p>{installPrompt ? <Button size="small" onClick={async () => { await installPrompt.prompt(); setInstallPrompt(null); }}>Pasang Bagiyuk</Button> : <small>Untuk memasang aplikasi, pilih “Tambahkan ke layar utama” dari menu browser.</small>}</div>}
    {displayHero && <section className={`hero ${screen === 'home' ? 'hero-home' : 'hero-compact'}`} aria-label="Momen patungan bersama teman">
      {screen === 'home' && <div className="hero-copy"><span className="eyebrow"><span /> MAKAN BARENG, BAYAR TENANG</span><h1>Patungan?<br /><span>Bagiyuk.</span><Sparkles className="hero-sparkle" size={28} strokeWidth={1.5} /></h1><p><br /></p></div>}
      <img className="hero-image" src="/cafe-hero.webp" alt="Tiga teman menikmati makanan dan kopi bersama di café" />
      {screen === 'home' && <div className="hero-label"><Heart size={12} fill="currentColor" /> Bagi tagihan, bukan pertemanan.</div>}
    </section>}
    <div className={`page-content ${displayHero ? 'over-hero' : ''}`}>
      {screen === 'home' && <>
        <div className="drag-handle" /><div className="section-heading start-heading"><h2>Mulai patungan</h2><span className="tiny-label">Tanpa daftar, langsung beres</span></div>
        <div className="action-grid"><button className="action-card" onClick={() => start('scan')}><div className="action-art scan-art"><div className="mini-receipt"><span /><span /><span /><b>Rp</b><Check size={12} /></div><ScanLine className="scan-corners" size={67} strokeWidth={1.3} /><span className="art-star">✦</span><span className="ai-pill"><Sparkles size={10} /> AI SCAN</span></div><div className="action-copy"><strong>Foto struk</strong><span>Jepret, langsung kebaca<ArrowRight size={16} /></span></div></button>
        <button className="action-card" onClick={() => start('create')}><div className="action-art manual-art"><div className="mini-phone"><span /><span /><span /><span className="phone-button" /></div><Pencil className="art-pencil" size={44} strokeWidth={1.8} /><span className="art-star">✦</span><span className="manual-squiggle">〰</span></div><div className="action-copy"><strong>Tulis manual</strong><span>Isi sendiri, tetap simpel<ArrowRight size={16} /></span></div></button></div>
        {b && !history.some(h => h.id === b.id) && <button className="draft-card" onClick={continueDraft}><ReceiptText size={21} /><div className="grow"><strong>Lanjutkan drafmu</strong><small>{b.name || 'Patungan baru'} · {b.items.length} item</small></div><ChevronRight size={18} /></button>}
        <div className="how-it-works"><div><span>1</span>Tambah tagihan</div><i /><div><span>2</span>Pilih teman</div><i /><div><span>3</span>Bagi, beres!</div></div>
        <div className="section-heading history-heading"><h2>Patungan terakhir</h2><button className="text-link" onClick={() => nav('history')}>Lihat semua <ArrowRight size={15} /></button></div>
        {renderHistory(history.slice(0, 2))}
        <button className="demo-card" onClick={demo}><span className="demo-icon"><Coffee size={21} /></span><span><strong>Pertama kali pakai Bagiyuk?</strong><small>Coba bagi tagihan kopi bareng, yuk.</small></span><ArrowRight className="demo-arrow" size={18} /></button>
        <div className="privacy-note"><ShieldCheck size={14} /> Tanpa akun. Data tetap di perangkatmu.</div>
      </>}
      {screen === 'create' && b && <>
        <div className="drag-handle" /><div className="step-label"><span>01</span> TAGIHANNYA DULU <span className="step-dots"><i className="active" /><i /><i /></span></div>
        {receiptNote && <div className="info-message"><Sparkles size={17} /><span>{receiptNote}</span></div>}
        <label className="bill-name">Nama tagihan<input maxLength={80} placeholder="Makan bareng di mana?" value={b.name} onChange={e => update({ name: e.target.value })} /></label>
        <button className="field-link" onClick={() => nav('items')}><ReceiptText size={18} /><span>{b.items.length ? `${b.items.length} item ditambahkan` : 'Tambah item pesanan'}</span><ChevronRight size={18} /></button>
        <div className="total-card"><span>Total tagihan</span><strong>{rupiah(total(b))}</strong><small>{itemCount} item <span>•</span> Sudah termasuk biaya tambahan</small></div>
        {receiptTotal !== null && <div className={`info-message ${receiptTotal !== total(b) ? 'warning-message' : ''}`}><ReceiptText size={17} /><span>Total di struk: <strong>{rupiah(receiptTotal)}</strong>{receiptTotal !== total(b) && '. Belum cocok. Periksa item dan biaya tambahan.'}</span></div>}
        <section className="form-card"><div className="section-heading"><h3>Kategori</h3><span className="subtle">Pilih satu</span></div><div className="category-grid">{categories.map(({ name, icon: Icon }) => <button key={name} className={`chip ${b.category === name ? 'selected' : ''}`} aria-pressed={b.category === name} onClick={() => update({ category: name })}><Icon size={16} />{name}</button>)}</div></section>
        <button className="field-link friend-link" onClick={() => nav('friends')}><AvatarStack people={b.people} /><span>{b.people.length > 1 ? `${b.people.length} teman patungan` : 'Tambah teman'}</span><ChevronRight size={18} /></button>
        <details className="adjustments"><summary><span>Diskon & biaya tambahan</span><ChevronDown size={17} /></summary><p>Masukkan nominal rupiah sesuai struk. Biaya dibagi proporsional.</p><div className="field-pair">{(['tax', 'service', 'discount', 'tip', 'rounding'] as const).map((key, i) => <label key={key}>{['Pajak (Rp)', 'Service (Rp)', 'Diskon tagihan (Rp)', 'Tip (Rp)', 'Pembulatan (+/− Rp)'][i]}<input aria-label={['Pajak', 'Service', 'Diskon tagihan', 'Tip', 'Pembulatan'][i]} type="number" min={key === 'rounding' ? -10000 : 0} max={key === 'rounding' ? 10000 : 1_000_000_000} step="1" value={b[key]} onChange={e => { const n = Number(e.target.value); if (Number.isSafeInteger(n) && n >= (key === 'rounding' ? -10000 : 0) && n <= (key === 'rounding' ? 10000 : 1_000_000_000)) update({ [key]: n }); }} /></label>)}</div></details>
        <Bottom><Button className="full-width" disabled={!b.name.trim() || !b.items.length || total(b) < 0 || b.discount > subtotal(b)} onClick={() => nav('split')}>Lanjut bagi tagihan <ArrowRight size={18} /></Button><span className="bottom-hint">Selanjutnya: siapa pesan apa?</span></Bottom>
      </>}
      {screen === 'items' && b && <>
        <div className="drag-handle" /><div className="section-heading"><h2>Pesan apa aja?</h2><span className="count-pill">{b.items.length} item</span></div><p className="section-description">Tulis pesanan dan harga satuannya, ya.</p>
        {b.items.length ? <div className="items-list">{b.items.map(item => <div className="item-card" key={item.id}><button className="item-edit-button" onClick={() => setEditor(item)}><div><strong>{item.name}</strong><small>{item.quantity} × {rupiah(item.price)}{item.discount > 0 && ` − ${rupiah(item.discount)}`}</small></div><strong>{rupiah(itemTotal(item))}</strong></button><button className="remove-item" aria-label={`Hapus ${item.name}`} onClick={() => update({ items: b.items.filter(i => i.id !== item.id) })}><Trash2 size={15} /></button></div>)}</div> : <Empty title="Mejanya masih kosong" icon={<Utensils />}>Dari kopi sampai kentang sharing,<br />masukkan semua pesanannya di sini.</Empty>}
        <button className="add-dashed" disabled={b.items.length >= 100} onClick={() => setEditor('new')}><CirclePlus size={18} /> Tambah item</button>
        <div className="subtotal-row"><span>Subtotal</span><strong>{rupiah(subtotal(b))}</strong></div>
        <Bottom><Button className="full-width" disabled={!b.items.length} onClick={() => nav('create')}>Simpan {b.items.length || ''} item <Check size={18} /></Button></Bottom>
      </>}
      {screen === 'friends' && b && <>
        <div className="drag-handle" /><div className="section-heading"><h2>Siapa aja yang ikut?</h2><span className="count-pill">{b.people.length}/8</span></div><p className="section-description">Ajak teman satu meja. Tanpa nomor HP juga bisa.</p>
        <div className="people-list">{b.people.map((person, i) => <PersonRow key={person.id} person={person} index={i} isHost={b.host === person.id} onChange={p => update({ people: b.people.map(v => v.id === p.id ? p : v) })} onHost={() => update({ host: person.id })} onRemove={() => { if (b.people.length === 1) { setNotice('Minimal satu peserta harus ada.'); return; } const people = b.people.filter(p => p.id !== person.id); update({ people, host: b.host === person.id ? people[0].id : b.host, items: b.items.map(item => ({ ...item, assigned: item.assigned.filter(p => p !== person.id) })) }); }} />)}</div>
        <form className="add-friend-form" onSubmit={e => { e.preventDefault(); if (friendName.trim() && b.people.length < 8) { update({ people: [...b.people, { id: id(), name: friendName.trim(), phone: '' }] }); setFriendName(''); } }}><label htmlFor="friend-name">Tambah teman</label><div className="row"><input id="friend-name" placeholder="Nama temanmu" maxLength={40} value={friendName} onChange={e => setFriendName(e.target.value)} required disabled={b.people.length >= 8} /><Button type="submit" size="icon" aria-label="Tambahkan teman" disabled={b.people.length >= 8}><Plus /></Button></div></form>
        <div className="info-message"><Wallet size={18} /><span><strong>{b.people.find(p => p.id === b.host)?.name}</strong> bayar duluan. Teman-teman bisa transfer sesuai hasil patungan.</span></div>
        <Bottom><Button className="full-width" onClick={() => nav('create')}>Simpan teman <Check size={18} /></Button></Bottom>
      </>}
      {screen === 'scan' && <>
        <div className="scan-intro"><span className="scan-badge"><Sparkles size={15} /> DIBANTU AI</span><h2>Foto struk,<br /><span>sisanya biar kami.</span></h2><p>Satu foto untuk semua pesanan.<br />Tetap bisa kamu cek dan edit lagi.</p></div>
        <div className={`scan-frame ${busy ? 'is-scanning' : ''}`}>{preview ? <img src={preview} alt="Foto struk yang dipilih" /> : <><ReceiptText size={80} strokeWidth={1} /><strong>Struknya taruh di sini</strong><span>JPG, PNG, atau WebP · maks. 8 MB</span></>}{busy && <div className="scan-overlay"><LoaderCircle className="spin" size={30} /><strong>Lagi baca strukmu...</strong><span>Tunggu sebentar, ya.</span></div>}<i /><i /><i /><i /></div>
        <div className="scan-tips"><span><Check size={14} /> Foto dari atas</span><span><Check size={14} /> Tulisan jelas</span><span><Check size={14} /> Tanpa bayangan</span></div>
        {scanError && <div className="error-message" role="alert">{scanError}</div>}
        <div className="scan-actions"><Button className="full-width" disabled={busy} onClick={() => cameraInput.current?.click()}><Camera size={20} /> Ambil foto struk</Button><Button variant="outline" className="full-width" disabled={busy} onClick={() => fileInput.current?.click()}><ImagePlus size={19} /> Pilih dari galeri</Button><button className="text-link" onClick={() => { request.current?.abort(); if (!b) store.start(); nav('create'); }}>Atau, tulis manual aja <ArrowRight size={16} /></button></div>
        <input hidden ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => scan(e.target.files?.[0])} /><input hidden ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => scan(e.target.files?.[0])} />
        <div className="privacy-note"><ShieldCheck size={15} /><span>Foto diproses oleh Google Gemini.<br />Tidak disimpan dalam riwayat Bagiyuk.</span></div>
      </>}
      {screen === 'split' && b && <>
        <div className="drag-handle" /><div className="step-label"><span>02</span> SIAPA PESAN APA? <span className="step-dots"><i /><i className="active" /><i /></span></div>
        <div className="section-heading"><h2>Detail patungan</h2><button className="text-link" onClick={() => nav('friends')}><Pencil size={14} /> Edit teman</button></div>
        <div className="split-summary"><div><small>{b.name}</small><strong>{rupiah(total(b))}</strong><span>{b.equal || unassigned === 0 ? 'Semua item sudah kebagian' : `${unassigned} item belum dipilih`}</span></div><span className="summary-receipt"><ReceiptText size={49} strokeWidth={1.3} /><span><Check size={15} /></span></span></div>
        <div className="equal-row"><div><strong>Bagi rata</strong><small>Semua dapat bagian yang sama</small></div><button className={`toggle ${b.equal ? 'on' : ''}`} role="switch" aria-checked={b.equal} aria-label="Bagi rata" onClick={() => update({ equal: !b.equal })}><span /></button></div>
        {!b.equal && <><div className="section-heading"><h3>Pilih yang pesan</h3><span className="subtle">Boleh lebih dari satu</span></div><div className="assign-list">{b.items.map(item => <div className="assign-card" key={item.id}><div className="section-heading"><div><strong>{item.name}</strong><small>{item.quantity} item · {rupiah(itemTotal(item))}</small></div>{item.assigned.length > 0 && <CheckCheck size={18} className="purple" />}</div><div className="assign-people">{b.people.map((p, i) => <button aria-pressed={item.assigned.includes(p.id)} className={`person-chip ${item.assigned.includes(p.id) ? 'selected' : ''}`} key={p.id} onClick={() => update({ items: b.items.map(it => it.id === item.id ? { ...it, assigned: it.assigned.includes(p.id) ? it.assigned.filter(x => x !== p.id) : [...it.assigned, p.id] } : it) })}><Avatar person={p} index={i} small />{p.name}{item.assigned.includes(p.id) && <Check size={12} />}</button>)}</div>{item.assigned.length > 1 && <small className="shared-note">Dibagi bersama {item.assigned.length} orang</small>}</div>)}</div></>}
        {!calculationError && <div className="split-preview">{rows.map((p, i) => <div className="row" key={p.id}><Avatar person={p} index={i} /><span className="grow">{p.name}</span><strong>{rupiah(p.amount)}</strong></div>)}</div>}
        <Bottom>{calculationError && <p className="bottom-hint">{calculationError}</p>}<Button className="full-width" disabled={!!calculationError} onClick={() => { try { setViewedBill(null); store.save(); nav('result', b.id); } catch (e) { setNotice(e instanceof Error ? e.message : 'Gagal menghitung.'); } }}>Lihat hasil patungan <ArrowRight size={18} /></Button></Bottom>
      </>}
      {screen === 'result' && b && !calculationError && <>
        <div className="success-heading"><span className="success-mark"><CheckCheck size={33} /><i>✦</i></span><h2>Beres, tinggal transfer!</h2><p>Makannya bareng, bayarnya sesuai porsi.</p></div>
        <div className="result-receipt"><div className="result-title"><span className="receipt-brand">bagiyuk.</span><h3>{b.name}</h3><p>{new Date(b.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} · {b.people.length} orang</p></div><div className="receipt-total"><span>Total patungan</span><strong>{rupiah(total(b))}</strong><span className="status"><Check size={12} /> Semua sudah pas</span></div><div className="receipt-breakdown">{[['Subtotal', subtotal(b)], ['Pajak', b.tax], ['Service', b.service], ['Diskon', -b.discount], ['Tip', b.tip], ['Pembulatan', b.rounding]].filter(([, n], i) => i === 0 || n !== 0).map(([label, n]) => <div key={label}><span>{label}</span><span>{rupiah(Number(n))}</span></div>)}</div><div className="payer"><Wallet size={17} /><span>Dibayar dulu oleh <strong>{b.people.find(p => p.id === b.host)?.name}</strong></span></div></div>
        <div className="section-heading"><h2>Bagian masing-masing</h2><span className="count-pill">{rows.length} orang</span></div><div className="result-people">{rows.map((p, i) => <details className="result-person" key={p.id}><summary><Avatar person={p} index={i} /><div className="grow"><strong>{p.name}</strong><small>{p.id === b.host ? 'Bayar duluan' : `${p.items.length} item${b.equal ? ' · bagi rata' : ''}`}</small></div><strong>{rupiah(p.amount)}</strong><ChevronDown size={16} /></summary><div className="person-breakdown">{p.items.map(item => <div key={item.id}><span>{item.name}{b.equal || item.assigned.length > 1 ? ' (berbagi)' : ''}</span></div>)}<div><span>Subtotal bagianmu</span><span>{rupiah(p.subtotal)}</span></div><div><span>Pajak & service</span><span>{rupiah(p.tax + p.service)}</span></div>{p.discount !== 0 && <div><span>Diskon</span><span>{rupiah(p.discount)}</span></div>}{p.tip !== 0 && <div><span>Tip</span><span>{rupiah(p.tip)}</span></div>}{p.rounding !== 0 && <div><span>Penyesuaian rupiah</span><span>{rupiah(p.rounding)}</span></div>}</div></details>)}</div>
        <div className="share-actions"><Button variant="outline" onClick={() => share(true)}><Copy size={17} /> Salin teks</Button><Button variant="outline" onClick={saveImage}><Download size={17} /> Simpan gambar</Button></div>
        <div className="privacy-note"><ShieldCheck size={14} />{store.storageError ? 'Hasil belum tersimpan. Salin atau unduh dulu.' : 'Tersimpan di riwayat perangkatmu.'}</div>
        <Bottom><Button className="full-width" onClick={() => share()}><Share2 size={18} /> Bagikan hasil</Button><button className="text-link done-link" onClick={() => { if (store.draft?.id === b.id) store.clearDraft(); setViewedBill(null); nav('home'); }}>Selesai, kembali ke beranda</button></Bottom>
      </>}
      {screen === 'result' && calculationError && <Empty title="Tagihan belum lengkap">{calculationError}<Button className="full-width" onClick={() => nav('create')}>Lengkapi tagihan</Button></Empty>}
      {screen === 'result' && !b && <Empty title="Pilih patunganmu dulu">Buka tagihan yang tersimpan di riwayat.<Button className="full-width" onClick={() => nav('history')}>Buka riwayat</Button></Empty>}
      {screen === 'history' && <><div className="history-intro"><span className="eyebrow">MOMEN BARENGMU</span><h2>Sudah dibagi,<br /><span>tinggal dikenang.</span></h2><p>Semua patungan, tersimpan di satu tempat.</p></div><div className="history-stats"><span><strong>{history.length}</strong>Patungan selesai</span><span><strong>{rupiah(history.reduce((s, b) => s + total(b), 0))}</strong>Total dibagi</span></div><div className="section-heading"><h3>Semua patungan</h3><span className="subtle">Terbaru dulu</span></div>{renderHistory(history)}<Button variant="outline" className="full-width new-history" onClick={() => start('create')}><Plus size={18} /> Buat patungan baru</Button></>}
    </div>
    {(screen === 'home' || screen === 'history') && <nav className="bottom-nav" aria-label="Navigasi utama"><button className={screen === 'home' ? 'active' : ''} onClick={() => nav('home')} aria-current={screen === 'home' ? 'page' : undefined}><Home size={21} /><span>Beranda</span></button><button className="nav-create" onClick={() => start('create')} aria-label="Buat patungan baru"><Plus size={25} /></button><button className={screen === 'history' ? 'active' : ''} onClick={() => nav('history')} aria-current={screen === 'history' ? 'page' : undefined}><History size={21} /><span>Riwayat</span></button></nav>}
    {editor && b && <ItemEditor item={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSave={item => { update({ items: editor === 'new' ? [...b.items, item] : b.items.map(i => i.id === item.id ? item : i) }); setEditor(null); }} />}
    {notice && <div className="toast" role="status"><Check size={18} />{notice}<button onClick={() => setNotice('')} aria-label="Tutup pesan"><X size={16} /></button></div>}
    {store.storageError && <div className="storage-error" role="alert">{store.storageError}</div>}
    {!store.ready && <div className="splash"><span className="brand">bagiyuk.</span><p>Patungan jadi gampang.</p><LoaderCircle className="spin" /></div>}
  </main>;
}


