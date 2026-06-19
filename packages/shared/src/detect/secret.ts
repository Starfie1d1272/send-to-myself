/** 疑似 API Key / Token 识别（SPEC §6）。命中只置 sensitive 建议，不改内容。 */

interface SecretRule {
  hint: string;
  re: RegExp;
}

// 常见密钥前缀。命中即视为疑似敏感。
const RULES: SecretRule[] = [
  { hint: "OpenAI / 兼容 Key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { hint: "GitHub Token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { hint: "GitHub PAT", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { hint: "AWS Access Key", re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { hint: "Google API Key", re: /\bAIza[A-Za-z0-9_-]{30,}\b/ },
  { hint: "Slack Token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { hint: "GitLab PAT", re: /\bglpat-[A-Za-z0-9_-]{16,}\b/ },
  { hint: "Bearer Token", re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
  { hint: "私钥", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export interface SecretDetection {
  sensitive: boolean;
  /** 命中的类型提示，用于 UI 展示「已隐藏敏感内容」。 */
  hint?: string;
}

export function detectSecret(text: string): SecretDetection {
  for (const { re, hint } of RULES) {
    if (re.test(text)) return { sensitive: true, hint };
  }
  return { sensitive: false };
}
