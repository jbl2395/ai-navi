'use client';

import { AlertTriangle, Camera, Loader2, RefreshCw, Zap, ZapOff } from 'lucide-react';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';

import { playShutter, unlockAudio } from '@/lib/feedback';

/** 検査枠の一辺（プレビュー短辺に対する比率） */
const GUIDE_RATIO = 0.78;
/** シャッターボタンのために空けておく高さ（px） */
const SHUTTER_ZONE = 140;
/** API へ送る画像の最大辺（px）。小さいほど転送が速い。 */
const MAX_CAPTURE_SIZE = 1024;
/** JPEG 圧縮品質 */
const JPEG_QUALITY = 0.86;

type CameraStatus = 'idle' | 'starting' | 'ready' | 'error';

interface GuideRect {
  side: number;
  left: number;
  top: number;
}

/**
 * 検査枠の位置とサイズを求める。
 * プレビュー表示と切り出し座標の計算で必ず同じ値を使うため、関数に集約している。
 * シャッターボタンと重ならないよう、下部を除いた領域の中央に置く。
 */
function computeGuideRect(viewWidth: number, viewHeight: number): GuideRect {
  const usableHeight = Math.max(viewHeight - SHUTTER_ZONE, viewHeight * 0.5);
  const side = Math.min(viewWidth, usableHeight) * GUIDE_RATIO;

  return {
    side,
    left: (viewWidth - side) / 2,
    top: (usableHeight - side) / 2,
  };
}

interface CameraCaptureProps {
  /** 検査枠で切り出した画像（data URL）を受け取る */
  onCapture: (image: string) => void;
  /** 解析中はシャッターを止める */
  busy: boolean;
}

/** MediaStreamTrack のベンダー拡張（トーチ）。型定義に無いため補う。 */
interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

export function CameraCapture({ onCapture, busy }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [guide, setGuide] = useState<GuideRect | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [flash, setFlash] = useState(false);

  /** 背面（環境）カメラを優先して取得する */
  const startCamera = useCallback(async () => {
    setStatus('starting');
    setErrorMessage('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setErrorMessage(
        'このブラウザはカメラに対応していません。iPhone では Safari で HTTPS ページとして開いてください。',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // iPhone Safari では ideal 指定が最も安定して背面カメラを選択できる
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // iOS はインライン再生指定がないと全画面プレーヤーに乗っ取られる
        video.setAttribute('playsinline', 'true');
        await video.play().catch(() => undefined);
      }

      const track = stream.getVideoTracks()[0];
      const capabilities = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
      setTorchSupported(Boolean(capabilities.torch));
      setTorchOn(false);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setErrorMessage(
          'カメラへのアクセスが許可されていません。Safari の「設定 > Web サイト設定 > カメラ」で許可してください。',
        );
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setErrorMessage('利用できるカメラが見つかりませんでした。');
      } else if (name === 'NotReadableError') {
        setErrorMessage('カメラが他のアプリで使用中です。他のアプリを終了してから再試行してください。');
      } else {
        setErrorMessage('カメラの起動に失敗しました。再試行してください。');
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  // アプリがバックグラウンドから復帰した際にプレビューを復旧する
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') {
        stopCamera();
        void startCamera();
      } else {
        void videoRef.current?.play().catch(() => undefined);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [startCamera, stopCamera]);

  // 検査枠のサイズはコンテナ実寸から決める（切り出し座標の計算と一致させるため）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth > 0 && clientHeight > 0) {
        setGuide(computeGuideRect(clientWidth, clientHeight));
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }, [torchOn]);

  /**
   * 検査枠の内側だけを切り出して data URL にする。
   * video は object-cover で表示しているため、表示領域とソース座標の対応を計算する。
   */
  const capture = useCallback(() => {
    if (busy || status !== 'ready') return;

    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return;

    const viewWidth = container.clientWidth;
    const viewHeight = container.clientHeight;

    // object-cover: 短辺に合わせて拡大し、はみ出した分は中央基準で切り落とされる
    const scale = Math.max(viewWidth / sourceWidth, viewHeight / sourceHeight);
    const offsetX = (sourceWidth * scale - viewWidth) / 2;
    const offsetY = (sourceHeight * scale - viewHeight) / 2;

    const { side, left, top } = computeGuideRect(viewWidth, viewHeight);
    const cropX = (left + offsetX) / scale;
    const cropY = (top + offsetY) / scale;
    const cropSide = side / scale;

    const outputSize = Math.round(Math.min(cropSide, MAX_CAPTURE_SIZE));
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(video, cropX, cropY, cropSide, cropSide, 0, 0, outputSize, outputSize);
    const image = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

    playShutter();
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);

    onCapture(image);
  }, [busy, onCapture, status]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        autoPlay
        // プレビュー全面タップでも撮影できる
        onClick={capture}
      />

      {/* 検査枠ガイド */}
      {guide && status === 'ready' && (
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute"
            style={{ width: guide.side, height: guide.side, left: guide.left, top: guide.top }}
          >
            <div className="absolute inset-0 rounded-2xl border-2 border-white/40" />
            {/* 四隅のコーナーマーク */}
            <span className="absolute -left-0.5 -top-0.5 h-10 w-10 rounded-tl-2xl border-l-4 border-t-4 border-cyan-300" />
            <span className="absolute -right-0.5 -top-0.5 h-10 w-10 rounded-tr-2xl border-r-4 border-t-4 border-cyan-300" />
            <span className="absolute -bottom-0.5 -left-0.5 h-10 w-10 rounded-bl-2xl border-b-4 border-l-4 border-cyan-300" />
            <span className="absolute -bottom-0.5 -right-0.5 h-10 w-10 rounded-br-2xl border-b-4 border-r-4 border-cyan-300" />
            {/* 中央十字 */}
            <span className="absolute left-1/2 top-1/2 h-6 w-px -translate-x-1/2 -translate-y-1/2 bg-white/50" />
            <span className="absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 bg-white/50" />

            <p className="absolute -top-9 left-0 right-0 text-center text-sm font-medium tracking-wide text-white/80">
              枠内に検査面を合わせてください
            </p>
          </div>
        </div>
      )}

      {/* シャッター時のフラッシュ演出 */}
      {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}

      {/* トーチ（対応端末のみ） */}
      {torchSupported && status === 'ready' && (
        <button
          type="button"
          onClick={() => void toggleTorch()}
          aria-label={torchOn ? 'ライトを消す' : 'ライトを点ける'}
          className="tap-scale absolute right-4 top-4 z-10 flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur"
        >
          {torchOn ? <Zap className="h-7 w-7 text-amber-300" /> : <ZapOff className="h-7 w-7" />}
        </button>
      )}

      {/* 起動中 */}
      {status === 'starting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 text-white">
          <Loader2 className="h-10 w-10 animate-spin text-cyan-300" />
          <p className="text-base">カメラを起動しています…</p>
        </div>
      )}

      {/* エラー */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/90 px-8 text-center text-white">
          <AlertTriangle className="h-14 w-14 text-amber-400" />
          <p className="text-lg leading-relaxed">{errorMessage}</p>
          <button
            type="button"
            onClick={() => void startCamera()}
            className="tap-scale flex items-center gap-2 rounded-full bg-cyan-500 px-8 py-4 text-lg font-bold text-black"
          >
            <RefreshCw className="h-6 w-6" />
            再試行
          </button>
        </div>
      )}

      {/* シャッターボタン */}
      <div className="pb-safe absolute inset-x-0 bottom-0 z-10 flex justify-center pb-6">
        <motion.button
          type="button"
          // iOS では音の再生をユーザー操作の中で解錠する必要がある
          onPointerDown={unlockAudio}
          onClick={capture}
          disabled={busy || status !== 'ready'}
          whileTap={{ scale: 0.92 }}
          aria-label="撮影して検査する"
          className="flex h-28 w-28 items-center justify-center rounded-full border-[6px] border-white/90 bg-white/15 backdrop-blur disabled:opacity-40"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-black">
            {busy ? (
              <Loader2 className="h-10 w-10 animate-spin" />
            ) : (
              <Camera className="h-10 w-10" strokeWidth={2.4} />
            )}
          </span>
        </motion.button>
      </div>
    </div>
  );
}
