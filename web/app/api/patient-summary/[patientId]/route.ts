import { NextRequest, NextResponse } from 'next/server';
import { analyzeWithGemini, initGemini } from '../../../../../src/llm/gemini';
import { buildPatientSummaryPrompt } from '../../../../../src/mcp-server/prompts/patient-summary-prompt';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;

  const geminiKey = process.env['GEMINI_API_KEY'];
  if (geminiKey) initGemini(geminiKey);

  // Fetch review data
  const baseUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? _req.nextUrl.origin;
  const reviewRes = await fetch(`${baseUrl}/api/review/${patientId}`, { cache: 'no-store' });
  if (!reviewRes.ok) {
    return NextResponse.json({ error: 'Review unavailable' }, { status: 502 });
  }
  const review = await reviewRes.json();

  const { systemPrompt, userPrompt } = buildPatientSummaryPrompt(
    review.findings,
    review.patientName
  );

  let summary = 'Summary unavailable -- please consult your care team.';
  try {
    const result = await analyzeWithGemini(systemPrompt, userPrompt);
    if (result) summary = result;
  } catch {
    // Gemini unavailable -- use fallback
  }

  return NextResponse.json({
    patientId,
    patientName: review.patientName,
    summary,
    generatedAt: new Date().toISOString(),
  });
}
