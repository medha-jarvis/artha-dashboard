import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Artha — Personal Finance Dashboard',
  description: 'Portfolio analytics and personal finance command centre',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full">
      <body className="min-h-full bg-slate-950 antialiased">{children}</body>
    </html>
  );
}
