import { ApiError } from "./api";
import { formatSize } from "./format";

export function mutationErrorMessage(error: unknown, _action?: string): string {
  if (!(error instanceof ApiError)) return "连接中断，操作结果尚未确认。内容已保留，请重试。";
  const limit = typeof error.details?.limit === "number" ? error.details.limit : undefined;
  switch (error.status) {
    case 400: return error.code === "empty" ? "请输入文字或选择附件。" : "内容不符合要求，请检查后再试。";
    case 401: return "登录已过期，内容已保留，请重新登录。";
    case 403: return "当前登录无法执行此操作，请重新登录后重试。";
    case 404: return "这条内容已不存在，未保存的修改仍保留。";
    case 409: return error.code === "already_deleted" ? "这笔发送已在 NAS 被永久删除，未重新创建。" : "该条内容正在永久删除，无法继续修改或恢复。";
    case 413:
      if (error.code === "file_too_large" && limit !== undefined) return `「${String(error.details?.filename ?? "文件")}」超过单文件上限 ${formatSize(limit)}，请移除该文件或调整 NAS 设置。`;
      if (error.code === "upload_total_too_large" && limit !== undefined) return `本批附件超过总大小上限 ${formatSize(limit)}。`;
      if (error.code === "too_many_files" && limit !== undefined) return `附件数量超过上限 ${limit} 件。`;
      return "文件超出服务器或反向代理的上传限制，请减小文件后重试。";
    case 429: return error.code === "upload_busy" ? "NAS 正在处理其他上传，内容已保留，请稍后重试。" : "操作过于频繁，请稍后重试。";
    default: return error.status >= 500 ? "NAS 暂时无法完成操作，内容已保留，请稍后重试。" : "操作未完成，请重试。";
  }
}
