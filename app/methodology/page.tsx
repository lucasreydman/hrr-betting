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
        <div className="overflow-hidden rounded-lg border border-border bg-card/30">
          <table className="w-full text-sm font-mono">
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

      <Section heading="Other factors">
        <ul className="ml-5 list-disc space-y-1.5 text-sm marker:text-ink-muted">
          <li><strong className="text-ink">TTO penalty</strong>: pitcher gets worse each time through the order. League-avg multipliers per outcome.</li>
          <li><strong className="text-ink">Bullpen leverage tier</strong>: high-leverage (closer/setup) vs rest, weighted by PA index.</li>
          <li><strong className="text-ink">Park factors</strong>: 30 stadiums, per-outcome (HR-specific).</li>
          <li><strong className="text-ink">Weather</strong>: temp + wind direction affect HR rate.</li>
          <li><strong className="text-ink">Handedness splits</strong>: vsR / vsL for both batter and pitcher.</li>
          <li><strong className="text-ink">Lineup status</strong>: confirmed lineups score full confidence; estimated lineups (from recent starts) reduce confidence.</li>
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
