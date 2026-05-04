import { CONFIDENCE_FLOOR_TRACKED, EDGE_FLOORS, PROB_FLOORS } from '@/lib/constants'

export const metadata = {
  title: 'Methodology',
  description: 'How the HRR Betting model actually works. Every factor, every formula, traced to the code.',
}

// Format a [0,1] probability as a 2-decimal string ("0.85") for the floors block.
const fmtFloor = (n: number) => n.toFixed(2)

export default function Methodology() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Methodology</h1>
        <p className="max-w-3xl text-sm text-ink-muted">
          What the board ranks, how each number is built, and what it means. Plain
          English first; formulas alongside.
        </p>
      </header>

      <Section heading="What the board ranks" eyebrow="Overview">
        <p>
          Every row is a single prop bet: one batter, one rung. The board is sorted
          by an internal <Code>Score</Code> (Kelly bet fraction × confidence) that
          answers &ldquo;how much would Kelly bet on this at the model&apos;s
          fair-typical odds, weighted by data quality.&rdquo; Score is no longer
          shown as its own column; the visible wager column shows the recommended
          bet in dollars once you enter the FanDuel line for a row (see{' '}
          <em>Wager sizing</em> below).
        </p>
        <p>
          Three rungs per player: <RungTag rung={1} />,{' '}
          <RungTag rung={2} />, <RungTag rung={3} />{' '}
          where HRR = Hits + Runs + RBIs over the player&apos;s full game. A solo
          home run alone is +1H +1R +1RBI = 3 HRR.
        </p>
      </Section>

      <Section heading="The two probabilities" eyebrow="Core model">
        <Grid>
          <Card title="p̂ typical" subtitle="Offline baseline">
            <p>
              The player&apos;s baseline probability of clearing the rung in their{' '}
              <em>typical</em> matchup. This is what the line should price purely from skill.
            </p>
            <Note label="How it&apos;s computed">
              A 20,000-iteration Monte Carlo simulates a full 9-inning game with the
              target batter at lineup slot 4 and 17 league-average teammates and
              opponents. The batter&apos;s outcome rates come from full-season counts,
              regressed via empirical stabilization (Russell Carleton sample sizes)
              toward the player&apos;s own career rates when ≥ 200 career PAs exist.
              League averages are used otherwise. The career prior preserves true skill
              differences in early-season samples.
            </Note>
            <Note label="When">
              Recomputed weekly (Sunday 4 AM ET full sweep) and nightly (Mon–Sat 4 AM ET
              slate-batter sweep). Cached 14 days. The request path only reads cache and
              never recomputes, so it stays sub-millisecond.
            </Note>
          </Card>

          <Card title="p̂ today" subtitle="Closed-form, request-time">
            <p>
              The probability after applying today&apos;s matchup factors. Computed on
              every page load. There is no per-game simulation at request time.
            </p>
            <Note label="How it&apos;s computed">
              Odds-ratio composition. Convert <Code>p̂ typical</Code> to odds, multiply
              by the product of all factors (clamped overall), convert back to
              probability. This keeps the result bounded below 1 no matter how many
              factors compound. It is the standard fix for &ldquo;multiplying probabilities
              breaks past 0.5.&rdquo;
            </Note>
            <Formula>
              {`factorProduct = clamp(pitcher × park × weather × handedness
                                × bullpen × paCount × bvp × batter,
                                0.25, 4.0)
oddsTypical   = p̂_typical / (1 − p̂_typical)
oddsToday     = oddsTypical × factorProduct
p̂_today       = oddsToday / (1 + oddsToday)`}
            </Formula>
          </Card>
        </Grid>
      </Section>

      <Section heading="The eight factors" eyebrow="What changes p̂ today vs p̂ typical">
        <p className="text-sm text-ink-muted">
          Each factor is a single multiplier with its own clamp.
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
                  desc="Stabilized K%, BB%, HR%, hard-hit% vs league averages combined into a single quality multiplier. TBD starter or fewer than 3 recent starts → 1.0 (neutral)."
                />
                <FactorRow
                  name="Park"
                  range="0.70 – 1.30"
                  desc="FanGraphs 2025 per-outcome park factors blended into one composite: 45% hits, 20% runs, 20% HR, 10% (1/K so contact-friendly parks help), 5% BB. Per-handedness for hits/HR; switch hitters get the L/R average. Unknown venues → 1.0."
                />
                <FactorRow
                  name="Weather"
                  range="0.85 – 1.20"
                  desc="Temp + wind projected onto the home → CF axis, then composed across all HRR-relevant outcomes (1B, 2B, 3B, HR, BB) weighted by HRR contribution. Replaces the older HR-only dampened formula. Domes and failed forecasts → 1.0."
                />
                <FactorRow
                  name="Handedness"
                  range="0.97 / 1.00 / 1.03"
                  desc="Same-side platoon disadvantage 0.97; opposite-side advantage 1.03; switch hitter neutral 1.00."
                />
                <FactorRow
                  name="Bullpen"
                  range="0.85 – 1.15"
                  desc="Opponent team bullpen ERA stabilized vs league (4.20), scaled by the share of PAs the batter sees against the bullpen for their lineup slot (top of order sees less)."
                />
                <FactorRow
                  name="PA count"
                  range="0.85 – 1.15"
                  desc="Corrects for slot-specific expected PAs vs league mean (4.20). Top-of-order batters get more swings; bottom-of-order get fewer. Bernoulli scaling on a per-PA HRR rate."
                />
                <FactorRow
                  name="BvP"
                  range="0.90 – 1.10"
                  desc="Batter-vs-pitcher career line shrunk toward league wOBA via empirical Bayes (~600 PA stabilization point). Returns 1.0 (neutral) for under 5 career AB, otherwise nudges based on the wOBA-equivalent of the matchup."
                />
                <FactorRow
                  name="Batter quality"
                  range="0.95 – 1.05"
                  desc="Statcast contact profile (barrel%, hard-hit%, xwOBA) ratioed to league averages and dampened by an exponent of 0.25. Heavily damped because pTypical already captures most batter skill; this only nudges when underlying contact disagrees with rates."
                />
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-ink-muted">
          The factor product is clamped to <Code>[0.25, 4.0]</Code> as a safety rail.
          One outlier input (e.g. a weird pitcher line from a tiny sample) can&apos;t
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
          </Card>

          <Card title="Score (silent sort key)" subtitle="Kelly bet fraction × confidence">
            <Formula>
              {`kelly = (p̂_today − p̂_typical) / max(1 − p̂_typical, 0.01)
score = kelly × confidence`}
            </Formula>
            <p>
              Drives the default ranking on the board (highest score on top). No
              longer shown as its own column — the displayed value is the
              actionable bet size in dollars, computed from the FanDuel line you
              enter per pick (see <em>Wager sizing</em> below). Score lives on as
              the math behind &ldquo;which row sorts first&rdquo;; the abstract
              0–100 number it produced wasn&apos;t directly interpretable.
            </p>
            <Note label="Why Kelly, not relative edge">
              Relative edge scales with rarity, so 3+ HRR longshots (typical ≈ 10%)
              trivially produce huge edges and would dominate the sort. Kelly&apos;s
              <Code>(1 − p̂ typical)</Code> denominator flips the bias. High-
              probability plays where you can win a lot of bets get rewarded;
              longshot variance gets sized down.
            </Note>
          </Card>
        </Grid>
      </Section>

      <Section heading="Wager sizing" eyebrow="Bet size from your FD line">
        <p>
          You set a <Code>Bankroll</Code> and a <Code>Kelly Fraction</Code>{' '}
          (Eighth / Quarter / Half / Full, default Quarter) at the top of the board.
          For every pick, the wager cell is pre-filled with an{' '}
          <em>estimated</em> FanDuel line derived from <Code>p̂ today</Code> + a
          typical ~4pp vig — when you haven&apos;t entered the actual line yet,
          the row still shows a rough bet size against that estimate (italicised{' '}
          <span className="text-tracked/70 italic">est</span> badge tells you
          it&apos;s a model-derived line, not the real book price). Type the
          actual FanDuel line over the estimate and the row recomputes against
          the real number.
        </p>
        <Formula>
          {`b           = profit per $1 staked at the offered odds
implied_p   = book's implied probability (with vig)
fullKelly   = max(0, (p̂_today × b − (1 − p̂_today)) / b)
bet_dollars = fullKelly × kellyFraction × bankroll

Estimated book line (midpoint of pTypical and pToday + ~4pp vig):
midpoint    = (p̂_typical + p̂_today) / 2
bookProb    = clamp(midpoint + 0.04, 0.01, 0.97)
americanOdds = round-to-book-increment(bookProb → moneyline)`}
        </Formula>
        <p className="text-sm text-ink-muted">
          The Kelly formula recommends $0 (skip) when the book line implies a higher
          probability than the model believes — i.e. when there&apos;s no edge to
          extract. Quarter Kelly is the safe default; full Kelly is theoretically
          optimal but practically too aggressive given even small calibration errors.
          Settings persist to localStorage so reloads don&apos;t reset them.
        </p>
        <Note label="Why the midpoint of pTypical and pToday">
          Books are more conservative on matchup adjustments than our model.
          When we boost <Code>p̂ typical</Code> → <Code>p̂ today</Code> by
          ~10pp via factor composition (pitcher × park × weather × ...), the
          book usually moves less aggressively from their own season baseline.
          Empirically a 0.767 / 0.862 (pTypical / pToday) pick had FanDuel at
          -500 — implied 0.833, almost exactly the midpoint of our two
          probabilities plus typical vig. Using <Code>p̂ today</Code> alone
          (with vig on top) over-extrapolates and produces too-steep estimates
          like -900 when the real line is -500.
        </Note>
        <Note label="Estimated vs entered line">
          The 4pp vig assumption is a coarse mid-estimate of FanDuel-class
          player-prop hold (typical 7–10% total, split across both sides). Real
          book lines vary on demand and book-specific projections. Use the
          estimate as a sanity check — &ldquo;this pick is ~+$30 against a
          typical line&rdquo; — then enter the actual line for the real bet size.
          When the actual line is steeper than the estimate (book sees the
          matchup as more lopsided than the model does), the recommended bet
          shrinks or goes to skip.
        </Note>
      </Section>

      <Section heading="Confidence" eyebrow="Data-quality multiplier">
        <p>
          A product of nine multiplicative factors. The design principle:{' '}
          <em>every factor mirrors what its corresponding probability factor
          actually uses.</em> When a probToday factor is neutralised (returns
          1.00 — the data isn&apos;t feeding pMatchup), the matching confidence
          factor pins to 1.00 too. No haircuts for data we&apos;re not using.
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-card/50 text-left text-xs uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="px-3 py-2">Factor</th>
                  <th scope="col" className="px-3 py-2">Pins to 1.00 when…</th>
                  <th scope="col" className="px-3 py-2">Active mapping</th>
                </tr>
              </thead>
              <tbody className="text-ink-subtle">
                <ConfRow3 factor="Lineup" inactive="—" mapping="base: confirmed 1.00 / partial 0.85 / estimated 0.70 — multiplied by a time-to-pitch factor (1.00 → 0.95 from 30 min to 6 hrs out, unconfirmed only)" />
                <ConfRow3 factor="BvP" inactive="—" mapping="linear ramp 0.90 at 0 AB → 1.00 at ≥20 AB (sample-size signal — reads independently of probToday gate)" />
                <ConfRow3 factor="Pitcher rates" inactive="TBD pitcher OR (< 3 current starts AND < 50 BF prior season)" mapping="ramp 0.90 at 50 BF → 1.00 at ≥200 BF — cold-start fallback uses prior-season rates as the stabilization prior" />
                <ConfRow3 factor="Weather" inactive="dome / failed forecast / |hrMult−1| ≤ 5%" mapping="continuous: 1.00 → 0.90 between 5% and 20% impact" />
                <ConfRow3 factor="Bullpen" inactive="bullpen IP unknown" mapping="ramp 0.95 at 0 IP → 1.00 at ≥150 IP" />
                <ConfRow3 factor="Batter sample" inactive="—" mapping="career ≥ 200 PA: 0.92 → 1.00 over 100 fresh PA;  career < 200: 0.85 → 1.00 over 200 fresh PA" />
                <ConfRow3 factor="Batter Statcast" inactive="Statcast present OR rookie (< 200 career PA, missing Statcast is normal)" mapping="0.96 when Statcast missing for a vet (≥ 200 career PA) — small ding for unusual missing data" />
                <ConfRow3 factor="Opener" inactive="normal starter" mapping="opener 0.90 (relevance haircut, not data quality) — fires on in-season pattern (≥3 starts, &lt;2 IP avg) OR prior-season reliever flag (GS/G &lt; 0.5)" />
                <ConfRow3 factor="Data freshness" inactive="schedule cache ≤ 5 min stale" mapping="ramp to 0.90 at ≥ 30 min stale" />
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-ink-muted">
          Three notes worth flagging. <strong>One:</strong> the BvP factor here
          scales confidence by sample size as a pure linear signal — even at
          0 AB it dings 10pp because we have no historical matchup data, even
          though the probToday BvP factor is itself neutralised below 5 AB.
          That&apos;s an intentional break from strict alignment: probToday
          BvP tracks &ldquo;how well does this batter perform vs this
          pitcher&rdquo; (wOBA-shifted, gate ≥ 5 AB), while confidence BvP
          tracks &ldquo;how much matchup history do we have&rdquo;. <strong>Two:</strong> the pitcher
          factor stabilizes K%, BB%, HR%, and hard-hit% individually. Confidence
          ramps on batters-faced rather than start count because BF is the
          underlying unit those rates stabilize against (Russell Carleton:
          ~70 BF for K%, ~170 BF for BB%/HR%, ~200 BF for hardHit%). 200 BF is
          the most-binding threshold; that&apos;s where the ramp ceiling sits.
          When current-season has &lt; 3 starts AND prior-season has ≥ 50 BF,
          the factor falls back to stabilising current rates against prior-
          season rates — a 30-start veteran with 1 fresh start no longer
          reads as league-average.{' '}
          <strong>Three:</strong> the batter sample factor branches on whether
          <Code>p̂ typical</Code> is using a strong career prior (≥ 200 career
          PA). When it is, the rates feeding pTypical are anchored by career
          data; the confidence ramp lifts off the rookie 0.85 floor accordingly.
        </p>
      </Section>

      <Section heading="Tracked vs Other plays" eyebrow="Tier classification">
        <p>
          A pick is <span className="font-medium text-tracked">🎯 Tracked</span> only
          when all three floors clear:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-sm marker:text-ink-muted">
          <li><Code>confidence ≥ {fmtFloor(CONFIDENCE_FLOOR_TRACKED)}</Code></li>
          <li>
            <Code>edge ≥ floor(rung)</Code>: {fmtFloor(EDGE_FLOORS[1])} / {fmtFloor(EDGE_FLOORS[2])} / {fmtFloor(EDGE_FLOORS[3])} for{' '}
            <RungTag rung={1} compact /> / <RungTag rung={2} compact /> /{' '}
            <RungTag rung={3} compact />
          </li>
          <li>
            <Code>p̂ today ≥ floor(rung)</Code>: {fmtFloor(PROB_FLOORS[1])} / {fmtFloor(PROB_FLOORS[2])} / {fmtFloor(PROB_FLOORS[3])} for{' '}
            <RungTag rung={1} compact /> / <RungTag rung={2} compact /> /{' '}
            <RungTag rung={3} compact />
          </li>
        </ul>
        <p className="text-sm text-ink-muted">
          Symmetric design: as the rung gets harder, the bar shifts from raw value to
          raw conviction. Easy 1+ picks just need a high probability with a small edge;
          hard 3+ picks need a real chance of clearing (40%+) with meaningful edge.
          Both gates fire in tandem so a borderline-prob longshot with massive edge
          and a high-prob favourite with no edge both stay out.
        </p>
        <p>
          A pick that misses the Tracked thresholds but still has{' '}
          <Code>score ≥ 0.05</Code> shows under <em>Other plays</em>. Below that, the
          pick is dropped from the board. The board caps at 30 plays per slate via
          per-rung quotas (15 / 10 / 5) so 3+ longshots don&apos;t get crowded out by
          high-prob 1+ plays.
        </p>
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
        <p className="text-xs text-ink-muted">
          The app does not auto-ingest sportsbook lines — there is no live odds
          feed, scraper, or aggregator. The American number shown next to{' '}
          <Code>p̂ typical</Code> and <Code>p̂ today</Code> is purely the model&apos;s
          own probability translated into a moneyline. The Wager sizing feature
          accepts a FanDuel line per pick via manual entry; that entry is the
          only place a real book line enters the system.
        </p>
      </Section>

      <Section heading="Per-PA outcome model" eyebrow="Inside the offline sim">
        <p>
          For each plate appearance the simulator samples one of seven outcomes
          (<Code>1B / 2B / 3B / HR / BB / K / OUT</Code>) from the batter&apos;s
          stabilized rate distribution. A baserunner state machine advances bases
          and credits runs / RBIs realistically. A HR puts the batter and any
          baserunners across, a single can score a runner from second, and so on.
        </p>
        <p>
          This per-PA approach captures the HR-trifecta correlation (a solo HR =
          +1 H, +1 R, +1 RBI all in one swing) that closed-form Poisson models
          systematically under-price for power hitters.
        </p>
        <Note label="TTO is baked in here">
          PAs 1, 2, 3 against the starter use rates multiplied by the per-outcome
          times-through-the-order multipliers (PAs 4+ are vs the bullpen). TTO is
          fundamentally per-PA, so applying it inside the sim lets the effect
          compound through the baserunner state machine instead of being a single
          uniform multiplier on the binary &ldquo;≥ k HRR&rdquo; probability at request time.
        </Note>
        <p className="text-xs text-ink-muted">
          Remaining v1 simplifications: 9 innings only (no extras, ~&lt;0.5% impact
          on rung probabilities); pitcher / park / weather still enter only at the
          closed-form factor stage at request time, because moving them into the
          sim would require per-(batter, pitcher) and per-(batter, venue) cached
          baselines (~15k combinations) instead of per-batter (~500) and would
          push the offline cron compute by 30×.
        </p>
      </Section>

      <Section heading="Slate lifecycle" eyebrow="From compute to history">
        <ol className="ml-5 list-decimal space-y-2 text-sm marker:text-ink-muted">
          <li>
            <strong className="text-ink">Slate boundary.</strong> ET, 3 AM rollover.
            This is the standard DFS / sportsbook convention. A late-night PT game
            that finishes past midnight ET still belongs to the same slate.
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
            <Code>locked_picks</Code> table once a game&apos;s lock window opens
            (confirmed lineup ≤ 90 min before first pitch, or ≤ 30 min regardless).
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
            <strong className="text-ink">Settle.</strong> 3:15 AM ET (7:15 UTC) daily,{' '}
            <Code>/api/settle</Code> reads the previous slate&apos;s{' '}
            <Code>locked_picks</Code>, fetches each boxscore, and upserts the canonical
            outcome into <Code>settled_picks</Code>. This is the canonical write. The
            live-board stamping is just a UX preview; the daily settle is what feeds{' '}
            <Code>/history</Code>.
          </li>
        </ol>
      </Section>

      <Section heading="Caching: what&apos;s frozen and what isn&apos;t" eyebrow="So given picks don't shift mid-game">
        <p>
          Once a play is given, its inputs shouldn&apos;t change just because a stat
          ticked during the game. The cache layout enforces that:
        </p>
        <ul className="ml-5 list-disc space-y-1.5 text-sm marker:text-ink-muted">
          <li>
            <strong className="text-ink">Slate-aligned (24 h, frozen across the slate).</strong>{' '}
            BvP, batter season stats, recent pitcher starts, batter game log,
            Statcast metrics. Cache key includes{' '}
            <Code>slateDateString()</Code> so today&apos;s mid-game ticks can&apos;t
            shift previously-given picks.
          </li>
          <li>
            <strong className="text-ink">Live state (2 min).</strong> Schedule, partial
            and estimated lineups. Game-status transitions (probable → confirmed,
            scheduled → live → final) propagate fast.
          </li>
          <li>
            <strong className="text-ink">Slow-changing (6 h).</strong> Confirmed
            lineups, finalised boxscores, opponent bullpen ERA. Once posted, lineups
            and boxscores don&apos;t change; bullpen ERA shifts a few times per day.
          </li>
          <li>
            <strong className="text-ink">Page cache (30 s)</strong> for{' '}
            <Code>picks:current:&#123;date&#125;</Code>. Covers a normal client poll
            interval without overloading the function on burst refreshes.
          </li>
        </ul>
      </Section>

      <Section heading="Data sources" eyebrow="Where the numbers come from">
        <ul className="ml-5 list-disc space-y-1.5 text-sm marker:text-ink-muted">
          <li>
            <ExtLink href="https://statsapi.mlb.com/">MLB Stats API</ExtLink> for schedule,
            lineups, batter season stats, batter game log, recent pitcher starts,
            BvP, boxscores, and team bullpen stats.
          </li>
          <li>
            <ExtLink href="https://baseballsavant.mlb.com/">Baseball Savant</ExtLink>{' '}
            for Statcast pitcher metrics (hard-hit% allowed).
          </li>
          <li>
            <ExtLink href="https://www.fangraphs.com/tools/guts">FanGraphs Guts!</ExtLink>{' '}
            for 2025 per-handedness park factors (1B / 2B / 3B / HR by L vs R).
          </li>
          <li>
            <ExtLink href="https://open-meteo.com/">Open-Meteo</ExtLink> for temperature,
            wind speed, and wind direction at each stadium.
          </li>
        </ul>
        <p className="text-xs text-ink-muted">
          All sources are free and require no API key. Weather endpoints have a
          fallback to neutral when the fetch fails, so weather can never penalise a
          pick when the data is missing.
        </p>
      </Section>

      <Section heading="What the model is, and isn&apos;t" eyebrow="Honest limits">
        <Grid>
          <Card title="Things the model does">
            <ul className="ml-5 list-disc space-y-1 text-sm marker:text-ink-muted">
              <li>20k-iteration per-player Monte Carlo for the typical-matchup baseline</li>
              <li>Closed-form, sub-millisecond today-adjusted probability via odds-ratio composition of eight factors</li>
              <li>Empirical-Bayes shrunken BvP signal that nudges p̂ today on real career history</li>
              <li>Statcast contact-quality factor for batters (barrel%, hard-hit%, xwOBA)</li>
              <li>Times-through-the-order penalty applied per-PA inside the offline sim (compounds through the baserunner state machine)</li>
              <li>Variance-aware Kelly score so longshots don&apos;t dominate the board</li>
              <li>Stabilization toward career rates (when ≥ 200 career PAs) so small samples don&apos;t over-fit</li>
              <li>Confirmed / partial / estimated lineup tiering with status-aware caching</li>
              <li>Lifecycle integrity from generate → lock → live-settle → daily settle → history</li>
            </ul>
          </Card>
          <Card title="Things the model doesn&apos;t do">
            <ul className="ml-5 list-disc space-y-1 text-sm marker:text-ink-muted">
              <li>Auto-ingest sportsbook lines (manual FD-line entry per pick is the only book signal — no scraper, no aggregator)</li>
              <li>Differentiate starter rates from bullpen rates inside the offline baseline</li>
              <li>Track L15/L30 rolling form blends in the live ranker</li>
              <li>Project bullpen quality by reliever leverage tier (uses team-aggregate ERA)</li>
              <li>Apply pitcher-specific TTO ramps (uses a league-average TTO factor; per-pitcher splits would need pitch-level Savant data)</li>
            </ul>
          </Card>
        </Grid>
        <p className="text-sm text-ink-muted">
          The tracked-tier floors are placeholders pending ≥30 days of settled history.
          Treat <em>Score</em> as an internal ordering, not a calibrated bankroll
          fraction. Until floors are tuned, it&apos;s a relative ranking, not a
          guarantee.
        </p>
      </Section>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Layout primitives. Small, responsive, no fixed widths.
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

/**
 * Inline rung label colored to match RungBadge in PickRow:
 *   1+ → sky-300, 2+ → sky-400, 3+ HRR → blue-400.
 * Default form spells out "X+ HRR"; `compact` drops the "HRR" suffix for
 * dense list contexts where the label appears next to other rung tokens.
 */
function RungTag({ rung, compact = false }: { rung: 1 | 2 | 3; compact?: boolean }) {
  const cls =
    rung === 1
      ? 'border-sky-300/40 bg-sky-300/10 text-sky-300'
      : rung === 2
        ? 'border-sky-400/50 bg-sky-400/15 text-sky-400'
        : 'border-blue-500/60 bg-blue-500/20 text-blue-400'
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[0.78em] font-medium uppercase tracking-wider leading-none ${cls}`}
    >
      {rung}+{compact ? '' : ' HRR'}
    </span>
  )
}

function FactorRow({
  name,
  range,
  desc,
}: {
  name: string
  range: string
  desc: string
}) {
  return (
    <tr className="border-b border-border/40 last:border-b-0 align-top">
      <td className="px-3 py-2.5 font-medium text-ink">{name}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-ink whitespace-nowrap">{range}</td>
      <td className="px-3 py-2.5 text-xs leading-relaxed sm:text-sm">{desc}</td>
    </tr>
  )
}

/**
 * Confidence-table row: factor name · when it pins to 1.00 (probToday factor
 * inactive — alignment principle) · how it ramps when active.
 */
function ConfRow3({ factor, inactive, mapping }: { factor: string; inactive: string; mapping: string }) {
  return (
    <tr className="border-b border-border/40 last:border-b-0 align-top">
      <td className="px-3 py-2 font-medium text-ink">{factor}</td>
      <td className="px-3 py-2 text-xs text-ink-subtle">{inactive}</td>
      <td className="px-3 py-2 font-mono text-[11px] text-ink-subtle">{mapping}</td>
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
