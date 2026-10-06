/** 不透明复合游标与排序 (createdAt DESC, id DESC) 一致。 */
export function encodeCursor(createdAt: number, id: string): string {
  return `v1.${Buffer.from(JSON.stringify([createdAt, id])).toString("base64url")}`;
}

export function decodeCursor(value: string): { createdAt: number; id?: string } {
  if (/^v1\.[A-Za-z0-9_-]+$/.test(value) && value.length <= 512) {
    try {
      const parts: unknown = JSON.parse(Buffer.from(value.slice(3), "base64url").toString());
      if (Array.isArray(parts) && parts.length === 2 &&
          Number.isSafeInteger(parts[0]) && parts[0] >= 0 &&
          typeof parts[1] === "string" && parts[1].length > 0 && parts[1].length <= 64) {
        return { createdAt: parts[0] as number, id: parts[1] };
      }
    } catch { /* 下方统一拒绝无效游标。 */ }
  }
  // 老客户端传 ISO 时间仍可使用；新客户端须原样回传 nextCursor。
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return { createdAt: Math.floor(ms / 1000) };
  }
  throw new Error("invalid_cursor");
}
