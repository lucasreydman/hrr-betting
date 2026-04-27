import {
  parseSavantBatterCsv,
  parseSavantPitcherCsv,
  getBatterStatcast,
  getPitcherStatcast,
} from '@/lib/savant-api'

// ---------------------------------------------------------------------------
// CSV parsers — pure, no network
// ---------------------------------------------------------------------------

describe('parseSavantBatterCsv', () => {
  it('parses a well-formed batter CSV into a typed store', () => {
    const csv = [
      'player_id,barrel_batted_rate,hard_hit_percent,xwoba,xiso,avg_exit_velo',
      '592450,17.5,55.2,0.420,0.290,93.5',
      '605141,12.0,48.1,0.380,0.220,90.0',
    ].join('\n')
    const store = parseSavantBatterCsv(csv)
    expect(store[592450]).toMatchObject({
      batterId: 592450,
      barrelPct: 0.175,    // 17.5 / 100
      hardHitPct: 0.552,   // 55.2 / 100
      xwOBA: 0.420,
      xISO: 0.290,
      avgExitVelo: 93.5,
    })
    expect(store[605141].barrelPct).toBeCloseTo(0.120, 6)
    expect(Object.keys(store)).toHaveLength(2)
  })

  it('skips rows with non-numeric player_id', () => {
    const csv = [
      'player_id,barrel_batted_rate,hard_hit_percent,xwoba',
      'NotANumber,12,40,0.350',
      '592450,15,50,0.400',
    ].join('\n')
    const store = parseSavantBatterCsv(csv)
    expect(Object.keys(store)).toEqual(['592450'])
  })

  it('skips rows with non-finite percentages', () => {
    const csv = [
      'player_id,barrel_batted_rate,hard_hit_percent,xwoba',
      '111,foo,bar,baz',
      '222,15,50,0.400',
    ].join('\n')
    const store = parseSavantBatterCsv(csv)
    expect(Object.keys(store)).toEqual(['222'])
  })

  it('returns empty store for empty CSV', () => {
    const store = parseSavantBatterCsv('player_id,barrel_batted_rate,hard_hit_percent,xwoba')
    expect(store).toEqual({})
  })
})

describe('parseSavantPitcherCsv', () => {
  it('parses a well-formed pitcher CSV into a typed store', () => {
    const csv = [
      'player_id,barrels_per_pa,hard_hit_percent,xwoba_against,whiff_percent',
      '543037,7.2,38.0,0.290,33.5',
      '676440,6.0,42.0,0.310,28.0',
    ].join('\n')
    const store = parseSavantPitcherCsv(csv)
    expect(store[543037].pitcherId).toBe(543037)
    expect(store[543037].barrelsAllowedPct).toBeCloseTo(0.072, 6)
    expect(store[543037].hardHitPctAllowed).toBeCloseTo(0.380, 6)
    expect(store[543037].xwOBAAllowed).toBeCloseTo(0.290, 6)
    expect(store[543037].whiffPct).toBeCloseTo(0.335, 6)
    expect(Object.keys(store)).toHaveLength(2)
  })

  it('skips rows with non-finite percentages', () => {
    const csv = [
      'player_id,barrels_per_pa,hard_hit_percent,xwoba_against,whiff_percent',
      '111,foo,bar,baz,qux',
      '222,7,40,0.300,30',
    ].join('\n')
    const store = parseSavantPitcherCsv(csv)
    expect(Object.keys(store)).toEqual(['222'])
  })
})

// ---------------------------------------------------------------------------
// getBatterStatcast / getPitcherStatcast — mocked fetch
// ---------------------------------------------------------------------------

describe('savant store loaders (mocked fetch)', () => {
  let fetchSpy: jest.SpyInstance
  afterEach(() => {
    fetchSpy?.mockRestore()
    jest.resetModules()  // clear in-memory KV between tests
  })

  function mockBatterCsv(rows: number) {
    // Need ≥ MIN_REASONABLE_SAVANT_ROWS (50) rows for the store to be cached & returned.
    const lines = ['player_id,barrel_batted_rate,hard_hit_percent,xwoba,xiso,avg_exit_velo']
    for (let i = 0; i < rows; i++) {
      const id = 600000 + i
      lines.push(`${id},${10 + (i % 10)},${40 + (i % 8)},0.${300 + (i % 50)},0.${150 + (i % 80)},${90 + (i % 5)}`)
    }
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => lines.join('\n'),
    } as Response)
  }

  it('getBatterStatcast returns a parsed entry for a known batter', async () => {
    mockBatterCsv(60)
    // Use a year that hasn't been pulled before to avoid kv cache hits from prior tests
    const sc = await getBatterStatcast(600005, 2099)
    expect(sc).not.toBeNull()
    expect(sc?.batterId).toBe(600005)
    expect(sc?.barrelPct).toBeGreaterThanOrEqual(0)
    expect(sc?.barrelPct).toBeLessThanOrEqual(1)
  })

  it('getBatterStatcast returns null for an unknown batter ID', async () => {
    mockBatterCsv(60)
    const sc = await getBatterStatcast(999999999, 2098)
    expect(sc).toBeNull()
  })

  it('getBatterStatcast returns null when CSV has too few rows (likely a Savant outage)', async () => {
    mockBatterCsv(5)  // below MIN_REASONABLE_SAVANT_ROWS = 50
    const sc = await getBatterStatcast(600003, 2097)
    expect(sc).toBeNull()
  })

  it('getPitcherStatcast returns a parsed entry for a known pitcher', async () => {
    const lines = ['player_id,barrels_per_pa,hard_hit_percent,xwoba_against,whiff_percent']
    for (let i = 0; i < 60; i++) {
      const id = 700000 + i
      lines.push(`${id},${5 + (i % 6)},${38 + (i % 7)},0.${290 + (i % 40)},${28 + (i % 8)}`)
    }
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => lines.join('\n'),
    } as Response)
    const sc = await getPitcherStatcast(700010, 2096)
    expect(sc).not.toBeNull()
    expect(sc?.pitcherId).toBe(700010)
    expect(sc?.whiffPct).toBeGreaterThanOrEqual(0)
    expect(sc?.whiffPct).toBeLessThanOrEqual(1)
  })

  it('returns null gracefully on Savant fetch failure', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '',
    } as Response)
    const sc = await getBatterStatcast(600100, 2095)
    expect(sc).toBeNull()
  })
})
