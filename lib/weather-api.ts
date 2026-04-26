import { createHash } from 'crypto'
import type { WeatherData } from './types'

export function weatherHash(w: { temp?: number; tempF?: number; windSpeed?: number; windSpeedMph?: number; windDirection?: number; windFromDegrees?: number }): string {
  // Accept either spec naming (temp/windSpeed/windDirection) or internal naming (tempF/windSpeedMph/windFromDegrees)
  const temp = w.tempF ?? w.temp ?? 70
  const wind = w.windSpeedMph ?? w.windSpeed ?? 0
  const dir = w.windFromDegrees ?? w.windDirection ?? 0

  // Round to coarse buckets so trivial forecast jitter doesn't invalidate sim cache
  const rounded = {
    temp: Math.round(temp / 5) * 5,    // 5°F buckets
    wind: Math.round(wind / 3) * 3,    // 3 mph buckets
    dir: Math.round(dir / 30) * 30,    // 30° buckets
  }
  return createHash('sha1').update(JSON.stringify(rounded)).digest('hex').slice(0, 12)
}

export interface StadiumConstants {
  venueId: number
  name: string
  lat: number
  lon: number
  outfieldFacingDegrees: number
  weatherControlled?: boolean
}

// All 30 MLB stadiums. outfieldFacingDegrees = compass bearing the outfield faces.
// Wind FROM that direction = blowing in. Wind FROM opposite (±180°) = blowing out.
export const STADIUMS: Record<number, StadiumConstants> = {
  1:    { venueId: 1,    name: 'Angel Stadium',              lat: 33.8003,  lon: -117.8827, outfieldFacingDegrees: 280 },
  2:    { venueId: 2,    name: 'Oriole Park at Camden Yards', lat: 39.2838,  lon: -76.6218,  outfieldFacingDegrees: 335 },
  3:    { venueId: 3,    name: 'Fenway Park',                 lat: 42.3467,  lon: -71.0972,  outfieldFacingDegrees: 95  },
  4:    { venueId: 4,    name: 'Guaranteed Rate Field',       lat: 41.8300,  lon: -87.6341,  outfieldFacingDegrees: 5   },
  5:    { venueId: 5,    name: 'Progressive Field',           lat: 41.4962,  lon: -81.6852,  outfieldFacingDegrees: 5   },
  7:    { venueId: 7,    name: 'Kauffman Stadium',            lat: 39.0517,  lon: -94.4803,  outfieldFacingDegrees: 330 },
  10:   { venueId: 10,   name: 'Oakland Coliseum',            lat: 37.7516,  lon: -122.2005, outfieldFacingDegrees: 330 },
  12:   { venueId: 12,   name: 'Tropicana Field',             lat: 27.7683,  lon: -82.6534,  outfieldFacingDegrees: 0,   weatherControlled: true },
  14:   { venueId: 14,   name: 'Rogers Centre',               lat: 43.6414,  lon: -79.3894,  outfieldFacingDegrees: 0,   weatherControlled: true },
  15:   { venueId: 15,   name: 'Chase Field',                 lat: 33.4455,  lon: -112.0667, outfieldFacingDegrees: 340, weatherControlled: true },
  17:   { venueId: 17,   name: 'Wrigley Field',               lat: 41.9484,  lon: -87.6553,  outfieldFacingDegrees: 353 },
  19:   { venueId: 19,   name: 'Coors Field',                 lat: 39.7559,  lon: -104.9942, outfieldFacingDegrees: 347 },
  22:   { venueId: 22,   name: 'Dodger Stadium',              lat: 34.0739,  lon: -118.2400, outfieldFacingDegrees: 305 },
  31:   { venueId: 31,   name: 'PNC Park',                    lat: 40.4468,  lon: -80.0057,  outfieldFacingDegrees: 15  },
  32:   { venueId: 32,   name: 'American Family Field',       lat: 43.0280,  lon: -87.9712,  outfieldFacingDegrees: 5,   weatherControlled: true },
  680:  { venueId: 680,  name: 'T-Mobile Park',               lat: 47.5914,  lon: -122.3325, outfieldFacingDegrees: 0   },
  2392: { venueId: 2392, name: 'Minute Maid Park',            lat: 29.7573,  lon: -95.3555,  outfieldFacingDegrees: 350, weatherControlled: true },
  2394: { venueId: 2394, name: 'Comerica Park',               lat: 42.3390,  lon: -83.0485,  outfieldFacingDegrees: 350 },
  2395: { venueId: 2395, name: 'Oracle Park',                 lat: 37.7786,  lon: -122.3893, outfieldFacingDegrees: 35  },
  2602: { venueId: 2602, name: 'Great American Ball Park',    lat: 39.0979,  lon: -84.5082,  outfieldFacingDegrees: 20  },
  2680: { venueId: 2680, name: 'Petco Park',                  lat: 32.7073,  lon: -117.1566, outfieldFacingDegrees: 307 },
  2681: { venueId: 2681, name: 'Citizens Bank Park',          lat: 39.9061,  lon: -75.1665,  outfieldFacingDegrees: 350 },
  2889: { venueId: 2889, name: 'Busch Stadium',               lat: 38.6226,  lon: -90.1928,  outfieldFacingDegrees: 346 },
  3289: { venueId: 3289, name: 'Citi Field',                  lat: 40.7571,  lon: -73.8458,  outfieldFacingDegrees: 5   },
  3309: { venueId: 3309, name: 'Nationals Park',              lat: 38.8730,  lon: -77.0074,  outfieldFacingDegrees: 355 },
  3312: { venueId: 3312, name: 'Target Field',                lat: 44.9817,  lon: -93.2781,  outfieldFacingDegrees: 30  },
  3313: { venueId: 3313, name: 'Yankee Stadium',              lat: 40.8296,  lon: -73.9262,  outfieldFacingDegrees: 25  },
  4169: { venueId: 4169, name: 'loanDepot park',              lat: 25.7781,  lon: -80.2197,  outfieldFacingDegrees: 320, weatherControlled: true },
  4705: { venueId: 4705, name: 'Truist Park',                 lat: 33.8909,  lon: -84.4679,  outfieldFacingDegrees: 335 },
  5325: { venueId: 5325, name: 'Globe Life Field',            lat: 32.7473,  lon: -97.0845,  outfieldFacingDegrees: 0,   weatherControlled: true },
}

export function getStadiumConstants(venueId: number): StadiumConstants | null {
  return STADIUMS[venueId] ?? null
}

// Fetches hourly weather from Open-Meteo and picks the slot closest to gameTime
export async function fetchWeather(
  venueId: number,
  gameTimeIso: string
): Promise<WeatherData> {
  const stadium = getStadiumConstants(venueId)
  if (!stadium) {
    return { tempF: 72, windSpeedMph: 0, windFromDegrees: 0, failure: false, controlled: false }
  }

  if (stadium.weatherControlled) {
    return { tempF: 72, windSpeedMph: 0, windFromDegrees: 0, failure: false, controlled: true }
  }

  try {
    const gameDate = gameTimeIso.slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    const isHistoricalDate = gameDate < today
    const url = new URL(
      isHistoricalDate
        ? 'https://archive-api.open-meteo.com/v1/archive'
        : 'https://api.open-meteo.com/v1/forecast'
    )
    url.searchParams.set('latitude', String(stadium.lat))
    url.searchParams.set('longitude', String(stadium.lon))
    url.searchParams.set('hourly', 'temperature_2m,wind_speed_10m,wind_direction_10m')
    url.searchParams.set('temperature_unit', 'fahrenheit')
    url.searchParams.set('wind_speed_unit', 'mph')
    url.searchParams.set('timezone', 'auto')
    if (isHistoricalDate) {
      url.searchParams.set('start_date', gameDate)
      url.searchParams.set('end_date', gameDate)
    } else {
      url.searchParams.set('forecast_days', '2')
    }

    const res = await fetch(url.toString(), { next: { revalidate: 1800 } })
    if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`)

    const data = await res.json()
    const hours: string[] = data.hourly.time
    const temps: number[] = data.hourly.temperature_2m
    const speeds: number[] = data.hourly.wind_speed_10m
    const directions: number[] = data.hourly.wind_direction_10m

    const gameMs = new Date(gameTimeIso).getTime()
    let closestIdx = 0
    let minDiff = Infinity
    for (let i = 0; i < hours.length; i++) {
      const diff = Math.abs(new Date(hours[i]).getTime() - gameMs)
      if (diff < minDiff) { minDiff = diff; closestIdx = i }
    }

    return {
      tempF: Math.round(temps[closestIdx]),
      windSpeedMph: Math.round(speeds[closestIdx]),
      windFromDegrees: Math.round(directions[closestIdx]),
      failure: false,
      controlled: false,
    }
  } catch {
    return { tempF: 72, windSpeedMph: 0, windFromDegrees: 0, failure: true, controlled: false }
  }
}

export function getOutfieldFacingDegrees(venueId: number): number {
  return STADIUMS[venueId]?.outfieldFacingDegrees ?? 0
}
