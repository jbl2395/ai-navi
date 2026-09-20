'use client';

import { AlertTriangle, CircleDot, ScanLine, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';

import { CameraCapture } from '@/components/CameraCapture';
import { InspectionHistory } from '@/components/InspectionHistory';
import { ResultOverlay } from '@/components/ResultOverlay';
import { createThumbnail } from '@/lib/image';
import type { ApiErrorResponse, InspectionRecord, InspectionResult } from '@/lib/types';

/** 履歴の保持件数 */
const HISTORY_LIMIT = 10;
const STORAGE_KEY = 'parts-inspector:history:v1';

export default function InspectionPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<InspectionRecord[]>([]);
  const [mode, setMode] = useState<'mock' | 'live' | null>(null);

  // 保存済みの履歴を復元する
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw) as InspectionRecord[]);
    } catch {
      /* 壊れたデータは無視して空から始める */
    }
  }, []);

  // 接続モード（Jev 本番 / モック）を表示する
  useEffect(() => {
    let cancelled = false;
    fetch('/api/inspect')
      .then((response) => response.json())
      .then((data: { mode?: 'mock' | 'live' }) => {
        if (!cancelled && data.mode) setMode(data.mode);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((records: InspectionRecord[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      /* 容量超過などは致命的ではないので握りつぶす */
    }
  }, []);

  const handleCapture = useCallback(
    async (image: string) => {
      setBusy(true);
      setErrorMessage(null);
      setCapturedImage(image);

      try {
        const response = await fetch('/api/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image }),
        });

        const payload: unknown = await response.json();

        if (!response.ok) {
          const apiError = payload as ApiErrorResponse;
          throw new Error(apiError.error ?? '判定に失敗しました');
        }

        const inspection = payload as InspectionResult;
        setResult(inspection);
        setMode(inspection.mock ? 'mock' : 'live');

        const thumbnail = await createThumbnail(image);
        setHistory((previous) => {
          const next = [{ ...inspection, thumbnail }, ...previous].slice(0, HISTORY_LIMIT);
          persist(next);
          return next;
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '判定に失敗しました');
        setCapturedImage(null);
      } finally {
        setBusy(false);
      }
    },
    [persist],
  );

  const dismissResult = useCallback(() => {
    setResult(null);
    setCapturedImage(null);
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    persist([]);
  }, [persist]);

  return (
    <main className="h-screen-safe flex flex-col overflow-hidden">
      <header className="pt-safe bg-shop-panel border-shop-line flex items-center gap-3 border-b px-4 py-3">
        <ScanLine className="h-6 w-6 text-cyan-400" />
        <h1 className="text-lg font-bold tracking-tight">部品表面検査</h1>

        {mode && (
          <span
            className={`ml-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
              mode === 'live'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            }`}
          >
            <CircleDot className="h-3.5 w-3.5" />
            {mode === 'live' ? 'Jev API 接続中' : 'モックモード'}
          </span>
        )}
      </header>

      {/* カメラプレビュー */}
      <div className="relative min-h-0 flex-1">
        <CameraCapture onCapture={(image) => void handleCapture(image)} busy={busy} />

        {/* 解析中インジケータ */}
        <AnimatePresence>
          {busy && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="pt-safe pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4"
            >
              <span className="flex items-center gap-2 rounded-full bg-black/70 px-5 py-2.5 text-base font-bold text-cyan-300 backdrop-blur">
                <motion.span
                  className="h-2.5 w-2.5 rounded-full bg-cyan-400"
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ repeat: Infinity, duration: 0.6 }}
                />
                解析中…
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* エラー通知 */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              className="absolute inset-x-4 top-20 z-20"
            >
              <div className="flex items-start gap-3 rounded-xl border border-red-500/50 bg-red-950/90 p-4 backdrop-blur">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                <p className="flex-1 text-sm leading-relaxed text-red-100">{errorMessage}</p>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  aria-label="エラーを閉じる"
                  className="tap-scale -m-1 p-1 text-red-300"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="pb-safe">
        <InspectionHistory records={history} onClear={clearHistory} />
      </div>

      <ResultOverlay result={result} image={capturedImage} onDismiss={dismissResult} />
    </main>
  );
}
