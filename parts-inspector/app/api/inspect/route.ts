import { NextResponse } from 'next/server';

import { callJev, decideVerdict, mockInference, shouldUseMock, stripDataUrl, config } from '@/lib/jev';
import type { ApiErrorResponse, InspectionRequest, InspectionResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 受け付ける画像の上限（base64 換算）。約 8MB。 */
const MAX_BASE64_LENGTH = 8 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse<InspectionResult | ApiErrorResponse>> {
  const startedAt = Date.now();

  let body: InspectionRequest;
  try {
    body = (await request.json()) as InspectionRequest;
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正です（JSON を送信してください）' }, { status: 400 });
  }

  if (typeof body?.image !== 'string' || body.image.length === 0) {
    return NextResponse.json({ error: '画像データ（image）が含まれていません' }, { status: 400 });
  }
  if (body.image.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: '画像サイズが大きすぎます（上限 8MB）' }, { status: 413 });
  }

  const { base64, mimeType } = stripDataUrl(body.image);

  try {
    // API キー未設定時はモックで応答し、資格情報なしでも現場検証できるようにする
    const inference = shouldUseMock() ? mockInference(base64) : await callJev(base64, mimeType, body.partNumber);
    const { verdict, confidence } = decideVerdict(inference.scores);

    const result: InspectionResult = {
      id: crypto.randomUUID(),
      verdict,
      confidence,
      scores: inference.scores,
      regions: inference.regions,
      latencyMs: Math.round(inference.latencyMs),
      totalMs: Date.now() - startedAt,
      mock: inference.mock,
      model: inference.model,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && error.name === 'AbortError';

    return NextResponse.json(
      {
        error: aborted ? `Jev API がタイムアウトしました（${config().timeoutMs}ms）` : 'Jev API の呼び出しに失敗しました',
        detail,
      },
      { status: aborted ? 504 : 502 },
    );
  }
}

/** 稼働確認用。モードとしきい値設定を返す。 */
export async function GET(): Promise<NextResponse> {
  const { model, passThreshold, failThreshold, timeoutMs } = config();
  return NextResponse.json({
    status: 'ok',
    mode: shouldUseMock() ? 'mock' : 'live',
    model,
    passThreshold,
    failThreshold,
    timeoutMs,
  });
}
