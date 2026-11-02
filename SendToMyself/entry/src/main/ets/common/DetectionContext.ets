export interface DetectionContext { capturedAt: string; utcOffsetMinutes: number }
export function captureDetectionContext(): DetectionContext {
  const date = new Date();
  return { capturedAt: date.toISOString(), utcOffsetMinutes: -date.getTimezoneOffset() };
}
export function parseDetectionContext(raw: string): DetectionContext {
  if (!raw || raw.length > 256) throw new Error('INVALID_INPUT');
  const value = JSON.parse(raw) as DetectionContext;
  if (!value || typeof value.capturedAt !== 'string' || value.capturedAt.length > 64 ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value.capturedAt) || !Number.isFinite(Date.parse(value.capturedAt)) ||
    typeof value.utcOffsetMinutes !== 'number' || !Number.isInteger(value.utcOffsetMinutes) || Math.abs(value.utcOffsetMinutes) > 840) throw new Error('INVALID_INPUT');
  return value;
}
