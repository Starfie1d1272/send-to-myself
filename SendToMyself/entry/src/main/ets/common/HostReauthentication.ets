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
