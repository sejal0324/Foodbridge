import { Camera, CameraOff, Keyboard } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Field, Textarea } from '@/components/ui';

type CameraState = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'error';

export interface QrScannerProps {
  /** Called once with the decoded (or typed) text. */
  onResult: (text: string) => void;
  /** Disable input while the parent verifies a result. */
  busy?: boolean;
  manualLabel?: string;
  manualHint?: string;
}

/**
 * Camera QR scanner (ZXing) with a manual paste/type fallback. The camera is
 * started only after the user asks for it, and is stopped on unmount.
 */
export function QrScanner({ onResult, busy, manualLabel = 'Pass code', manualHint = 'Paste or type the code shown under the QR on the representative’s phone.' }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const handledRef = useRef(false);
  const [camera, setCamera] = useState<CameraState>('idle');
  const [manual, setManual] = useState('');
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  const stop = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  };

  useEffect(() => stop, []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    setCamera('starting');
    handledRef.current = false;
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
      const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current ?? undefined, (result) => {
        if (result && !handledRef.current) {
          handledRef.current = true;
          stop();
          setCamera('idle');
          onResultRef.current(result.getText().trim());
        }
      });
      controlsRef.current = controls;
      setCamera('scanning');
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable' : 'error');
    }
  };

  const message: Partial<Record<CameraState, string>> = {
    denied: 'Camera permission was denied. Allow camera access in your browser settings, or enter the code below.',
    unavailable: 'No camera is available on this device (or the page is not served over HTTPS). Enter the code below.',
    error: 'The camera could not be started. Enter the code below instead.',
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="relative aspect-square w-full max-w-xs self-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
          <video ref={videoRef} className={camera === 'scanning' ? 'h-full w-full object-cover' : 'hidden'} muted playsInline aria-label="Camera preview for scanning the pickup QR code" />
          {camera !== 'scanning' ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">
              {camera === 'starting' ? 'Starting camera…' : <Camera className="size-10 text-slate-600" aria-hidden="true" />}
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-brand-400/80" aria-hidden="true" />
          )}
        </div>
        <div className="flex justify-center gap-2">
          {camera === 'scanning' ? (
            <Button
              variant="outline"
              onClick={() => {
                stop();
                setCamera('idle');
              }}
              leftIcon={<CameraOff className="size-4" aria-hidden="true" />}
            >
              Stop camera
            </Button>
          ) : (
            <Button onClick={() => void start()} loading={camera === 'starting'} disabled={busy} leftIcon={<Camera className="size-4" aria-hidden="true" />}>
              Scan with camera
            </Button>
          )}
        </div>
        {message[camera] ? (
          <p role="alert" className="text-center text-sm text-amber-300">
            {message[camera]}
          </p>
        ) : null}
      </div>

      <form
        className="flex flex-col gap-3 border-t border-white/10 pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          const text = manual.trim();
          if (text) onResultRef.current(text);
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <Keyboard className="size-4" aria-hidden="true" /> No camera? Enter the code
        </div>
        <Field label={manualLabel} hint={manualHint}>
          <Textarea value={manual} onChange={(e) => setManual(e.target.value)} rows={2} spellCheck={false} autoComplete="off" className="font-mono text-xs" placeholder="FBP1.…" />
        </Field>
        <Button type="submit" variant="secondary" disabled={!manual.trim() || busy} loading={busy}>
          Verify code
        </Button>
      </form>
    </div>
  );
}
