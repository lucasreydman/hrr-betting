import Link from 'next/link'

export const metadata = {
  title: 'HRR Betting — Methodology',
  description: 'How the model works: factors, math, and sources',
}

export default function Methodology() {
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8 prose prose-invert">
      <header>
        <h1 className="text-3xl font-semibold">Methodology</h1>
        <p className="text-ink-muted">How the model works — every factor, formula, and source.</p>
      </header>

      <section>
        <h2 className="text-2xl font-semibold mb-3">The HRR prop</h2>
        <p>HRR = Hits + Runs scored + RBIs, summed over the player&apos;s full game. Three rungs: 1+, 2+, 3+ HRR.</p>
        <table className="w-full text-sm font-mono mt-3 border border-border rounded">
          <thead className="bg-card/30">
            <tr><th className="p-2 text-left">Outcome</th><th className="p-2 text-right">H</th><th className="p-2 text-right">R</th><th className="p-2 text-right">RBI</th><th className="p-2 text-right">HRR</th></tr>
          </thead>
          <tbody>
            <tr className="border-t border-border/50"><td className="p-2">Solo HR</td><td className="p-2 text-right">1</td><td className="p-2 text-right">1</td><td className="p-2 text-right">1</td><td className="p-2 text-right font-bold">3</td></tr>
            <tr className="border-t border-border/50"><td className="p-2">Walk + score</td><td className="p-2 text-right">0</td><td className="p-2 text-right">1</td><td className="p-2 text-right">0</td><td className="p-2 text-right font-bold">1</td></tr>
            <tr className="border-t border-border/50"><td className="p-2">Sac fly</td><td className="p-2 text-right">0</td><td className="p-2 text-right">0</td><td className="p-2 text-right">1</td><td className="p-2 text-right font-bold">1</td></tr>
            <tr className="border-t border-border/50"><td className="p-2">Grand slam</td><td className="p-2 text-right">1</td><td className="p-2 text-right">1</td><td className="p-2 text-right">4</td><td className="p-2 text-right font-bold">6</td></tr>
            <tr className="border-t border-border/50"><td className="p-2">Reach on error + score</td><td className="p-2 text-right">0</td><td className="p-2 text-right">1</td><td className="p-2 text-right">0</td><td className="p-2 text-right font-bold">1</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-3">EDGE &amp; SCORE</h2>
        <p>The model&apos;s single ranking metric:</p>
        <pre className="bg-card/50 p-4 rounded text-sm font-mono overflow-x-auto">
{`EDGE = P_matchup / max(P_typical, 0.01) − 1
SCORE = EDGE × confidence`}
        </pre>
        <p>
          <code className="text-accent">P_matchup</code> is the model&apos;s probability for clearing the rung in this specific matchup (from the simulator).
          <code className="text-accent ml-1">P_typical</code> is the same player&apos;s average probability across their season&apos;s actual matchups —
          this is the key denominator that isolates <em>matchup</em> edge from <em>player skill</em> (since books already price skill into the line).
        </p>
        <p><code className="text-accent">confidence</code> is a graded multiplier (0.55–1.00) based on lineup confirmation, BvP sample size, weather stability, etc.</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-3">Tracked vs Watching</h2>
        <p>A pick is <span className="text-tracked">Tracked</span> only if all three conditions clear:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><code>confidence ≥ 0.85</code></li>
          <li><code>EDGE ≥ floor(rung)</code> — 0.10 / 0.30 / 0.60 for rungs 1+ / 2+ / 3+</li>
          <li><code>P_matchup ≥ floor(rung)</code> — 0.85 / 0.55 / 0.20</li>
        </ul>
        <p className="text-ink-muted text-sm">
          Both EDGE and probability floors must clear because each catches a different failure mode:
          a 30% prob at 3+ has huge EDGE but is still a coin-flip on the bad side; an Aaron Judge 3+ in a neutral matchup has high prob but no real edge.
        </p>
        <p>Other picks above a low display floor are shown as <em>Watching</em> — informational, not counted in the success rate.</p>
        <p className="text-ink-muted text-sm">
          Volume of Tracked picks varies by slate — could be 0 on a weak day, could be many on a strong day. Days with 0 record as <code>0/0</code> (no dilution).
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-3">Per-PA outcome distribution</h2>
        <p>For each plate appearance, the model samples one of seven outcomes: <code>1B / 2B / 3B / HR / BB / K / OUT</code>. Probabilities come from a hybrid log-5 + Statcast formula:</p>
        <pre className="bg-card/50 p-4 rounded text-sm font-mono overflow-x-auto">
{`P(outcome | batter, pitcher) =
    batter_rate × (pitcher_rate / lg_avg) × park × weather × tto`}
        </pre>
        <p>Statcast adjustments (barrel%, hard-hit%, whiff%) layer on top. BvP regression (career batter-vs-pitcher splits) is applied weighted by <code>starter_share</code> — only for the fraction of PAs facing the starter, not the bullpen.</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-3">Lineup-aware Monte Carlo</h2>
        <p>For each game, the model simulates 10,000 iterations of the full game with all 9 batters of each team. Per-PA outcomes draw from the distribution above; <code>applyOutcome</code> evolves the bases state realistically. Runs are credited to the runner who scored, RBIs to the batter who drove them in.</p>
        <p>This captures the HR-trifecta correlation (a solo HR = +1 H, +1 R, +1 RBI in one swing) that closed-form Poisson models systematically under-price for power hitters.</p>
        <p className="text-ink-muted text-sm">v1: 9-inning sims, no extras (impact &lt; 0.5% absolute on rung probabilities).</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-3">Stabilization &amp; recent form</h2>
        <p>Player rate stats are stabilized using empirical sample-size points (Russell Carleton&apos;s research):</p>
        <ul className="list-disc list-inside text-sm space-y-1">
          <li>K rate stabilizes ~60 PAs</li>
          <li>BB rate ~120 PAs</li>
          <li>HR rate ~170 PAs</li>
          <li>BABIP ~800 PAs</li>
        </ul>
        <p>Critically, the regression target is the player&apos;s <strong>career rate</strong>, not league mean — this preserves true skill differences. Recent form (L15, L30) is then blended in with weights that shift through the season (early year favors stabilized; late year favors recent).</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-3">Other factors</h2>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>TTO penalty</strong>: pitcher gets worse each time through the order. League-avg multipliers per outcome.</li>
          <li><strong>Bullpen leverage tier</strong>: high-leverage (closer/setup) vs rest, weighted by PA index.</li>
          <li><strong>Park factors</strong>: 30 stadiums, per-outcome (HR-specific).</li>
          <li><strong>Weather</strong>: temp + wind direction affect HR rate.</li>
          <li><strong>Handedness splits</strong>: vsR / vsL for both batter and pitcher.</li>
          <li><strong>Lineup status</strong>: confirmed lineups score full confidence; estimated lineups (from recent starts) reduce confidence.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-3">Data sources</h2>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><a href="https://statsapi.mlb.com/" className="text-accent hover:underline" target="_blank" rel="noreferrer">MLB Stats API</a> — schedule, lineups, pitcher/batter season stats, boxscores, BvP</li>
          <li><a href="https://baseballsavant.mlb.com/" className="text-accent hover:underline" target="_blank" rel="noreferrer">Baseball Savant</a> — Statcast metrics (barrel%, hard-hit%, xwOBA, whiff%)</li>
          <li><a href="https://open-meteo.com/" className="text-accent hover:underline" target="_blank" rel="noreferrer">Open-Meteo</a> — weather forecasts and archive (temp, wind speed, wind direction)</li>
        </ul>
        <p className="text-ink-muted text-sm">All data sources are free and require no API key.</p>
      </section>

      <footer className="pt-8 text-center text-xs text-ink-muted">
        <Link href="/" className="hover:text-accent">← board</Link>
        <span className="mx-2">·</span>
        <a href="/history" className="hover:text-accent">history</a>
      </footer>
    </main>
  )
}
