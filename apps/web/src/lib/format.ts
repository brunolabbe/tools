/** Display formatting. Every function tolerates `null`, because most of the numbers on a job are nullable. */

export const UNKNOWN = "—";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return UNKNOWN;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit] ?? "B"}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond === null || bytesPerSecond === undefined) return UNKNOWN;
  return `${formatBytes(bytesPerSecond)}/s`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return UNKNOWN;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return UNKNOWN;
  }
  if (seconds < 60) return `${Math.round(seconds)} s left`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours} h ${minutes} min left`;
}

export function formatPercent(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return UNKNOWN;
  return `${Math.min(100, Math.max(0, percent)).toFixed(percent >= 99.95 ? 0 : 1)}%`;
}

export function formatResolution(width?: number, height?: number): string {
  if (!height) return UNKNOWN;
  return width ? `${width}×${height}` : `${height}p`;
}

export function formatBitrate(bitrateBps: number | null | undefined): string {
  if (bitrateBps === null || bitrateBps === undefined || bitrateBps <= 0) return UNKNOWN;
  if (bitrateBps >= 1_000_000) return `${(bitrateBps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bitrateBps / 1000)} kbps`;
}

export interface Expiry {
  expired: boolean;
  label: string;
}

/** Retention countdown for a finished file. */
export function formatExpiry(expiresAt: string, now: number): Expiry {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return { expired: false, label: "expiry unknown" };
  const remainingMs = at - now;
  if (remainingMs <= 0) return { expired: true, label: "link expired" };
  const minutes = Math.round(remainingMs / 60_000);
  if (minutes < 60) return { expired: false, label: `expires in ${Math.max(1, minutes)} min` };
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return { expired: false, label: `expires in ${hours} h ${rest} min` };
}

export function formatTimestamp(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return UNKNOWN;
  return new Date(at).toLocaleString();
}
