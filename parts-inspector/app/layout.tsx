import type { Metadata, Viewport } from 'next';

import './globals.css';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: '部品表面検査 | AI Surface Inspector',
  description: 'iPhone のカメラと Jev API で加工部品の表面キズ・欠陥を即時に良否判定する現場向け検査アプリ',
  manifest: '/manifest.webmanifest',
  applicationName: 'AI Surface Inspector',
  appleWebApp: {
    capable: true,
    title: '表面検査',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // ノッチ端末でも全画面を使う
  viewportFit: 'cover',
  themeColor: '#0a0d12',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-shop-bg font-sans antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
