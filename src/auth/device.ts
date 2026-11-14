import * as Application from 'expo-application';
import { getRandomBytes } from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { APP_VERSION } from '@/config/env';
import { uuidv7 } from '@/lib/uuid';

import { keystore } from './keystore';

/**
 * Stable per-install device id. Generated once and kept in the Keystore.
 * The server's mobile_devices table keys on it; the office approves / blocks it there
 * (the new version of the old app's /checkMacAddress).
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await keystore.getDeviceId();
  if (existing) return existing;
  const id = uuidv7();
  await keystore.setDeviceId(id);
  return id;
}

/**
 * Random 256-bit secret, created once per install. Sent with every sync request so
 * another phone can't pretend to be this one just by knowing its device id.
 * The server keeps only a hash of it (see docs/SYNC-API.md).
 */
export async function getOrCreateDeviceKey(): Promise<string> {
  const existing = await keystore.getDeviceKey();
  if (existing) return existing;
  const key = Array.from(getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
  await keystore.setDeviceKey(key);
  return key;
}

/** Short, readable form of the device id for the office to match when approving. */
export const shortDeviceId = (id: string) => id.slice(-8).toUpperCase();

export interface DeviceInfo {
  deviceId: string;
  platform: string;
  model: string | null;
  osVersion: string | null;
  appVersion: string;
  buildNumber: string | null;
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  return {
    deviceId: await getOrCreateDeviceId(),
    platform: Platform.OS,
    model: Device.modelName,
    osVersion: Device.osVersion,
    appVersion: APP_VERSION,
    buildNumber: Application.nativeBuildVersion,
  };
}
