import type { Metadata, Viewport } from 'next'
import { NavBar } from '@/components/NavBar'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'HRR Betting',
    template: 'HRR Betting — %s',
  },
  description:
    'Daily MLB Hits + Runs + RBIs prop ranker with auto-tracked picks and rolling calibration metrics.',
}

export const viewport: Viewport = {
  themeColor: '#0a0a0c',
  colorScheme: 'dark',
  // viewport-fit=cover + globals.css env(safe-area-inset-*) lets content
  // extend under iOS notches / home indicators while keeping interactive
  // controls outside the unsafe area.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* min-h-dvh (dynamic viewport) instead of min-h-screen — on mobile
          Safari, 100vh is the *largest* viewport (URL bar collapsed) which
          causes content to extend below the actual visible area; 100dvh
          tracks the current visible viewport and resizes as the URL bar
          appears/disappears. */}
      <body className="min-h-dvh bg-bg font-sans text-ink antialiased">
        <a href="#main" className="skip-link">Skip to main content</a>
        <NavBar />
        <div id="main">{children}</div>
      </body>
    </html>
  )
}
