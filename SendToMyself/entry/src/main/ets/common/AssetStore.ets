import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';

function bytes(value: string): Uint8Array { return new util.TextEncoder().encodeInto(value); }
function query(alias: string): asset.AssetMap {
  const result: asset.AssetMap = new Map();
  result.set(asset.Tag.ALIAS, bytes(alias));
  return result;
}
export async function readAsset(alias: string): Promise<string | null> {
  const q = query(alias);
  q.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
  try {
    const result = await asset.query(q);
    if (result.length !== 1) throw new Error('LOCAL_STORAGE_FAILED');
    const secret = result[0].get(asset.Tag.SECRET) as Uint8Array;
    if (!secret) throw new Error('LOCAL_STORAGE_FAILED');
    return util.TextDecoder.create('utf-8', { ignoreBOM: true }).decodeToString(secret, { stream: false });
  } catch (error) {
    if ((error as BusinessError).code === 24000002) return null;
    throw new Error('LOCAL_STORAGE_FAILED');
  }
}
export async function writeAsset(alias: string, value: string, exists: boolean): Promise<void> {
  const secret = bytes(value);
  if (secret.length > 1024) throw new Error('LOCAL_STORAGE_FAILED');
  const attrs: asset.AssetMap = new Map();
  attrs.set(asset.Tag.SECRET, secret);
  if (exists) await asset.update(query(alias), attrs);
  else {
    attrs.set(asset.Tag.ALIAS, bytes(alias));
    attrs.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    await asset.add(attrs);
  }
}
export async function removeAsset(alias: string): Promise<void> { await asset.remove(query(alias)); }
