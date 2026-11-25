/** Human remaining time: "2 h 15 min left", "45 min left", "Ended". */
export function remainingLabel(targetMs: number, nowMs: number, endedLabel = 'Ended'): string {
  const diff = targetMs - nowMs;
  if (diff <= 0) return endedLabel;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'less than a minute left';
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${String(minutes % 60).padStart(2, '0')} min left`;
  return `${Math.floor(hours / 24)} days left`;
}
