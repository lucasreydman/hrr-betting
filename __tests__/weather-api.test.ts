import { fetchWeather, getStadiumConstants, getOutfieldFacingDegrees } from '@/lib/weather-api'

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1'
const maybe = RUN_LIVE ? test : test.skip

describe('weather-api', () => {
  describe('getStadiumConstants', () => {
    it('returns stadium info for valid venueId', () => {
      const stadium = getStadiumConstants(3313)
      expect(stadium).not.toBeNull()
      expect(stadium?.name).toBe('Yankee Stadium')
      expect(stadium?.venueId).toBe(3313)
    })

    it('returns null for invalid venueId', () => {
      const stadium = getStadiumConstants(99999)
      expect(stadium).toBeNull()
    })
  })

  describe('getOutfieldFacingDegrees', () => {
    it('returns outfield facing degrees for valid venueId', () => {
      const degrees = getOutfieldFacingDegrees(3313)
      expect(degrees).toBe(25)
    })

    it('returns 0 for invalid venueId', () => {
      const degrees = getOutfieldFacingDegrees(99999)
      expect(degrees).toBe(0)
    })
  })

  maybe('fetchWeather returns temp for Yankee Stadium', async () => {
    const w = await fetchWeather(3313, '2025-07-04T19:05:00Z')
    expect(w.tempF).toBeGreaterThan(0)
    expect(w.windSpeedMph).toBeGreaterThanOrEqual(0)
    expect(w.windFromDegrees).toBeGreaterThanOrEqual(0)
    expect(w.windFromDegrees).toBeLessThanOrEqual(360)
    expect(w.failure).toBe(false)
    expect(w.controlled).toBe(false)
  }, 30_000)

  maybe('fetchWeather returns weather controlled flag for domed stadiums', async () => {
    const w = await fetchWeather(12, '2025-07-04T19:05:00Z') // Tropicana Field
    expect(w.controlled).toBe(true)
    expect(w.windSpeedMph).toBe(0)
  }, 30_000)

  it('returns sensible defaults on invalid venueId', async () => {
    const w = await fetchWeather(99999, '2025-07-04T19:05:00Z')
    expect(w.tempF).toBe(72)
    expect(w.windSpeedMph).toBe(0)
    expect(w.windFromDegrees).toBe(0)
    expect(w.failure).toBe(false)
  })
})
