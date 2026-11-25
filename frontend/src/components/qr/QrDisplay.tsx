import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/utils/cn';

/**
 * Renders an opaque token (e.g. a representative's pickup pass) as a QR code.
 * White quiet-zone background so phone cameras read it reliably on dark UI.
 */
export function QrDisplay({ value, size = 224, label, className }: { value: string; size?: number; label: string; className?: string }) {
  return (
    <figure className={cn('inline-flex flex-col items-center gap-2', className)}>
      <div className="rounded-xl bg-white p-3">
        <QRCodeSVG value={value} size={size} level="M" marginSize={0} role="img" aria-label={label} title={label} />
      </div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
