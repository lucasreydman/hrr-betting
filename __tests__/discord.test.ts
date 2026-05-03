import {
  buildLockEmbed,
  buildSettleDigestEmbed,
  postWebhook,
  postLockNotifications,
  postSettleDigest,
  isDiscordEnabled,
} from '@/lib/discord'
import type { LockedPickRow, SettledPickRow } from '@/lib/db'
import type { Game } from '@/lib/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function lockedRow(over: Partial<LockedPickRow> = {}): LockedPickRow {
  return {
    id: 1,
    date: '2026-04-29',
    game_id: 100,
    rung: 1,
    player_id: 592450,
    player_name: 'Aaron Judge',
    player_team: 'NYY',
    player_bats: 'R',
    opponent_team_id: 140,
    opponent_abbrev: 'TEX',
    lineup_slot: 2,
    lineup_status: 'confirmed',
    p_matchup: 0.88,
    p_typical: 0.74,
    edge: 0.14,
    confidence: 0.91,
    score: 0.42,
    ...over,
  }
}

function settledRow(over: Partial<SettledPickRow> = {}): SettledPickRow {
  return {
    ...lockedRow(),
    outcome: 'HIT',
    actual_hrr: 1,
    ...over,
  }
}

const sampleGame: Game = {
  gameId: 100,
  gameDate: '2026-04-30T00:05:00Z',  // 8:05 PM ET
  homeTeam: { teamId: 140, abbrev: 'TEX', name: 'Texas Rangers' },
  awayTeam: { teamId: 147, abbrev: 'NYY', name: 'New York Yankees' },
  venueId: 5325,
  venueName: 'Globe Life Field',
  status: 'scheduled',
}

// ---------------------------------------------------------------------------
// buildLockEmbed
// ---------------------------------------------------------------------------

describe('buildLockEmbed', () => {
  test('throws on empty picks (caller bug; should never happen)', () => {
    expect(() => buildLockEmbed({ picks: [] })).toThrow()
  })

  test('uses schedule game for AWAY @ HOME title', () => {
    const embed = buildLockEmbed({
      picks: [lockedRow()],
      game: sampleGame,
    })
    expect(embed.title).toBe('🔒 Tracked locked — NYY @ TEX')
    expect(embed.color).toBe(0x3b82f6)
  })

  test('embed title is clickable (url field set to live board)', () => {
    const embed = buildLockEmbed({ picks: [lockedRow()], game: sampleGame })
    expect(embed.url).toBe('https://hrr-betting.vercel.app/')
  })

  test('falls back to row metadata when game lookup is missing', () => {
    const embed = buildLockEmbed({ picks: [lockedRow()] })
    // No "@ HOME" because we don't know which side is home — fall back to "vs OPP"
    expect(embed.title).toContain('NYY vs TEX')
    expect(embed.description).toBeUndefined()
  })

  test('includes first-pitch unix time in description when game provided', () => {
    const embed = buildLockEmbed({ picks: [lockedRow()], game: sampleGame })
    const expectedUnix = Math.floor(new Date(sampleGame.gameDate).getTime() / 1000)
    expect(embed.description).toContain(`<t:${expectedUnix}:t>`)
    expect(embed.description).toContain(`<t:${expectedUnix}:R>`)
  })

  test('groups same player across multiple rungs into one field', () => {
    const embed = buildLockEmbed({
      picks: [
        lockedRow({ rung: 1, p_matchup: 0.88, edge: 0.14 }),
        lockedRow({ rung: 2, p_matchup: 0.75, edge: 0.32 }),
      ],
      game: sampleGame,
    })
    expect(embed.fields).toHaveLength(1)
    const field = embed.fields![0]
    expect(field.name).toContain('Aaron Judge')
    expect(field.name).toContain('NYY')
    expect(field.name).toContain('#2')
    expect(field.name).toContain('RHB')
    expect(field.value).toContain('1+ HRR')
    expect(field.value).toContain('2+ HRR')
    expect(field.value).toContain('prob 0.88')
    expect(field.value).toContain('edge +0.14')
    expect(field.value).toContain('edge +0.32')
  })

  test('orders fields by lineup slot ascending', () => {
    const embed = buildLockEmbed({
      picks: [
        lockedRow({ player_id: 1, player_name: 'Slot 5', lineup_slot: 5 }),
        lockedRow({ player_id: 2, player_name: 'Slot 2', lineup_slot: 2 }),
        lockedRow({ player_id: 3, player_name: 'Slot 4', lineup_slot: 4 }),
      ],
      game: sampleGame,
    })
    expect(embed.fields![0].name).toContain('Slot 2')
    expect(embed.fields![1].name).toContain('Slot 4')
    expect(embed.fields![2].name).toContain('Slot 5')
  })

  test('formats negative edges with explicit minus', () => {
    const embed = buildLockEmbed({
      picks: [lockedRow({ edge: -0.05 })],
      game: sampleGame,
    })
    expect(embed.fields![0].value).toContain('edge -0.05')
  })

  test('appends opposing pitcher to footer when provided', () => {
    const embed = buildLockEmbed({
      picks: [lockedRow()],
      game: sampleGame,
      opposingPitcher: { name: 'Nathan Eovaldi', throws: 'R' },
    })
    expect(embed.footer?.text).toContain('Nathan Eovaldi')
    expect(embed.footer?.text).toContain('RHP')
  })

  test('omits footer when no pitcher provided', () => {
    const embed = buildLockEmbed({ picks: [lockedRow()], game: sampleGame })
    expect(embed.footer).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildSettleDigestEmbed
// ---------------------------------------------------------------------------

describe('buildSettleDigestEmbed', () => {
  test('returns null on empty rows', () => {
    expect(buildSettleDigestEmbed({ date: '2026-04-29', rows: [] })).toBeNull()
  })

  test('summarises per-rung W/L with hit rate vs predicted', () => {
    const embed = buildSettleDigestEmbed({
      date: '2026-04-29',
      rows: [
        settledRow({ rung: 1, outcome: 'HIT', p_matchup: 0.88 }),
        settledRow({ rung: 1, outcome: 'HIT', p_matchup: 0.86, player_id: 2 }),
        settledRow({ rung: 1, outcome: 'MISS', p_matchup: 0.85, player_id: 3 }),
      ],
    })!
    expect(embed.title).toBe('📊 Tracked recap — 2026-04-29')
    expect(embed.description).toContain('1+ HRR')
    expect(embed.description).toContain('✅ 2')
    expect(embed.description).toContain('❌ 1')
    expect(embed.description).toContain('66.7%')
  })

  test('marks rungs with no picks as such', () => {
    const embed = buildSettleDigestEmbed({
      date: '2026-04-29',
      rows: [settledRow({ rung: 1 })],
    })!
    expect(embed.description).toContain('**2+ HRR** — no tracked picks')
    expect(embed.description).toContain('**3+ HRR** — no tracked picks')
  })

  test('separates hits and misses into their own fields', () => {
    const embed = buildSettleDigestEmbed({
      date: '2026-04-29',
      rows: [
        settledRow({ player_id: 1, player_name: 'Hitter A', outcome: 'HIT', actual_hrr: 4 }),
        settledRow({ player_id: 2, player_name: 'Misser B', outcome: 'MISS', actual_hrr: 0 }),
      ],
    })!
    const hitField = embed.fields!.find(f => f.name.includes('Hits'))
    const missField = embed.fields!.find(f => f.name.includes('Misses'))
    expect(hitField?.value).toContain('Hitter A')
    expect(hitField?.value).toContain('4')
    expect(missField?.value).toContain('Misser B')
  })

  test('uses green color when overall hit rate >= 50%', () => {
    const embed = buildSettleDigestEmbed({
      date: '2026-04-29',
      rows: [
        settledRow({ player_id: 1, outcome: 'HIT' }),
        settledRow({ player_id: 2, outcome: 'HIT' }),
        settledRow({ player_id: 3, outcome: 'MISS' }),
      ],
    })!
    expect(embed.color).toBe(0x22c55e)
  })

  test('uses neutral color when overall hit rate < 50%', () => {
    const embed = buildSettleDigestEmbed({
      date: '2026-04-29',
      rows: [
        settledRow({ player_id: 1, outcome: 'HIT' }),
        settledRow({ player_id: 2, outcome: 'MISS' }),
        settledRow({ player_id: 3, outcome: 'MISS' }),
      ],
    })!
    expect(embed.color).toBe(0x6b7280)
  })

  test('footer counts distinct games', () => {
    const embed = buildSettleDigestEmbed({
      date: '2026-04-29',
      rows: [
        settledRow({ game_id: 100, player_id: 1 }),
        settledRow({ game_id: 100, player_id: 2 }),
        settledRow({ game_id: 200, player_id: 3 }),
      ],
    })!
    expect(embed.footer?.text).toContain('3 picks')
    expect(embed.footer?.text).toContain('2 games')
  })
})

// ---------------------------------------------------------------------------
// postWebhook + isDiscordEnabled
// ---------------------------------------------------------------------------

describe('postWebhook', () => {
  const ORIGINAL_FETCH = global.fetch
  const ORIGINAL_URL = process.env.DISCORD_WEBHOOK_URL

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH
    if (ORIGINAL_URL === undefined) delete process.env.DISCORD_WEBHOOK_URL
    else process.env.DISCORD_WEBHOOK_URL = ORIGINAL_URL
  })

  test('returns false when env var is unset (no fetch attempted)', async () => {
    delete process.env.DISCORD_WEBHOOK_URL
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const ok = await postWebhook({ embeds: [{ title: 'x' }] })
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isDiscordEnabled()).toBe(false)
  })

  test('returns false on empty embeds (no fetch attempted)', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const ok = await postWebhook({ embeds: [] })
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('POSTs JSON body to the configured URL and returns true on 2xx', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
    global.fetch = fetchMock as unknown as typeof fetch
    const ok = await postWebhook({ embeds: [{ title: 'hi' }] })
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/x/y',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    )
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sentBody.embeds[0].title).toBe('hi')
  })

  test('returns false on non-2xx (does not throw)', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    global.fetch = jest.fn().mockResolvedValue(new Response('no', { status: 429 })) as unknown as typeof fetch
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const ok = await postWebhook({ embeds: [{ title: 'hi' }] })
    expect(ok).toBe(false)
    errSpy.mockRestore()
  })

  test('returns false on network error (does not throw)', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const ok = await postWebhook({ embeds: [{ title: 'hi' }] })
    expect(ok).toBe(false)
    errSpy.mockRestore()
  })

  test('strips matching surrounding quotes from env var', async () => {
    process.env.DISCORD_WEBHOOK_URL = '"https://discord.com/api/webhooks/x/y"'
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
    global.fetch = fetchMock as unknown as typeof fetch
    await postWebhook({ embeds: [{ title: 'hi' }] })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/x/y',
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// postLockNotifications
// ---------------------------------------------------------------------------

describe('postLockNotifications', () => {
  const ORIGINAL_FETCH = global.fetch
  const ORIGINAL_URL = process.env.DISCORD_WEBHOOK_URL
  const ORIGINAL_MENTION = process.env.DISCORD_LOCK_MENTION

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH
    if (ORIGINAL_URL === undefined) delete process.env.DISCORD_WEBHOOK_URL
    else process.env.DISCORD_WEBHOOK_URL = ORIGINAL_URL
    if (ORIGINAL_MENTION === undefined) delete process.env.DISCORD_LOCK_MENTION
    else process.env.DISCORD_LOCK_MENTION = ORIGINAL_MENTION
  })

  test('no-ops when env var is unset', async () => {
    delete process.env.DISCORD_WEBHOOK_URL
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const result = await postLockNotifications({
      pendingRows: [lockedRow()],
      gameLookup: new Map(),
    })
    expect(result.gamesPosted).toBe(0)
    expect(result.notifiedIds).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('posts one embed per game and returns notified ids', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await postLockNotifications({
      pendingRows: [
        lockedRow({ id: 10, game_id: 100, player_id: 1, player_name: 'Game100A' }),
        lockedRow({ id: 11, game_id: 100, player_id: 2, player_name: 'Game100B' }),
        lockedRow({ id: 12, game_id: 200, player_id: 3, player_name: 'Game200A' }),
      ],
      gameLookup: new Map([[100, sampleGame]]),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)  // one per game
    expect(result.gamesPosted).toBe(2)
    expect(result.notifiedIds.sort()).toEqual([10, 11, 12])
  })

  test('default lock mention is @everyone with allowed_mentions', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    delete process.env.DISCORD_LOCK_MENTION
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
    global.fetch = fetchMock as unknown as typeof fetch

    await postLockNotifications({
      pendingRows: [lockedRow()],
      gameLookup: new Map(),
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.content).toBe('@everyone')
    expect(body.allowed_mentions?.parse).toContain('everyone')
  })

  test('DISCORD_LOCK_MENTION override is used when set', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    process.env.DISCORD_LOCK_MENTION = '<@123456789>'
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
    global.fetch = fetchMock as unknown as typeof fetch

    await postLockNotifications({
      pendingRows: [lockedRow()],
      gameLookup: new Map(),
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.content).toBe('<@123456789>')
    expect(body.allowed_mentions?.parse).toEqual(expect.arrayContaining(['users']))
  })

  test('empty DISCORD_LOCK_MENTION disables mention entirely', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    process.env.DISCORD_LOCK_MENTION = ''
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
    global.fetch = fetchMock as unknown as typeof fetch

    await postLockNotifications({
      pendingRows: [lockedRow()],
      gameLookup: new Map(),
    })

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.content).toBeUndefined()
    expect(body.allowed_mentions).toBeUndefined()
  })

  test('does not include row ids for failed POSTs', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    let call = 0
    const fetchMock = jest.fn().mockImplementation(async () => {
      call++
      if (call === 1) return new Response(null, { status: 204 })
      return new Response('no', { status: 500 })
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await postLockNotifications({
      pendingRows: [
        lockedRow({ id: 10, game_id: 100 }),
        lockedRow({ id: 12, game_id: 200, player_id: 3 }),
      ],
      gameLookup: new Map(),
    })

    expect(result.gamesPosted).toBe(1)
    expect(result.notifiedIds).toEqual([10])
    errSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// postSettleDigest
// ---------------------------------------------------------------------------

describe('postSettleDigest', () => {
  const ORIGINAL_FETCH = global.fetch
  const ORIGINAL_URL = process.env.DISCORD_WEBHOOK_URL

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH
    if (ORIGINAL_URL === undefined) delete process.env.DISCORD_WEBHOOK_URL
    else process.env.DISCORD_WEBHOOK_URL = ORIGINAL_URL
  })

  test('returns false when env var is unset', async () => {
    delete process.env.DISCORD_WEBHOOK_URL
    const ok = await postSettleDigest({ date: '2026-04-29', rows: [settledRow()] })
    expect(ok).toBe(false)
  })

  test('returns false on empty rows (no post)', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const ok = await postSettleDigest({ date: '2026-04-29', rows: [] })
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('posts a digest embed and returns true on success', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/x/y'
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }))
    global.fetch = fetchMock as unknown as typeof fetch
    const ok = await postSettleDigest({ date: '2026-04-29', rows: [settledRow()] })
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.embeds[0].title).toContain('2026-04-29')
  })
})
