import {
  parseSavantBatterCsv,
  parseSavantPitcherCsv,
  mergeBatterXwobaCsv,
  mergePitcherXwobaCsv,
  getBatterStatcast,
  getPitcherStatcast,
} from '@/lib/savant-api'

// ---------------------------------------------------------------------------
// CSV parsers — pure, no network
// ---------------------------------------------------------------------------

const BATTER_CONTACT_HEADER =
  'player_id,attempts,avg_hit_speed,ev95percent,brl_percent'
const BATTER_XWOBA_HEADER =
  'player_id,year,pa,bip,ba,est_ba,est_ba_minus_ba_diff,slg,est_slg,est_slg_minus_slg_diff,woba,est_woba'
const PITCHER_CONTACT_HEADER =
  'player_id,attempts,avg_hit_speed,ev95percent,brl_percent'
const PITCHER_XWOBA_HEADER =
  'player_id,year,pa,bip,ba,est_ba,est_ba_minus_ba_diff,slg,est_slg,est_slg_minus_slg_diff,woba,est_woba'

describe('parseSavantBatterCsv', () => {
  it('parses real Savant column names into a typed store', () => {
    const csv = [
      BATTER_CONTACT_HEADER,
      // Aaron Judge: 17.5% barrels, 55.2% hard-hit, 93.5 mph avg EV
      '592450,250,93.5,55.2,17.5',
      '605141,200,90.0,48.1,12.0',
    ].join('\n')
    const store = parseSavantBatterCsv(csv)
    expect(store[592450]).toMatchObject({
      batterId: 592450,
      barrelPct: 0.175,
      hardHitPct: 0.552,
      avgExitVelo: 93.5,
      // xwOBA / xISO not yet merged — defaults to 0 until xwoba CSV lands.
      xwOBA: 0,
      xISO: 0,
    })
    expect(store[605141].barrelPct).toBeCloseTo(0.120, 6)
    expect(Object.keys(store)).toHaveLength(2)
  })

  it('skips rows with non-numeric player_id', () => {
    const csv = [
      BATTER_CONTACT_HEADER,
      'NotANumber,250,93.5,55,17',
      '592450,250,93.5,50,15',
    ].join('\n')
    const store = parseSavantBatterCsv(csv)
    expect(Object.keys(store)).toEqual(['592450'])
  })

  it('skips rows where the core signals are non-finite', () => {
    const csv = [
      BATTER_CONTACT_HEADER,
      '111,250,foo,bar,baz',
      '222,250,90,50,15',
    ].join('\n')
    const store = parseSavantBatterCsv(csv)
    expect(Object.keys(store)).toEqual(['222'])
  })

  it('returns empty store for header-only CSV', () => {
    expect(parseSavantBatterCsv(BATTER_CONTACT_HEADER)).toEqual({})
  })
})

describe('mergeBatterXwobaCsv', () => {
  it('merges est_woba and derives xISO into existing batter records', () => {
    const csv = [
      BATTER_CONTACT_HEADER,
      '592450,250,93.5,55.2,17.5',
    ].join('\n')
    const store = parseSavantBatterCsv(csv)

    const xwoba = [
      BATTER_XWOBA_HEADER,
      '592450,2026,300,200,0.270,0.290,0.020,0.520,0.560,0.040,0.380,0.420',
    ].join('\n')
    mergeBatterXwobaCsv(xwoba, store)

    expect(store[592450].xwOBA).toBeCloseTo(0.420, 6)
    // xISO ≈ est_slg − est_ba = 0.560 − 0.290 = 0.270
    expect(store[592450].xISO).toBeCloseTo(0.270, 6)
  })

  it('adds new batters present only in the xwOBA CSV with neutral barrel/hardHit', () => {
    const store = {}
    mergeBatterXwobaCsv(
      [
        BATTER_XWOBA_HEADER,
        '700000,2026,300,200,0.270,0.290,0.020,0.520,0.560,0.040,0.380,0.420',
      ].join('\n'),
      store,
    )
    expect(store[700000]).toMatchObject({
      batterId: 700000,
      barrelPct: 0,
      hardHitPct: 0,
      xwOBA: 0.420,
    })
  })
})

describe('parseSavantPitcherCsv', () => {
  it('parses real Savant pitcher CSV column names', () => {
    const csv = [
      PITCHER_CONTACT_HEADER,
      '543037,300,88.5,38.0,7.2',
      '676440,250,90.1,42.0,6.0',
    ].join('\n')
    const store = parseSavantPitcherCsv(csv)
    expect(store[543037].pitcherId).toBe(543037)
    expect(store[543037].barrelsAllowedPct).toBeCloseTo(0.072, 6)
    expect(store[543037].hardHitPctAllowed).toBeCloseTo(0.380, 6)
    // xwOBAAllowed defaults to 0 until merged.
    expect(store[543037].xwOBAAllowed).toBe(0)
    expect(Object.keys(store)).toHaveLength(2)
  })

  it('skips rows with non-finite percentages', () => {
    const csv = [
      PITCHER_CONTACT_HEADER,
      '111,300,foo,bar,baz',
      '222,300,88,40,7',
    ].join('\n')
    const store = parseSavantPitcherCsv(csv)
    expect(Object.keys(store)).toEqual(['222'])
  })
})

describe('mergePitcherXwobaCsv', () => {
  it('merges est_woba into existing pitcher records as xwOBAAllowed', () => {
    const store = parseSavantPitcherCsv(
      [PITCHER_CONTACT_HEADER, '543037,300,88.5,38,7.2'].join('\n'),
    )
    mergePitcherXwobaCsv(
      [PITCHER_XWOBA_HEADER, '543037,2026,400,300,0.220,0.230,0.010,0.350,0.340,-0.010,0.290,0.295'].join('\n'),
      store,
    )
    expect(store[543037].xwOBAAllowed).toBeCloseTo(0.295, 6)
  })
})

// ---------------------------------------------------------------------------
// getBatterStatcast / getPitcherStatcast — mocked fetch
// ---------------------------------------------------------------------------

describe('savant store loaders (mocked fetch)', () => {
  let fetchSpy: jest.SpyInstance
  afterEach(() => {
    fetchSpy?.mockRestore()
    jest.resetModules()
  })

  function mockBatterCsv(rows: number) {
    const contactLines = [BATTER_CONTACT_HEADER]
    const xwobaLines = [BATTER_XWOBA_HEADER]
    for (let i = 0; i < rows; i++) {
      const id = 600000 + i
      contactLines.push(`${id},250,${90 + (i % 5)},${40 + (i % 8)},${10 + (i % 10)}`)
      xwobaLines.push(`${id},2099,300,200,0.27,0.28,0.01,0.45,0.46,0.01,0.36,0.37`)
    }
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: string | URL) => {
      const u = url.toString()
      const body =
        u.includes('expected_statistics') ? xwobaLines.join('\n') : contactLines.join('\n')
      return { ok: true, text: async () => body } as Response
    })
  }

  it('getBatterStatcast returns a parsed entry for a known batter, with xwOBA merged', async () => {
    mockBatterCsv(60)
    const sc = await getBatterStatcast(600005, 2099)
    expect(sc).not.toBeNull()
    expect(sc?.batterId).toBe(600005)
    expect(sc?.barrelPct).toBeGreaterThanOrEqual(0)
    expect(sc?.barrelPct).toBeLessThanOrEqual(1)
    expect(sc?.xwOBA).toBeGreaterThan(0)  // merge worked
  })

  it('getBatterStatcast returns null for an unknown batter ID', async () => {
    mockBatterCsv(60)
    const sc = await getBatterStatcast(999999999, 2098)
    expect(sc).toBeNull()
  })

  it('getBatterStatcast returns null when CSV has too few rows (Savant outage)', async () => {
    mockBatterCsv(5)
    const sc = await getBatterStatcast(600003, 2097)
    expect(sc).toBeNull()
  })

  it('getPitcherStatcast returns a parsed entry for a known pitcher', async () => {
    const contactLines = [PITCHER_CONTACT_HEADER]
    const xwobaLines = [PITCHER_XWOBA_HEADER]
    for (let i = 0; i < 60; i++) {
      const id = 700000 + i
      contactLines.push(`${id},300,${88 + (i % 4)},${38 + (i % 7)},${5 + (i % 6)}`)
      xwobaLines.push(`${id},2096,400,300,0.22,0.23,0.01,0.35,0.34,-0.01,0.29,0.30`)
    }
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: string | URL) => {
      const u = url.toString()
      const body =
        u.includes('expected_statistics') ? xwobaLines.join('\n') : contactLines.join('\n')
      return { ok: true, text: async () => body } as Response
    })
    const sc = await getPitcherStatcast(700010, 2096)
    expect(sc).not.toBeNull()
    expect(sc?.pitcherId).toBe(700010)
    expect(sc?.hardHitPctAllowed).toBeGreaterThan(0)
    expect(sc?.xwOBAAllowed).toBeGreaterThan(0)
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
