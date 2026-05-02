export const metadata = {
  title: 'Methodology',
  description: 'How the HRR Betting model actually works — every factor, every formula, traced to the code.',
}

export default function Methodology() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Methodology</h1>
        <p className="max-w-2xl text-sm text-ink-muted">
          What the board ranks, how each number is built, and where it comes from in the
          code. Plain English first; formulas and source files alongside.
        </p>
      </header>

      <Section heading="What the board ranks" eyebrow="Overview">
        <p>
          Every row is a single prop bet — one batter, one rung. The board ranks every
          (player, rung) combination from the day&apos;s slate by{' '}
          <Code>Score</Code>, a Kelly bet fraction × confidence number that answers
          &ldquo;how much would Kelly bet on this at the model&apos;s fair-typical odds,
          weighted by data quality.&rdquo;
        </p>
        <p>
          Three rungs per player: <Code>1+</Code>, <Code>2+</Code>, <Code>3+ HRR</Code>{' '}
          where HRR = Hits + Runs + RBIs over the player&apos;s full game. A solo home
          run alone is +1H +1R +1RBI = 3 HRR.
        </p>
      </Section>

      <Section heading="The two probabilities" eyebrow="Core model">
        <Grid>
          <Card title="p̂ typical" subtitle="Offline baseline">
            <p>
              The player&apos;s baseline probability of clearing the rung in their{' '}
              <em>typical</em> matchup — what the line should price purely from skill.
            </p>
            <Note label="How it&apos;s computed">
              A 20,000-iteration Monte Carlo simulates a full 9-inning game with the
              target batter at lineup slot 4 and 17 league-average teammates and
              opponents. The batter&apos;s outcome rates come from full-season counts,
              regressed via empirical stabilization (Russell Carleton sample sizes)
              toward the player&apos;s own career rates when ≥ 200 career PAs exist —
              league averages otherwise. Career prior preserves true skill differences
              in early-season samples.
            </Note>
            <Note label="Where">
              <FilePath>lib/p-typical.ts</FilePath> · sim engine{' '}
              <FilePath>lib/offline-sim/sim.ts</FilePath>
            </Note>
            <Note label="When">
              Recomputed weekly (Sunday 4 AM ET full sweep) and nightly (Mon–Sat 4 AM ET
              slate-batter sweep). Cached 14 days. The request path only reads cache —
              never recomputes — so it stays sub-millisecond.
            </Note>
          </Card>

          <Card title="p̂ today" subtitle="Closed-form, request-time">
            <p>
              The probability after applying today&apos;s matchup factors. Computed on
              every page load — no per-game simulation at request time.
            </p>
            <Note label="How it&apos;s computed">
              Odds-ratio composition. Convert <Code>p̂ typical</Code> to odds, multiply
              by the product of all factors (clamped overall), convert back to
              probability. This keeps the result bounded below 1 no matter how many
              factors compound — the standard fix for &ldquo;multiplying probabilities
              breaks past 0.5.&rdquo;
            </Note>
            <Formula>
              {`factorProduct = clamp(pitcher × park × weather × handedness
                                × bullpen × paCount, 0.25, 4.0)
oddsTypical   = p̂_typical / (1 − p̂_typical)
oddsToday     = oddsTypical × factorProduct
p̂_today       = oddsToday / (1 + oddsToday)`}
            </Formula>
            <Note label="Where">
              <FilePath>lib/prob-today.ts</FilePath>
            </Note>
          </Card>
        </Grid>
      </Section>

      <Section heading="The six factors" eyebrow="What changes p̂ today vs p̂ typical">
        <p className="text-sm text-ink-muted">
          Each factor is a single multiplier with its own clamp. Hover any row for the
          source file.
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-card/50 text-left text-xs uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="px-3 py-2">Factor</th>
                  <th scope="col" className="px-3 py-2">Range</th>
                  <th scope="col" className="px-3 py-2">What it captures</th>
                </tr>
              </thead>
              <tbody className="text-ink-subtle">
                <FactorRow
                  name="Pitcher"
                  range="0.50 – 2.00"
                  source="lib/factors/pitcher.ts"
                  desc="Stabilized K%, BB%, HR%, hard-hit% vs league averages combined into a single quality multiplier. TBD starter or fewer than 3 recent starts → 1.0 (neutral)."
                />
                <FactorRow
                  name="Park"
                  range="0.70 – 1.30"
                  source="lib/factors/park.ts"
                  desc="FanGraphs 2025 per-handedness park factors blended into one composite: 50% hits, 25% runs, 25% HR. Switch hitters get the L/R average. Unknown venues → 1.0."
                />
                <FactorRow
                  name="Weather"
                  range="0.85 – 1.20"
                  source="lib/factors/weather.ts"
                  desc="Temp + wind projected onto the home → CF axis, dampened by 0.6× since most HRR is singles (less weather-sensitive than HR). Domes and failed forecasts → 1.0."
                />
                <FactorRow
                  name="Handedness"
                  range="0.97 / 1.00 / 1.03"
                  source="lib/factors/handedness.ts"
                  desc="Same-side platoon disadvantage 0.97; opposite-side advantage 1.03; switch hitter neutral 1.00."
                />
                <FactorRow
                  name="Bullpen"
                  range="0.85 – 1.15"
                  source="lib/factors/bullpen.ts"
                  desc="Opponent team bullpen ERA stabilized vs league (4.20), scaled by the share of PAs the batter sees against the bullpen for their lineup slot (top of order sees less)."
                />
                <FactorRow
                  name="PA count"
                  range="0.85 – 1.15"
                  source="lib/factors/pa-count.ts"
                  desc="Corrects for slot-specific expected PAs vs league mean (4.20). Top-of-order batters get more swings; bottom-of-order get fewer. Bernoulli scaling on a per-PA HRR rate."
                />
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-ink-muted">
          The factor product is clamped to <Code>[0.25, 4.0]</Code> as a safety rail —
          one outlier input (e.g. a weird pitcher line from a tiny sample) can&apos;t
          drive a 6× swing on its own.
        </p>
      </Section>

      <Section heading="Edge & Score" eyebrow="What ranks the board">
        <Grid>
          <Card title="Edge" subtitle="How much better today is than typical">
            <Formula>
              {`edge = max(p̂_today, 0.01) / max(p̂_typical, 0.01) − 1`}
            </Formula>
            <p>
              Both numerator and denominator floored at 1% so two tiny probabilities
              don&apos;t produce a misleadingly huge edge. Positive: today is better
              than typical. Negative: today is worse.
            </p>
            <Note label="Where">
              <FilePath>lib/edge.ts:computeEdge</FilePath>
            </Note>
          </Card>

          <Card title="Score" subtitle="Kelly bet fraction × confidence">
            <Formula>
              {`kelly = (p̂_today − p̂_typical) / max(1 − p̂_typical, 0.01)
score = kelly × confidence`}
            </Formula>
            <p>
              Reads as &ldquo;what fraction of bankroll Kelly would bet on this at fair
              typical odds, scaled by how much we trust the inputs.&rdquo; Score × 100
              is the displayed number on the board.
            </p>
            <Note label="Why Kelly, not relative edge">
              Relative edge scales with rarity, so 3+ HRR longshots (typical ≈ 10%)
              trivially produce huge edges and would dominate the board. Kelly&apos;s
              <Code>(1 − p̂ typical)</Code> denominator flips the bias — high-prob
              plays where you can win a lot of bets get rewarded, longshot variance
              gets sized down.
            </Note>
          </Card>
        </Grid>
      </Section>

      <Section heading="Confidence" eyebrow="Data-quality multiplier">
        <p>
          A product of eight multiplicative factors. Each clamped on its own. Together
          they cap at 1.00 (best) and bottom around 0.55 in the worst realistic case.
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border bg-card/50 text-left text-xs uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="px-3 py-2">Factor</th>
                  <th scope="col" className="px-3 py-2">Mapping</th>
                </tr>
              </thead>
              <tbody className="text-ink-subtle">
                <ConfRow factor="Lineup status" mapping="confirmed 1.00 / partial 0.85 / estimated 0.70" />
                <ConfRow factor="BvP sample size" mapping="0.90 at 0 AB → 1.00 at ≥20 AB (linear)" />
                <ConfRow factor="Pitcher start sample" mapping="0.90 at ≤3 starts → 1.00 at ≥10 starts" />
                <ConfRow factor="Weather stability" mapping="stable 1.00 / volatile 0.90" />
                <ConfRow factor="Time to first pitch" mapping="1.00 ≤ 90 min → 0.95 ≥ 4 hrs" />
                <ConfRow factor="Opener flag" mapping="normal 1.00 / opener 0.90" />
                <ConfRow factor="Batter season PA" mapping="0.85 at 0 PA → 1.00 at ≥200 PA" />
                <ConfRow factor="Data freshness" mapping="1.00 ≤ 5 min stale → 0.90 ≥ 30 min stale" />
              </tbody>
            </table>
          </div>
        </div>
        <Note label="Where">
          <FilePath>lib/confidence.ts:computeConfidenceBreakdown</FilePath>
        </Note>
        <p className="text-xs text-ink-muted">
          BvP only enters confidence — it doesn&apos;t adjust the per-PA rate
          distribution. The three signal-derived factors come from the ranker:
          weather stability flips false when the HR multiplier moves more than ±10%
          off neutral; opener fires when the listed starter has averaged under 2 IP
          across recent starts; freshness reads schedule-cache age (the canonical
          live-state signal — short TTL, ramps confidence down if the cron stops
          hitting <Code>/api/refresh</Code>).
        </p>
      </Section>

      <Section heading="Tracked vs Other plays" eyebrow="Tier classification">
        <p>
          A pick is <span className="font-medium text-tracked">🎯 Tracked</span> only
          when all three floors clear:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-sm marker:text-ink-muted">
          <li><Code>confidence ≥ 0.85</Code></li>
          <li><Code>edge ≥ floor(rung)</Code> — 0.10 / 0.30 / 0.60 for 1+ / 2+ / 3+</li>
          <li><Code>p̂ today ≥ floor(rung)</Code> — 0.85 / 0.55 / 0.20</li>
        </ul>
        <p className="text-sm text-ink-muted">
          Both the edge and probability floors must clear because each catches a
          different failure mode: a 30% prob at 3+ has huge relative edge but is still
          a coin-flip on the bad side; an Aaron Judge 1+ in a neutral matchup has high
          prob but no real edge.
        </p>
        <p>
          A pick that misses the Tracked thresholds but still has{' '}
          <Code>score ≥ 0.05</Code> shows under <em>Other plays</em>. Below that, the
          pick is dropped from the board. The board caps at 30 plays per slate via
          per-rung quotas (15 / 10 / 5) so 3+ longshots don&apos;t get crowded out by
          high-prob 1+ plays.
        </p>
        <Note label="Where">
          <FilePath>lib/ranker.ts:classifyTier</FilePath> ·{' '}
          <FilePath>lib/constants.ts</FilePath> (floors) ·{' '}
          <FilePath>components/Board.tsx</FilePath> (universe quotas)
        </Note>
        <p className="text-xs text-ink-muted">
          The tier floors are placeholders pending ≥30 days of settled history
          to recalibrate against.
        </p>
      </Section>

      <Section heading="American odds" eyebrow="What the secondary number on each prob means">
        <p>
          The <Code>−341</Code> next to <Code>p̂ typical</Code> 77.3% is the model&apos;s
          fair line at zero juice. Standard probability → moneyline conversion:
          favourites get a negative number, underdogs a positive. Beating the displayed
          line at a sportsbook means you&apos;re getting positive expected value{' '}
          <em>relative to the model</em>.
        </p>
        <Formula>
          {`p ≥ 0.5  →  odds = −round(100 × p / (1 − p))      (favourite)
p < 0.5  →  odds = +round(100 × (1 − p) / p)        (underdog)`}
        </Formula>
        <Note label="Where">
          <FilePath>components/PickRow.tsx:americanOdds</FilePath>
        </Note>
        <p className="text-xs text-ink-muted">
          The app does not ingest sportsbook lines. Implied probabilities and
          line-shopping are not part of the model — only the model&apos;s own
          probabilities translated into displayed odds.
        </p>
      </Section>

      <Section heading="Per-PA outcome model" eyebrow="Inside the offline sim">
        <p>
          For each plate appearance the simulator samples one of seven outcomes —{' '}
          <Code>1B / 2B / 3B / HR / BB / K / OUT</Code> — from the batter&apos;s
          stabilized rate distribution. The baserunner state machine
          (<FilePath>lib/offline-sim/baserunner.ts</FilePath>) advances bases and
          credits runs / RBIs realistically — a HR puts the batter and any baserunners
          across, a single can score a runner from second, etc.
        </p>
        <p>
          This per-PA approach captures the HR-trifecta correlation (a solo HR =
          +1 H, +1 R, +1 RBI all in one swing) that closed-form Poisson models
          systematically under-price for power hitters.
        </p>
        <Note label="Where">
          <FilePath>lib/offline-sim/sim.ts</FilePath>
        </Note>
        <p className="text-xs text-ink-muted">
          v1 simplifications: 9 innings only (no extras, ~&lt;0.5% impact on rung
          probabilities); no pitcher / park / weather / TTO inside the sim — those
          enter at the closed-form factor stage when computing today&apos;s probability.
        </p>
      </Section>

      <Section heading="Slate lifecycle" eyebrow="From compute to history">
        <ol className="ml-5 list-decimal space-y-2 text-sm marker:text-ink-muted">
          <li>
            <strong className="text-ink">Slate boundary.</strong> ET, 3 AM rollover —
            the standard DFS / sportsbook convention. A late-night PT game that
            finishes past midnight ET still belongs to the same slate.
          </li>
          <li>
            <strong className="text-ink">Compute.</strong> Sunday and Mon–Sat 4 AM ET
            crons warm the <Code>p̂ typical</Code> cache. The page itself runs the
            closed-form <Code>p̂ today</Code> on demand.
          </li>
          <li>
            <strong className="text-ink">Refresh.</strong> Every 2 minutes during
            slate hours, <Code>/api/refresh</Code> invalidates the page-level cache so
            the next request rebuilds picks with the latest schedule, lineups, and
            weather.
          </li>
          <li>
            <strong className="text-ink">Lock.</strong> Every 5 minutes during slate
            hours, <Code>/api/lock</Code> snapshots Tracked picks into the{' '}
            <Code>locked_picks</Code> table once a game&apos;s lock window opens —
            confirmed lineup ≤90 min before first pitch, or ≤30 min regardless.
            Insert-only: existing rows never change, but new Tracked picks added later
            in the slate (e.g. a 9 PM start whose lineup confirmed after the early
            cron) still land.
          </li>
          <li>
            <strong className="text-ink">Live.</strong> Once a game ends, the next
            refresh fetches its boxscore, sums Hits + Runs + RBIs for each tracked
            player, and stamps the row on the live board with{' '}
            <span className="text-hit">✓ HIT (n)</span> or{' '}
            <span className="text-miss">✗ MISS (n)</span>. <Code>FINAL · pending</Code>{' '}
            shows briefly in the gap between the schedule flipping to Final and the
            boxscore loading.
          </li>
          <li>
            <strong className="text-ink">Settle.</strong> 6 AM ET (10:00 UTC) daily,{' '}
            <Code>/api/settle</Code> reads the previous slate&apos;s{' '}
            <Code>locked_picks</Code>, fetches each boxscore, and upserts the canonical
            outcome into <Code>settled_picks</Code>. This is the canonical write — the
            live-board stamping is a UX preview; the daily settle is what feeds
            <Code>/history</Code>.
          </li>
        </ol>
      </Section>

      <Section heading="Caching — what&apos;s frozen and what isn&apos;t" eyebrow="So given picks don't shift mid-game">
        <p>
          Once a play is given, its inputs shouldn&apos;t change just because a stat
          ticked during the game. The cache layout enforces that:
        </p>
        <ul className="ml-5 list-disc space-y-1.5 text-sm marker:text-ink-muted">
          <li>
            <strong className="text-ink">Slate-aligned (24 h, frozen across the slate)</strong>{' '}
            — BvP, batter season stats, recent pitcher starts, batter game log,
            Statcast metrics, bullpen ERA. Cache key includes{' '}
            <Code>slateDateString()</Code> so today&apos;s mid-game ticks can&apos;t
            shift previously-given picks.
          </li>
          <li>
            <strong className="text-ink">Live state (2 min)</strong> — schedule, partial
            and estimated lineups. Game-status transitions (probable → confirmed,
            scheduled → live → final) propagate fast.
          </li>
          <li>
            <strong className="text-ink">Stable post-posting (6 h)</strong> — confirmed
            lineups, finalised boxscores. Once posted these don&apos;t change.
          </li>
          <li>
            <strong className="text-ink">Page cache (30 s)</strong> —{' '}
            <Code>picks:current:&#123;date&#125;</Code>. Covers a normal client poll
            interval without overloading the function on burst refreshes.
          </li>
        </ul>
      </Section>

      <Section heading="Data sources" eyebrow="Where the numbers come from">
        <ul className="ml-5 list-disc space-y-1.5 text-sm marker:text-ink-muted">
          <li>
            <ExtLink href="https://statsapi.mlb.com/">MLB Stats API</ExtLink> — schedule,
            lineups, batter season stats, batter game log, recent pitcher starts,
            BvP, boxscores, team bullpen stats
          </li>
          <li>
            <ExtLink href="https://baseballsavant.mlb.com/">Baseball Savant</ExtLink>{' '}
            — Statcast pitcher metrics (hard-hit% allowed)
          </li>
          <li>
            <ExtLink href="https://www.fangraphs.com/tools/guts">FanGraphs Guts!</ExtLink>{' '}
            — 2025 per-handedness park factors (1B / 2B / 3B / HR by L vs R)
          </li>
          <li>
            <ExtLink href="https://open-meteo.com/">Open-Meteo</ExtLink> — temperature,
            wind speed and direction at each stadium
          </li>
        </ul>
        <p className="text-xs text-ink-muted">
          All sources are free and require no API key. Weather endpoints have a
          fallback to neutral when the fetch fails — weather can never penalise a pick
          when the data is missing.
        </p>
      </Section>

      <Section heading="What the model is, and isn&apos;t" eyebrow="Honest limits">
        <Grid>
          <Card title="Things the model does">
            <ul className="ml-5 list-disc space-y-1 text-sm marker:text-ink-muted">
              <li>20k-iteration per-player Monte Carlo for the typical-matchup baseline</li>
              <li>Closed-form, sub-millisecond today-adjusted probability via odds-ratio composition of six factors</li>
              <li>Variance-aware Kelly score so longshots don&apos;t dominate the board</li>
              <li>Stabilization toward league averages so small samples don&apos;t over-fit</li>
              <li>Confirmed / partial / estimated lineup tiering with status-aware caching</li>
              <li>Lifecycle integrity from generate → lock → live-settle → daily settle → history</li>
            </ul>
          </Card>
          <Card title="Things the model doesn&apos;t do">
            <ul className="ml-5 list-disc space-y-1 text-sm marker:text-ink-muted">
              <li>Ingest sportsbook lines or compute book-implied probabilities</li>
              <li>Apply BvP to per-PA rates (BvP only enters confidence)</li>
              <li>Differentiate starter rates from bullpen rates inside the offline baseline</li>
              <li>Apply TTO penalties (the closed-form pitcher factor doesn&apos;t break out by times-through-the-order)</li>
              <li>Track L15/L30 rolling form blends in the live ranker</li>
              <li>Project bullpen quality by reliever leverage tier (uses team-aggregate ERA)</li>
            </ul>
          </Card>
        </Grid>
        <p className="text-sm text-ink-muted">
          The tracked-tier floors are placeholders pending ≥30 days of settled history.
          Treat <em>Score</em> as an internal ordering, not a calibrated bankroll
          fraction — until floors are tuned, it&apos;s a relative ranking, not a
          guarantee.
        </p>
      </Section>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Layout primitives — small, responsive, no fixed widths.
// ---------------------------------------------------------------------------

function Section({
  heading,
  eyebrow,
  children,
}: {
  heading: string
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        {eyebrow && (
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-muted">
            {eyebrow}
          </div>
        )}
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{heading}</h2>
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-ink-subtle sm:text-base">
        {children}
      </div>
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">{children}</div>
  )
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card/30 p-4 sm:p-5">
      <div className="min-w-0 space-y-0.5">
        <div className="text-base font-semibold text-ink">{title}</div>
        {subtitle && <div className="text-xs text-ink-muted">{subtitle}</div>}
      </div>
      <div className="min-w-0 space-y-3 text-sm text-ink-subtle">{children}</div>
    </div>
  )
}

function Note({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-mono uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="text-xs text-ink-subtle sm:text-sm">{children}</div>
    </div>
  )
}

function Formula({ children }: { children: React.ReactNode }) {
  // overflow-x-auto on the wrapper, whitespace-pre on <pre> so long formulas
  // wrap on a phone but render cleanly on desktop. min-w-0 on the parent flex
  // chain prevents the formula from forcing horizontal scroll on parent cards.
  return (
    <pre className="w-full overflow-x-auto rounded-md border border-border bg-card/60 p-3 font-mono text-[11px] leading-relaxed text-ink sm:text-xs">
      {children}
    </pre>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="break-words rounded border border-border/60 bg-card/60 px-1 py-0.5 font-mono text-[0.85em] text-accent">
      {children}
    </code>
  )
}

function FilePath({ children }: { children: React.ReactNode }) {
  return (
    <code className="break-all rounded bg-card/40 px-1 py-0.5 font-mono text-[0.85em] text-ink">
      {children}
    </code>
  )
}

function FactorRow({
  name,
  range,
  source,
  desc,
}: {
  name: string
  range: string
  source: string
  desc: string
}) {
  return (
    <tr className="border-b border-border/40 last:border-b-0 align-top">
      <td className="px-3 py-2.5">
        <div className="font-medium text-ink">{name}</div>
        <div className="mt-1 break-all font-mono text-[10px] text-ink-muted">{source}</div>
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-ink whitespace-nowrap">{range}</td>
      <td className="px-3 py-2.5 text-xs leading-relaxed sm:text-sm">{desc}</td>
    </tr>
  )
}

function ConfRow({ factor, mapping }: { factor: string; mapping: string }) {
  return (
    <tr className="border-b border-border/40 last:border-b-0 align-top">
      <td className="px-3 py-2 font-medium text-ink">{factor}</td>
      <td className="px-3 py-2 font-mono text-xs text-ink-subtle">{mapping}</td>
    </tr>
  )
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="text-accent hover:underline"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  )
}
