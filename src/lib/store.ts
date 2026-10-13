'use client';
import { create } from 'zustand';
import { billSchema, draftSchema, calculate, freshBill, type Bill } from './bill';
type Store = { draft: Bill | null; history: Bill[]; ready: boolean; storageError: string; hydrate: () => void; start: () => void; update: (patch: Partial<Bill>) => void; save: () => boolean; clearDraft: () => void };
const KEY = 'bagiyuk.v1';
let storageBlocked = false;
function persist(draft: Bill | null, history: Bill[]): string {
  if (storageBlocked) return 'Data lokal lama tidak bisa dibaca dan tidak ditimpa. Unduh hasil baru sebelum menutup aplikasi.';
  try { localStorage.setItem(KEY, JSON.stringify({ draft, history })); return ''; }
  catch { return 'Penyimpanan perangkat penuh atau tidak tersedia. Salin hasil sebelum menutup aplikasi.'; }
}
export const useBills = create<Store>((set, get) => ({
  draft: null, history: [], ready: false, storageError: '',
  hydrate: () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { set({ ready: true }); return; }
      const data = JSON.parse(raw);
      if (!Array.isArray(data.history)) throw new Error();
      const history = data.history.map((b: unknown) => billSchema.parse(b));
      history.forEach(calculate);
      let draft: Bill | null = null;
      if (data.draft) draft = draftSchema.parse(data.draft);
      set({ history, draft, ready: true });
    } catch { storageBlocked = true; set({ ready: true, storageError: 'Data lokal lama tidak bisa dibaca dan tidak ditimpa. Unduh hasil baru sebelum menutup aplikasi.' }); }
  },
  start: () => { const draft = freshBill(); set({ draft, storageError: persist(draft, get().history) }); },
  update: patch => { const draft = { ...(get().draft ?? freshBill()), ...patch }; set({ draft, storageError: persist(draft, get().history) }); },
  save: () => { const draft = get().draft; if (!draft) return false; calculate(draft); const history = [draft, ...get().history.filter(b => b.id !== draft.id)]; const storageError = persist(draft, history); set({ history, storageError }); return !storageError; },
  clearDraft: () => set({ draft: null, storageError: persist(null, get().history) }),
}));
