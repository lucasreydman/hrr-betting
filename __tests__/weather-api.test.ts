import { fetchWeather, getStadiumConstants, getOutfieldFacingDegrees } from '@/lib/weather-api'

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

  describe('fetchWeather', () => {
    let fetchSpy: jest.SpyInstance
    afterEach(() => {
      fetchSpy?.mockRestore()
    })

    /** Build a canned Open-Meteo hourly response covering the requested gameTime hour. */
    function mockOpenMeteo(gameTimeIso: string, params: { tempF: number; windMph: number; windFromDeg: number }) {
      // Open-Meteo returns the requested hour and surrounding hours. Build 3 hours
      // around gameTimeIso so the "closest hour" lookup has multiple candidates.
      const t = new Date(gameTimeIso)
      const hours: string[] = []
      const temps: number[] = []
      const speeds: number[] = []
      const dirs: number[] = []
      for (let offset = -1; offset <= 1; offset++) {
        const h = new Date(t.getTime() + offset * 60 * 60 * 1000)
        hours.push(h.toISOString().slice(0, 16))  // "YYYY-MM-DDTHH:MM" — Open-Meteo's local-time format
        temps.push(params.tempF + offset * 0.5)   // tiny perturbation per hour
        speeds.push(params.windMph)
        dirs.push(params.windFromDeg)
      }
      const body = {
        hourly: {
          time: hours,
          temperature_2m: temps,
          wind_speed_10m: speeds,
          wind_direction_10m: dirs,
        },
      }
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => body,
      } as Response)
    }

    it('parses Open-Meteo response into temp / wind / direction', async () => {
      mockOpenMeteo('2025-07-04T19:05:00Z', { tempF: 78, windMph: 8, windFromDeg: 230 })
      const w = await fetchWeather(3313, '2025-07-04T19:05:00Z')
      expect(w.tempF).toBe(78)
      expect(w.windSpeedMph).toBe(8)
      expect(w.windFromDegrees).toBe(230)
      expect(w.failure).toBe(false)
      expect(w.controlled).toBe(false)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      // Verify the URL includes the venue's lat/lon so the right stadium was queried
      const calledUrl = String(fetchSpy.mock.calls[0][0])
      expect(calledUrl).toContain('latitude=40.8296')
      expect(calledUrl).toContain('longitude=-73.9262')
    })

    it('returns controlled=true for domed stadiums without hitting the network', async () => {
      // No mock — Tropicana (venueId 12) short-circuits via weatherControlled flag
      // before any fetch is attempted. fetchSpy is undefined; we assert it stayed that way.
      const beforeSpy = jest.spyOn(global, 'fetch')
      const w = await fetchWeather(12, '2025-07-04T19:05:00Z')
      expect(w.controlled).toBe(true)
      expect(w.windSpeedMph).toBe(0)
      expect(w.failure).toBe(false)
      expect(beforeSpy).not.toHaveBeenCalled()
      beforeSpy.mockRestore()
    })

    it('returns failure=true when Open-Meteo errors, with neutral defaults', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response)
      // console.warn is called on failure for observability — silence it during test.
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const w = await fetchWeather(3313, '2025-07-04T19:05:00Z')
      expect(w.failure).toBe(true)
      expect(w.tempF).toBe(72)
      expect(w.windSpeedMph).toBe(0)
      expect(w.windFromDegrees).toBe(0)
      warnSpy.mockRestore()
    })

    it('routes historical dates to the archive API (not forecast)', async () => {
      mockOpenMeteo('2020-07-04T19:05:00Z', { tempF: 80, windMph: 5, windFromDeg: 90 })
      const w = await fetchWeather(3313, '2020-07-04T19:05:00Z')
      expect(w.tempF).toBe(80)
      const calledUrl = String(fetchSpy.mock.calls[0][0])
      // Archive endpoint, not forecast
      expect(calledUrl).toContain('archive-api.open-meteo.com/v1/archive')
      expect(calledUrl).not.toContain('api.open-meteo.com/v1/forecast')
    })
  })

  it('returns sensible defaults on invalid venueId', async () => {
    const w = await fetchWeather(99999, '2025-07-04T19:05:00Z')
    expect(w.tempF).toBe(72)
    expect(w.windSpeedMph).toBe(0)
    expect(w.windFromDegrees).toBe(0)
    expect(w.failure).toBe(false)
  })
})
