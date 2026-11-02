import type { DetectionContext } from "@sendtomyself/shared";

export function captureDetectionContext(): DetectionContext {
  const captured = new Date();
  return { capturedAt: captured.toISOString(), utcOffsetMinutes: -captured.getTimezoneOffset() };
}
