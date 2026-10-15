import type { Metadata, Viewport } from 'next';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import './globals.css';
export const metadata: Metadata = { title: 'Bagiyuk — Patungan jadi gampang', description: 'Foto struk, pilih item, hitung bagian masing-masing. Patungan? Bagiyuk.', manifest: '/manifest.webmanifest', appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Bagiyuk' }, icons: { icon: { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }, apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' } } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#EDE8FF' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="id"><body>{children}</body></html>; }
