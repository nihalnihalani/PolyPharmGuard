import { NextRequest, NextResponse } from 'next/server';
import { logClinicianAction } from '../../../../src/audit/db';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { reviewId, findingId, action, reasonText, clinicianId, severity, drug, toolName } = body;

  if (!reviewId || !findingId || !action || !clinicianId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    logClinicianAction({ reviewId, findingId, action, reasonText, clinicianId, severity, drug, toolName });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[feedback API] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
