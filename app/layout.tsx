import type { Metadata, Viewport } from 'next'
import { NavBar } from '@/components/NavBar'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'HRR Betting',
    template: '%s — HRR Betting',
  },
  description:
    'Daily MLB Hits + Runs + RBIs prop ranker with auto-tracked picks and rolling calibration metrics.',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = {
  themeColor: '#0a0a0c',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <a href="#main" className="skip-link">Skip to main content</a>
        <NavBar />
        <div id="main">{children}</div>
      </body>
    </html>
  )
}
