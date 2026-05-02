"""Visual + overflow audit for /methodology at desktop, tablet, mobile widths."""
from playwright.sync_api import sync_playwright

VIEWPORTS = [
    ("desktop", 1440, 900),
    ("tablet", 820, 1180),
    ("mobile", 390, 844),
]


def check_overflow(page, label):
    """Look for any element causing horizontal scroll."""
    info = page.evaluate("""
() => {
  const docEl = document.documentElement;
  const body = document.body;
  const scrollWidth = Math.max(docEl.scrollWidth, body.scrollWidth);
  const clientWidth = Math.max(docEl.clientWidth, body.clientWidth);
  const overflow = scrollWidth > clientWidth + 1;
  const offenders = [];
  if (overflow) {
    document.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > clientWidth + 1) {
        offenders.push({
          tag: el.tagName,
          cls: el.className?.toString?.().slice(0, 80) || '',
          text: (el.textContent || '').trim().slice(0, 60),
          right: Math.round(r.right),
        });
      }
    });
  }
  return { scrollWidth, clientWidth, overflow, offenders: offenders.slice(0, 10) };
}
""")
    status = "OK" if not info["overflow"] else "OVERFLOW"
    print(f"[{label}] doc={info['clientWidth']}px scroll={info['scrollWidth']}px {status}")
    if info["offenders"]:
        print(f"  Top offenders:")
        for o in info["offenders"]:
            print(f"   - <{o['tag']}.{o['cls'][:50]}> right={o['right']} text={o['text']!r}")
    return info["overflow"]


def main():
    bad = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for label, w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h})
            page = ctx.new_page()
            page.goto("http://localhost:3000/methodology", wait_until="networkidle")
            page.wait_for_timeout(400)
            if check_overflow(page, label):
                bad.append(label)
            page.screenshot(
                path=f"C:/Users/lucas/dev/hrr-betting/.next/methodology-{label}.png",
                full_page=True,
            )
            ctx.close()
        # Also verify the board page didn't regress
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto("http://localhost:3000/", wait_until="networkidle")
        page.wait_for_timeout(800)
        if check_overflow(page, "board-desktop"):
            bad.append("board-desktop")
        ctx.close()
        browser.close()
    if bad:
        print(f"\nFAIL: overflow at {bad}")
        raise SystemExit(1)
    print("\nALL VIEWPORTS CLEAN")


if __name__ == "__main__":
    main()
