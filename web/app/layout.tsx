import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'PolyPharmGuard — Clinical Medication Safety',
  description: 'AI-powered polypharmacy reasoning engine',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-gray-950 text-gray-100 min-h-screen`}>
        <nav className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">Rx</div>
            <span className="font-semibold text-lg">PolyPharmGuard</span>
          </Link>
          <span className="text-xs text-gray-500">Clinical Medication Safety Engine</span>
          <div className="ml-auto flex items-center gap-6 text-sm">
            <Link href="/review/mrs-johnson" className="text-gray-400 hover:text-white transition-colors">Demo Review</Link>
            <Link href="/batch" className="text-gray-400 hover:text-white transition-colors">Review Queue</Link>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
