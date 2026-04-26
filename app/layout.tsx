import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HRR Betting',
  description: 'MLB Hits + Runs + RBIs prop ranker with auto-tracked picks',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  )
}
