import { http } from '@kit.NetworkKit';
import { postJson, extractCookieFromResponse, getJson } from './HttpClient';
import { saveServerUrl, saveDeviceToken, loadServerUrl, loadDeviceToken, removeDeviceToken } from './AssetStore';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DOMAIN, TAG } from './Constants';

interface LoginRequestBody {
  password: string;
}

interface CreateDeviceRequestBody {
  name: string;
}

interface LoginResultData {
  success: boolean;
  errorMessage?: string;
  retryAfter?: number;
}

class LoginResultClass implements LoginResultData {
  success: boolean = false;
  errorMessage?: string = undefined;
  retryAfter?: number = undefined;

  constructor(success: boolean, errorMessage?: string, retryAfter?: number) {
    this.success = success;
    this.errorMessage = errorMessage;
    this.retryAfter = retryAfter;
  }
}

interface LockedResponse {
  error: string;
  retryAfter: number;
}

interface DeviceTokenResponse {
  token: string;
  name: string;
  createdAt: number;
}

interface AuthMeResponse {
  authEnabled: boolean;
  authenticated: boolean;
}

export async function loginAndMintToken(serverUrl: string, password: string, deviceName: string): Promise<LoginResultData> {
  await saveServerUrl(serverUrl);

  let loginResponse: http.HttpResponse;
  try {
    let reqBody: LoginRequestBody = { password: password };
    loginResponse = await postJson('/api/auth/login', reqBody);
  } catch (err) {
    let errMsg = (err as Error).message;
    hilog.error(DOMAIN, TAG, 'Login network error: %{public}s', errMsg);
    return new LoginResultClass(false, 'Network error');
  }

  if (loginResponse.responseCode === 401) {
    return new LoginResultClass(false, 'Invalid credentials');
  }
  if (loginResponse.responseCode === 429) {
    let body: LockedResponse = JSON.parse(loginResponse.result as string) as LockedResponse;
    return new LoginResultClass(false, 'Too many attempts', body.retryAfter);
  }
  if (loginResponse.responseCode !== 200) {
    return new LoginResultClass(false, 'Server error: ' + loginResponse.responseCode.toString());
  }

  let cookie = extractCookieFromResponse(loginResponse);
  if (!cookie) {
    return new LoginResultClass(false, 'No session cookie received');
  }

  let deviceResponse: http.HttpResponse;
  try {
    let reqBody: CreateDeviceRequestBody = { name: deviceName };
    deviceResponse = await postJson('/api/auth/devices', reqBody, cookie);
  } catch (err) {
    let errMsg = (err as Error).message;
    hilog.error(DOMAIN, TAG, 'Mint token network error: %{public}s', errMsg);
    return new LoginResultClass(false, 'Network error during token minting');
  }

  if (deviceResponse.responseCode !== 201) {
    return new LoginResultClass(false, 'Failed to mint device token: ' + deviceResponse.responseCode.toString());
  }

  let deviceBody: DeviceTokenResponse = JSON.parse(deviceResponse.result as string) as DeviceTokenResponse;
  let token: string = deviceBody.token;
  if (!token) {
    return new LoginResultClass(false, 'No token in response');
  }

  await saveDeviceToken(token);
  hilog.info(DOMAIN, TAG, 'Device token saved successfully');
  return new LoginResultClass(true);
}

export async function checkTokenValid(): Promise<boolean> {
  let token = await loadDeviceToken();
  if (!token) {
    return false;
  }
  try {
    let response = await getJson('/api/auth/me');
    if (response.responseCode !== 200) {
      return false;
    }
    let body: AuthMeResponse = JSON.parse(response.result as string) as AuthMeResponse;
    return body.authenticated === true;
  } catch (_e) {
    return false;
  }
}

export async function isConfigured(): Promise<boolean> {
  let serverUrl = await loadServerUrl();
  let token = await loadDeviceToken();
  return serverUrl !== undefined && token !== undefined;
}

export async function clearAuth(): Promise<void> {
  await removeDeviceToken();
}
