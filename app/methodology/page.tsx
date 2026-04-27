export const metadata = {
  title: 'Methodology',
  description: 'How the HRR Betting model works: factors, math, and data sources.',
}

export default function Methodology() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Methodology</h1>
        <p className="text-sm text-ink-muted">
          How the model works — every factor, every formula, every source.
        </p>
      </header>

      <Section heading="The HRR prop">
        <p>
          HRR = Hits + Runs scored + RBIs, summed over the player&apos;s full game. Three rungs: 1+, 2+, 3+ HRR.
        </p>
        {/* Outer overflow-hidden clips the rounded corners; inner overflow-x-auto
            lets the table scroll horizontally on narrow viewports rather than
            clipping the rightmost columns. */}
        <div className="overflow-hidden rounded-lg border border-border bg-card/30">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm font-mono">
              <thead>
                <tr className="border-b border-border bg-card/50 text-xs uppercase tracking-wider text-ink-muted">
                  <th scope="col" className="px-3 py-2 text-left">Outcome</th>
                  <th scope="col" className="px-3 py-2 text-right">H</th>
                  <th scope="col" className="px-3 py-2 text-right">R</th>
                  <th scope="col" className="px-3 py-2 text-right">RBI</th>
                  <th scope="col" className="px-3 py-2 text-right">HRR</th>
                </tr>
              </thead>
              <tbody>
                <Row label="Solo HR" h={1} r={1} rbi={1} hrr={3} />
                <Row label="Walk + score" h={0} r={1} rbi={0} hrr={1} />
                <Row label="Sac fly" h={0} r={0} rbi={1} hrr={1} />
                <Row label="Grand slam" h={1} r={1} rbi={4} hrr={6} />
                <Row label="Reach on error + score" h={0} r={1} rbi={0} hrr={1} />
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section heading="EDGE & SCORE">
        <p>The model&apos;s single ranking metric:</p>
        <CodeBlock>
{`EDGE  = P_matchup / max(P_typical, 0.01) − 1
SCORE = EDGE × confidence`}
        </CodeBlock>
        <p>
          <Code>P_matchup</Code> is the model&apos;s probability for clearing the rung in this specific matchup
          (from the simulator). <Code>P_typical</Code> is the same player&apos;s average probability across their
          season&apos;s actual matchups — this is the key denominator that isolates <em>matchup</em> edge from
          <em> player skill</em> (since books already price skill into the line).
        </p>
        <p>
          <Code>confidence</Code> is a graded multiplier (0.55–1.00) based on lineup confirmation, BvP sample
          size, weather stability, and time-to-first-pitch.
        </p>
      </Section>

      <Section heading="Tracked vs Watching">
        <p>
          A pick is <span className="font-medium text-tracked">Tracked</span> only if all three conditions clear:
        </p>
        <ul className="ml-5 list-disc space-y-1 marker:text-ink-muted">
          <li><Code>confidence ≥ 0.85</Code></li>
          <li><Code>EDGE ≥ floor(rung)</Code> — 0.10 / 0.30 / 0.60 for rungs 1+ / 2+ / 3+</li>
          <li><Code>P_matchup ≥ floor(rung)</Code> — 0.85 / 0.55 / 0.20</li>
        </ul>
        <p className="text-sm text-ink-muted">
          Both EDGE and probability floors must clear because each catches a different failure mode:
          a 30% prob at 3+ has huge EDGE but is still a coin-flip on the bad side; an Aaron Judge 3+
          in a neutral matchup has high prob but no real edge.
        </p>
        <p>Other picks above a low display floor are shown as <em>Watching</em> — informational, not counted in the success rate.</p>
        <p className="text-sm text-ink-muted">
          Volume of Tracked picks varies by slate — could be 0 on a weak day, could be many on a strong day.
          Days with 0 record as <Code>0/0</Code> (no dilution).
        </p>
      </Section>

      <Section heading="Per-PA outcome distribution">
        <p>
          For each plate appearance, the model samples one of seven outcomes:{' '}
          <Code>1B / 2B / 3B / HR / BB / K / OUT</Code>. Probabilities come from a hybrid log-5 + Statcast formula:
        </p>
        <CodeBlock>
{`P(outcome | batter, pitcher) =
    batter_rate × (pitcher_rate / lg_avg) × park × weather × tto`}
        </CodeBlock>
        <p>
          Statcast adjustments (barrel%, hard-hit%, whiff%) layer on top. BvP regression (career
          batter-vs-pitcher splits) is applied weighted by <Code>starter_share</Code> — only for the fraction of
          PAs facing the starter, not the bullpen.
        </p>
      </Section>

      <Section heading="Lineup-aware Monte Carlo">
        <p>
          For each game, the model simulates 10,000 iterations of the full game with all 9 batters of each team.
          Per-PA outcomes draw from the distribution above; <Code>applyOutcome</Code> evolves the bases state
          realistically. Runs are credited to the runner who scored, RBIs to the batter who drove them in.
        </p>
        <p>
          This captures the HR-trifecta correlation (a solo HR = +1 H, +1 R, +1 RBI in one swing) that
          closed-form Poisson models systematically under-price for power hitters.
        </p>
        <p className="text-sm text-ink-muted">v1: 9-inning sims, no extras (impact &lt; 0.5% absolute on rung probabilities).</p>
      </Section>

      <Section heading="Stabilization & recent form">
        <p>
          Player rate stats are stabilized using empirical sample-size points (Russell Carleton&apos;s research):
        </p>
        <ul className="ml-5 list-disc space-y-1 text-sm marker:text-ink-muted">
          <li>K rate stabilizes ~60 PAs</li>
          <li>BB rate ~120 PAs</li>
          <li>HR rate ~170 PAs</li>
          <li>BABIP ~800 PAs</li>
        </ul>
        <p>
          Critically, the regression target is the player&apos;s <strong className="text-ink">career rate</strong>,
          not league mean — this preserves true skill differences. Recent form (L15, L30) is then blended in with
          weights that shift through the season (early year favors stabilized; late year favors recent).
        </p>
      </Section>

      <Section heading="Park factors">
        <p>
          Each MLB stadium has a unique signature for which outcomes it suppresses or
          inflates. We use the <strong className="text-ink">2025 FanGraphs Guts!</strong> tables
          for every park: the per-handedness columns (<Code>1B/2B/3B/HR by L vs R</Code>) and
          the handedness-blended <Code>BB</Code> and <Code>K</Code> columns. All values are
          FanGraphs&apos; halved scale (100 = neutral, applied to a full-season line),
          stored as direct multipliers in <Code>lib/park-factors.ts</Code>.
        </p>
        <p>
          Per-handedness matters because the same park behaves differently for each side:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-sm marker:text-ink-muted">
          <li>
            <strong className="text-ink">Yankee Stadium</strong>: HR factor 1.07 for LHB
            (short porch in right) vs 1.04 for RHB.
          </li>
          <li>
            <strong className="text-ink">Coors Field</strong>: HR 1.05 LHB vs 1.08 RHB; 3B 1.28
            LHB vs 1.42 RHB (huge LF / CF gaps).
          </li>
          <li>
            <strong className="text-ink">Dodger Stadium</strong>: HR 1.07 LHB vs 1.12 RHB.
          </li>
        </ul>
        <p>
          The factors are resolved per-batter inside <Code>buildBatterContext</Code>, so when
          the per-PA model multiplies through park × weather × TTO, each batter sees the
          number that matches their bats hand. Switch hitters get the L/R average — a v1
          simplification; a finer model would weight by the pitcher&apos;s handedness for that PA.
        </p>
      </Section>

      <Section heading="Weather">
        <p>
          Open-Meteo gives us temperature, wind speed, and wind direction at each
          stadium for the closest hour to first pitch. Each stadium also has a
          stored <Code>outfieldFacingDegrees</Code> bearing — the compass direction
          the outfield faces. From those four numbers the model computes per-outcome
          multipliers, which feed into the per-PA distribution alongside park and TTO.
        </p>
        <CodeBlock>
{`tempHrMult     = 1 + 0.015 × (tempF − 70) / 10                  // ~1.5% per 10°F
outMph         = −cos(windFromDeg − outfieldFacingDeg) × wind    // signed: + out, − in
windHrEffect   = clamp(0.02 × outMph, −0.25, +0.25)              // ±2%/mph, ±25% cap
HR             = clamp(tempHrMult × (1 + windHrEffect), 0.65, 1.40)
2B             = 1 + 0.005 × (tempF − 70) / 10                   // small carry on liners
3B             = 1 + 0.010 × (tempF − 70) / 10                   // slight carry
1B / BB / K    = 1.00`}
        </CodeBlock>
        <p>
          Domes and retractable-roof games (Tropicana, Rogers Centre, Chase, Globe Life,
          Minute Maid, loanDepot, American Family) short-circuit to neutral 1.00
          across the board via the stadium&apos;s <Code>weatherControlled</Code> flag.
          Failed forecasts (rare) also default to neutral so weather can never penalise
          a pick when the data is missing.
        </p>
        <p className="text-sm text-ink-muted">
          Concrete examples (HR multiplier shown):
          <br />
          • 70°F, calm → 1.00. 50°F, calm → 0.97. 90°F, calm → 1.03.
          <br />
          • 70°F + 10 mph wind straight out → 1.20. Straight in → 0.80.
          <br />
          • 90°F + 15 mph wind out (Wrigley summer) → 1.34, capped at 1.40 max.
          <br />
          Magnitudes grounded in Alan Nathan&apos;s fly-ball-distance research and
          published wind-effect papers; constants are calibration targets.
        </p>
      </Section>

      <Section heading="Other factors">
        <ul className="ml-5 list-disc space-y-1.5 text-sm marker:text-ink-muted">
          <li><strong className="text-ink">TTO penalty</strong>: pitcher gets worse each time through the order. League-avg multipliers per outcome.</li>
          <li><strong className="text-ink">Bullpen leverage tier</strong>: high-leverage (closer/setup) vs rest, weighted by PA index.</li>
          <li><strong className="text-ink">Handedness splits</strong>: vsR / vsL for both batter rates and park factors (above).</li>
          <li><strong className="text-ink">Lineup status</strong>: confirmed lineups score full confidence; estimated lineups (built from recent starts via mode-slot assignment) reduce confidence.</li>
        </ul>
      </Section>

      <Section heading="Data sources">
        <ul className="ml-5 list-disc space-y-1.5 text-sm marker:text-ink-muted">
          <li>
            <a
              className="text-accent hover:underline"
              href="https://statsapi.mlb.com/"
              target="_blank"
              rel="noreferrer"
            >MLB Stats API</a> — schedule, lineups, pitcher / batter season stats, boxscores, BvP
          </li>
          <li>
            <a
              className="text-accent hover:underline"
              href="https://baseballsavant.mlb.com/"
              target="_blank"
              rel="noreferrer"
            >Baseball Savant</a> — Statcast metrics (barrel%, hard-hit%, xwOBA, whiff%)
          </li>
          <li>
            <a
              className="text-accent hover:underline"
              href="https://www.fangraphs.com/tools/guts"
              target="_blank"
              rel="noreferrer"
            >FanGraphs Guts!</a> — park factors:
            {' '}
            <a
              className="text-accent hover:underline"
              href="https://www.fangraphs.com/tools/guts?type=pf"
              target="_blank"
              rel="noreferrer"
            >per-outcome</a>
            {' (1B/2B/3B/HR/SO/BB) and '}
            <a
              className="text-accent hover:underline"
              href="https://www.fangraphs.com/tools/guts?type=pfh"
              target="_blank"
              rel="noreferrer"
            >per-handedness</a>
            {' (1B/2B/3B/HR by L vs R), 2025 season'}
          </li>
          <li>
            <a
              className="text-accent hover:underline"
              href="https://open-meteo.com/"
              target="_blank"
              rel="noreferrer"
            >Open-Meteo</a> — weather forecasts and archive (temp, wind speed, wind direction)
          </li>
        </ul>
        <p className="text-sm text-ink-muted">All data sources are free and require no API key.</p>
      </Section>
    </main>
  )
}

/** Section wrapper — consistent heading hierarchy and vertical rhythm across the page. */
function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-2xl font-semibold tracking-tight">{heading}</h2>
      <div className="space-y-3 text-base leading-relaxed text-ink-subtle">{children}</div>
    </section>
  )
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-card/60 p-4 font-mono text-sm leading-relaxed text-ink">
      {children}
    </pre>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-border/60 bg-card/60 px-1.5 py-0.5 font-mono text-[0.85em] text-accent">
      {children}
    </code>
  )
}

function Row({ label, h, r, rbi, hrr }: { label: string; h: number; r: number; rbi: number; hrr: number }) {
  return (
    <tr className="border-b border-border/50 last:border-b-0">
      <td className="px-3 py-2 text-ink">{label}</td>
      <td className="px-3 py-2 text-right text-ink-muted">{h}</td>
      <td className="px-3 py-2 text-right text-ink-muted">{r}</td>
      <td className="px-3 py-2 text-right text-ink-muted">{rbi}</td>
      <td className="px-3 py-2 text-right font-bold text-ink">{hrr}</td>
    </tr>
  )
}
