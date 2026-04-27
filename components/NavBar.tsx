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
    // pt-[env(safe-area-inset-top)] keeps interactive content out of the iOS
    // notch / dynamic island area while letting the bg/border extend full-width
    // behind it (we use viewport-fit=cover in app/layout.tsx). On non-notched
    // devices env() returns 0 so this is a no-op.
    <header
      className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <nav
        aria-label="Primary"
        // Tighter gaps + horizontal padding on the smallest viewports (≈320 px)
        // so brand + 3 nav links fit without wrapping. The brand's hidden
        // tagline at sm reclaims the space on tablet+.
        // Horizontal env() insets handle iPhone landscape where the notch eats
        // a few pixels of horizontal space.
        className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6"
        style={{
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        }}
      >
        <Link
          href="/"
          // min-w-0 + truncate on the inner span so an unexpectedly long
          // brand string can't push the nav off-screen.
          className="flex min-w-0 items-center gap-2 rounded text-base font-semibold tracking-tight text-ink hover:text-accent"
          aria-label="HRR Betting — home"
        >
          <span aria-hidden="true" className="shrink-0 text-tracked">●</span>
          <span className="truncate">HRR</span>
          <span className="hidden text-ink-muted sm:inline" aria-hidden="true">·</span>
          <span className="hidden truncate text-sm font-normal text-ink-muted sm:inline">
            Hits + Runs + RBIs
          </span>
        </Link>

        <ul className="flex shrink-0 items-center gap-0.5 text-sm sm:gap-1">
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
                  // h-10 (40px) instead of h-9 to clear the recommended touch
                  // target. Reduced horizontal padding on mobile so all three
                  // links fit on a 320px viewport alongside the brand.
                  className={
                    'inline-flex h-10 items-center rounded-md px-2.5 text-[13px] transition-colors sm:px-3 sm:text-sm ' +
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
