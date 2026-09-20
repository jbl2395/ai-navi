'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, History, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { InspectionRecord, Verdict } from '@/lib/types';
import { VERDICT_THEME, formatMs, formatPercent, formatTime } from '@/lib/verdict';

interface InspectionHistoryProps {
  records: InspectionRecord[];
  onClear: () => void;
}

/** 直近の検査ログ（最大 10 件）を画面下部に保持して表示する */
export function InspectionHistory({ records, onClear }: InspectionHistoryProps) {
  const [open, setOpen] = useState(false);

  const counts = useMemo(() => {
    const base: Record<Verdict, number> = { PASS: 0, FAIL: 0, REVIEW: 0 };
    for (const record of records) base[record.verdict] += 1;
    return base;
  }, [records]);

  return (
    <section className="border-shop-line bg-shop-panel border-t">
      <header className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="tap-scale flex flex-1 items-center gap-3 text-left"
        >
          <History className="h-5 w-5 shrink-0 text-slate-400" />
          <span className="shrink-0 whitespace-nowrap text-base font-bold text-slate-100">検査履歴</span>
          <span className="hidden shrink-0 whitespace-nowrap text-sm text-slate-500 min-[360px]:inline">
            直近 {records.length} 件
          </span>

          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-sm font-bold tabular-nums">
            <CountBadge verdict="PASS" count={counts.PASS} />
            <CountBadge verdict="FAIL" count={counts.FAIL} />
            <CountBadge verdict="REVIEW" count={counts.REVIEW} />
          </span>

          {open ? (
            <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />
          ) : (
            <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" />
          )}
        </button>

        {records.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label="履歴を消去"
            className="tap-scale rounded-lg p-2 text-slate-500 hover:text-slate-300"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
      </header>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {records.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-slate-500">まだ検査結果がありません。</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto px-2 pb-2">
                {records.map((record) => (
                  <HistoryRow key={record.id} record={record} />
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function CountBadge({ verdict, count }: { verdict: Verdict; count: number }) {
  const theme = VERDICT_THEME[verdict];
  return (
    <span className={`whitespace-nowrap rounded-md border px-2 py-0.5 text-xs ${theme.badge}`}>
      {verdict.charAt(0)} {count}
    </span>
  );
}

function HistoryRow({ record }: { record: InspectionRecord }) {
  const theme = VERDICT_THEME[record.verdict];

  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      className="border-shop-line flex items-center gap-3 border-b px-2 py-2 last:border-b-0"
    >
      {/* 履歴のサムネイルは data URL なので img を使う */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={record.thumbnail}
        alt=""
        className="h-12 w-12 shrink-0 rounded-md border border-slate-700 object-cover"
      />

      <span className={`w-20 shrink-0 rounded-md border px-2 py-1 text-center text-sm font-black ${theme.badge}`}>
        {record.verdict}
      </span>

      <span className="min-w-0 flex-1 text-sm text-slate-300 tabular-nums">
        <span className="font-bold">{formatPercent(record.confidence)}</span>
        <span className="text-slate-500"> / {formatMs(record.latencyMs)}</span>
        {record.mock && <span className="ml-2 text-xs text-slate-600">mock</span>}
      </span>

      <time dateTime={record.timestamp} className="shrink-0 text-xs text-slate-500 tabular-nums">
        {formatTime(record.timestamp)}
      </time>
    </motion.li>
  );
}
