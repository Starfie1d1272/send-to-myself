import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { ASSET_ALIAS_SERVER_URL, ASSET_ALIAS_DEVICE_TOKEN } from './Constants';

function stringToArray(str: string): Uint8Array {
  let textEncoder = new util.TextEncoder();
  return textEncoder.encodeInto(str);
}

function arrayToString(arr: Uint8Array): string {
  let textDecoder = util.TextDecoder.create('utf-8', { ignoreBOM: true });
  return textDecoder.decodeToString(arr, { stream: false });
}

function buildQuery(alias: string): asset.AssetMap {
  let query: asset.AssetMap = new Map();
  query.set(asset.Tag.ALIAS, stringToArray(alias));
  query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
  return query;
}

export async function saveServerUrl(url: string): Promise<void> {
  try {
    await removeServerUrl();
  } catch (_e) {
  }
  let attr: asset.AssetMap = new Map();
  attr.set(asset.Tag.ALIAS, stringToArray(ASSET_ALIAS_SERVER_URL));
  attr.set(asset.Tag.SECRET, stringToArray(url));
  attr.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
  await asset.add(attr);
}

export async function loadServerUrl(): Promise<string | undefined> {
  try {
    let res = await asset.query(buildQuery(ASSET_ALIAS_SERVER_URL));
    if (res.length > 0) {
      return arrayToString(res[0].get(asset.Tag.SECRET) as Uint8Array);
    }
    return undefined;
  } catch (_e) {
    return undefined;
  }
}

export async function removeServerUrl(): Promise<void> {
  let query: asset.AssetMap = new Map();
  query.set(asset.Tag.ALIAS, stringToArray(ASSET_ALIAS_SERVER_URL));
  await asset.remove(query);
}

export async function saveDeviceToken(token: string): Promise<void> {
  try {
    await removeDeviceToken();
  } catch (_e) {
  }
  let attr: asset.AssetMap = new Map();
  attr.set(asset.Tag.ALIAS, stringToArray(ASSET_ALIAS_DEVICE_TOKEN));
  attr.set(asset.Tag.SECRET, stringToArray(token));
  attr.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
  attr.set(asset.Tag.IS_PERSISTENT, true);
  await asset.add(attr);
}

export async function loadDeviceToken(): Promise<string | undefined> {
  try {
    let res = await asset.query(buildQuery(ASSET_ALIAS_DEVICE_TOKEN));
    if (res.length > 0) {
      return arrayToString(res[0].get(asset.Tag.SECRET) as Uint8Array);
    }
    return undefined;
  } catch (_e) {
    return undefined;
  }
}

export async function removeDeviceToken(): Promise<void> {
  let query: asset.AssetMap = new Map();
  query.set(asset.Tag.ALIAS, stringToArray(ASSET_ALIAS_DEVICE_TOKEN));
  await asset.remove(query);
}

export async function clearAll(): Promise<void> {
  await removeServerUrl().catch(() => {});
  await removeDeviceToken().catch(() => {});
}
