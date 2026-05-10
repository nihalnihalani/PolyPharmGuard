import { NextRequest, NextResponse } from 'next/server';
import { logClinicianAction } from '../../../../src/audit/db';

const VALID_ACTIONS = ['accept', 'override', 'modify'] as const;
type FeedbackAction = typeof VALID_ACTIONS[number];

function stringField(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function optionalStringField(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return stringField(value, maxLength);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const reviewId = stringField(body['reviewId'], 128);
  const findingId = stringField(body['findingId'], 128);
  const actionRaw = stringField(body['action'], 32);
  const clinicianId = stringField(body['clinicianId'], 128);
  const reasonText = optionalStringField(body['reasonText'], 2000);
  const severity = optionalStringField(body['severity'], 16);
  const drug = optionalStringField(body['drug'], 256);
  const toolName = optionalStringField(body['toolName'], 64);

  if (!reviewId || !findingId || !actionRaw || !clinicianId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!VALID_ACTIONS.includes(actionRaw as FeedbackAction)) {
    return NextResponse.json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` }, { status: 400 });
  }
  const action = actionRaw as FeedbackAction;

  try {
    logClinicianAction({ reviewId, findingId, action, reasonText, clinicianId, severity, drug, toolName });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[feedback API] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
