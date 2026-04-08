import { GoogleGenAI } from '@google/genai';

let ai: GoogleGenAI | null = null;

export function initGemini(apiKey: string): void {
  ai = new GoogleGenAI({ apiKey });
}

export function isGeminiAvailable(): boolean {
  return ai !== null;
}

export async function analyzeWithGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!ai) {
    return 'LLM analysis unavailable: GEMINI_API_KEY not configured. Findings based on knowledge base data only.';
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.1,
        maxOutputTokens: 4096,
      },
    });
    return response.text ?? '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PolyPharmGuard] Gemini API error: ${message}`);
    return `LLM analysis unavailable: ${message}. Findings based on knowledge base data only.`;
  }
}
