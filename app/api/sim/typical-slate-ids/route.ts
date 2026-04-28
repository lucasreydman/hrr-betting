import { NextRequest, NextResponse } from 'next/server'
import { getSlateBatterIds } from '@/lib/slate-batters'
import { verifyCronRequest } from '@/lib/cron-auth'
import { slateDateString, isValidIsoDate } from '@/lib/date-utils'

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dateParam = new URL(req.url).searchParams.get('date')
  if (dateParam !== null && !isValidIsoDate(dateParam)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 })
  }
  const date = dateParam ?? slateDateString()
  const ids = await getSlateBatterIds(date)
  return NextResponse.json(ids)
}
