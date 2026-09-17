import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'IntelliDesk — AI Employee Helpdesk',
  description:
    'IntelliDesk automatically receives employee requests, classifies them using AI, routes to the right department, manages approvals, assists engineers in resolving tickets, and builds a searchable knowledge base.',
  keywords: ['employee helpdesk', 'ticket management', 'approval workflow', 'knowledge base'],
  openGraph: {
    title: 'IntelliDesk — AI Employee Helpdesk',
    description: 'Smart helpdesk platform for modern enterprises.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
