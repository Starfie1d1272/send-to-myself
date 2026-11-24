const RELEASES_BASE = "https://github.com/Starfie1d1272/send-to-myself/releases";

export const clientReleases = [
  {
    platform: "browser",
    label: "浏览器",
    releaseUrl: null,
    note: "使用同一地址访问；支持时可添加到主屏幕。Android、iPhone 和 Intel Mac 可使用浏览器。",
  },
  {
    platform: "windows",
    label: "Windows x64",
    releaseUrl: `${RELEASES_BASE}?q=Desktop`,
    note: "打开下载页最新桌面版安装包，首次启动时粘贴此地址。",
  },
  {
    platform: "macos",
    label: "macOS Apple Silicon",
    releaseUrl: `${RELEASES_BASE}?q=Desktop`,
    note: "打开下载页最新桌面版安装包，首次启动时粘贴此地址。",
  },
  {
    platform: "harmony",
    label: "鸿蒙",
    releaseUrl: `${RELEASES_BASE}?q=HarmonyOS`,
    note: "公开 HAP 未签名，需自行签名后安装；请查阅发布页配套说明。",
  },
] as const;
