'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavLink {
  href: string
  label: string
}

const LINKS: NavLink[] = [
  { href: '/', label: 'Board' },
  { href: '/history', label: 'History' },
  { href: '/methodology', label: 'Methodology' },
]

/**
 * Persistent top navigation. Rendered once in the root layout so every page
 * gets the same nav without each page rolling its own header link strip.
 */
export function NavBar() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
      >
        <Link
          href="/"
          className="flex items-center gap-2 rounded text-base font-semibold tracking-tight text-ink hover:text-accent"
          aria-label="HRR Betting — home"
        >
          <span aria-hidden="true" className="text-tracked">●</span>
          <span>HRR</span>
          <span className="hidden text-ink-muted sm:inline" aria-hidden="true">·</span>
          <span className="hidden text-sm font-normal text-ink-muted sm:inline">
            Hits + Runs + RBIs
          </span>
        </Link>

        <ul className="flex items-center gap-1 text-sm">
          {LINKS.map(link => {
            const active =
              link.href === '/'
                ? pathname === '/'
                : pathname === link.href || pathname.startsWith(`${link.href}/`)
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'inline-flex h-9 items-center rounded-md px-3 transition-colors ' +
                    (active
                      ? 'bg-card text-ink'
                      : 'text-ink-muted hover:bg-card/60 hover:text-ink')
                  }
                >
                  {link.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </header>
  )
}
