export const clientReleases = [
  {
    platform: "browser",
    label: "浏览器",
    status: "web-only",
    version: null,
    releaseUrl: null,
    note: "使用同一地址访问；支持时可添加到主屏幕。Android、iPhone 和 Intel Mac 可使用浏览器。",
  },
  {
    platform: "windows",
    label: "Windows x64",
    status: "stable",
    version: "desktop-v1.0.0",
    releaseUrl: "https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.0.0",
    note: "首次打开时粘贴此地址。",
  },
  {
    platform: "macos",
    label: "macOS Apple Silicon",
    status: "stable",
    version: "desktop-v1.0.0",
    releaseUrl: "https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.0.0",
    note: "首次打开时粘贴此地址。",
  },
  {
    platform: "harmony",
    label: "鸿蒙",
    status: "preview",
    version: "harmony-v1.1.1-rc.1",
    releaseUrl: "https://github.com/Starfie1d1272/send-to-myself/releases/tag/harmony-v1.1.1-rc.1",
    note: "开发预览，需要自行签名；请查阅配套 Web 要求。",
  },
] as const;
