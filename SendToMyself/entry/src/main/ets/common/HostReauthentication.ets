// Navigation bridge only: ConnectionSession and MainPage remain the authentication owners.
let action: (() => Promise<string>) | undefined;
export function registerHostReauthentication(handler: () => Promise<string>): void { action = handler; }
export function unregisterHostReauthentication(handler: () => Promise<string>): void {
  if (action === handler) action = undefined;
}
export async function requestHostReauthentication(): Promise<string> {
  if (!action) throw new Error('宿主登录暂不可用，请返回首页重试');
  return action();
}

let settingsAction: (() => Promise<void>) | undefined;
export function registerHostConnectionSettings(handler: () => Promise<void>): void { settingsAction = handler; }
export function unregisterHostConnectionSettings(handler: () => Promise<void>): void {
  if (settingsAction === handler) settingsAction = undefined;
}
export async function requestHostConnectionSettings(): Promise<void> {
  if (!settingsAction) throw new Error('连接设置暂不可用，请返回首页重试');
  await settingsAction();
}
