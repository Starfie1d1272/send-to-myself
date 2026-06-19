/** 疑似 API Key / Token / 私钥识别（SPEC §6）。命中只置 sensitive 建议，不改内容。 */

interface SecretRule {
  hint: string;
  re: RegExp;
}

/**
 * 常见密钥/令牌前缀规则。命中即视为疑似敏感。
 * 取舍：宁可漏报也尽量不误报（前缀 + 长度约束），避免把普通文本误判。
 */
const RULES: SecretRule[] = [
  // 通用 sk- 前缀：OpenAI / Anthropic(sk-ant) / OpenRouter(sk-or) / 各类兼容服务
  { hint: "API Key（sk-）", re: /sk-[A-Za-z0-9_-]{16,}/ },
  // GitHub
  { hint: "GitHub Token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/ },
  { hint: "GitHub PAT", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  // GitLab
  { hint: "GitLab Token", re: /\bglpat-[A-Za-z0-9_-]{16,}/ },
  // AWS
  { hint: "AWS Access Key", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|AIPA)[A-Z0-9]{12,}/ },
  // Google
  { hint: "Google API Key", re: /\bAIza[A-Za-z0-9_-]{30,}/ },
  { hint: "Google OAuth", re: /\b[0-9]+-[A-Za-z0-9_]{20,}\.apps\.googleusercontent\.com/ },
  // Slack
  { hint: "Slack Token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { hint: "Slack App Token", re: /\bxapp-[0-9]-[A-Za-z0-9-]{10,}/ },
  // Stripe / 支付
  { hint: "Stripe Key", re: /\b(?:sk|rk|pk)_(?:live|test)_[0-9a-zA-Z]{16,}/ },
  // 即时通讯 / 推送
  { hint: "Telegram Bot Token", re: /\b\d{8,10}:[A-Za-z0-9_-]{35}/ },
  { hint: "Discord Bot Token", re: /\b[MNO][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/ },
  { hint: "Discord Webhook", re: /https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/ },
  // 云通信
  { hint: "Twilio", re: /\b(?:SK|AC)[0-9a-fA-F]{32}/ },
  { hint: "SendGrid", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  // 包管理 / 平台
  { hint: "npm Token", re: /\bnpm_[A-Za-z0-9]{36}/ },
  { hint: "PyPI Token", re: /\bpypi-[A-Za-z0-9_-]{16,}/ },
  { hint: "Hugging Face", re: /\bhf_[A-Za-z0-9]{20,}/ },
  // 通用令牌形态
  { hint: "Bearer Token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/ },
  { hint: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  // 私钥块（多行整体遮罩）
  {
    hint: "私钥",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/,
  },
];

export interface SecretSpan {
  start: number;
  end: number;
  value: string;
  hint: string;
}

export interface SecretDetection {
  sensitive: boolean;
  /** 命中的类型提示，用于 UI 展示（如「已隐藏 GitHub Token」）。 */
  hint?: string;
}

/**
 * 找出文本中所有疑似密钥的区间（用于「只遮罩 Key 本身」）。
 * 多规则命中时按起点排序并去除重叠（较长的优先）。
 */
export function findSecretSpans(text: string): SecretSpan[] {
  const spans: SecretSpan[] = [];
  for (const { re, hint } of RULES) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, value: m[0], hint });
      if (m.index === g.lastIndex) g.lastIndex++; // 防零长匹配死循环
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: SecretSpan[] = [];
  let lastEnd = -1;
  for (const s of spans) {
    if (s.start >= lastEnd) {
      out.push(s);
      lastEnd = s.end;
    }
  }
  return out;
}

export function detectSecret(text: string): SecretDetection {
  const [first] = findSecretSpans(text);
  if (!first) return { sensitive: false };
  return { sensitive: true, hint: first.hint };
}
