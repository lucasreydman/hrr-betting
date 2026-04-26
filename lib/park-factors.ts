// FanGraphs runs park factors, 1.00 scale. Updated for 2025 season.
// To find a venue ID: GET https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=venue

const HR_PARK_FACTORS: Record<number, number> = {
  1: 0.97,    // Angel Stadium (LAA)
  2: 0.97,    // Oriole Park at Camden Yards (BAL)
  3: 1.02,    // Fenway Park (BOS)
  4: 0.96,    // Guaranteed Rate Field (CWS)
  5: 0.97,    // Progressive Field (CLE)
  7: 1.00,    // Kauffman Stadium (KC)
  10: 0.97,   // Oakland Coliseum (OAK)
  12: 0.96,   // Tropicana Field (TB) — dome
  14: 1.00,   // Rogers Centre (TOR) — dome
  15: 1.03,   // Chase Field (ARI) — dome/retractable
  17: 1.04,   // Wrigley Field (CHC)
  19: 1.28,   // Coors Field (COL)
  22: 0.93,   // Dodger Stadium (LAD)
  31: 0.96,   // PNC Park (PIT)
  32: 1.01,   // American Family Field (MIL) — retractable
  680: 0.95,  // T-Mobile Park (SEA)
  2392: 1.01, // Minute Maid Park (HOU) — retractable
  2394: 0.97, // Comerica Park (DET)
  2395: 0.90, // Oracle Park (SF)
  2602: 1.00, // Great American Ball Park (CIN)
  2680: 0.88, // Petco Park (SD)
  2681: 1.00, // Citizens Bank Park (PHI)
  2889: 0.96, // Busch Stadium (STL)
  3289: 1.01, // Citi Field (NYM)
  3309: 1.00, // Nationals Park (WSH)
  3312: 1.00, // Target Field (MIN)
  3313: 1.02, // Yankee Stadium (NYY)
  4169: 0.94, // loanDepot park (MIA) — retractable
  4705: 1.00, // Truist Park (ATL)
  5325: 1.05, // Globe Life Field (TEX) — retractable
}

export interface HRByHandedness {
  vsL: number // vs left-handed pitchers
  vsR: number // vs right-handed pitchers
}

export interface ParkFactors {
  venueId: number
  outfieldFacingDeg: number
  factors: {
    hr: number    // HR-specific factor
    '1b': number  // single (placeholder v1: 1.00)
    '2b': number  // double (placeholder v1: 1.00)
    '3b': number  // triple (placeholder v1: 1.00)
    bb: number    // walk (placeholder v1: 1.00)
    k: number     // strikeout (placeholder v1: 1.00)
  }
  hrByHand: HRByHandedness
}

// Legacy function for backward compatibility
export function getParkFactor(venueId: number): number {
  return HR_PARK_FACTORS[venueId] ?? 1.00
}

// Extended park factors with per-outcome factors
export function getParkFactors(venueId: number): ParkFactors {
  const hrFactor = HR_PARK_FACTORS[venueId] ?? 1.00

  return {
    venueId,
    outfieldFacingDeg: 0, // TODO: integrate with stadium constants from weather-api
    factors: {
      hr: hrFactor,
      '1b': 1.00,  // v1 placeholder
      '2b': 1.00,  // v1 placeholder
      '3b': 1.00,  // v1 placeholder
      bb: 1.00,    // v1 placeholder
      k: 1.00,     // v1 placeholder
    },
    hrByHand: {
      vsL: hrFactor,
      vsR: hrFactor,
    },
  }
}
