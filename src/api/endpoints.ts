import type { DeviceInfo } from '@/auth/device';
import { SYNC } from '@/config/env';
import type { ServerAddress } from '@/config/server';

import { http, request } from './http';
import type { PullResponse, PullScope, PushRequest, PushResponse, RegisterDeviceResponse } from './types';

/** Every server call the app makes, in one place. All of them go to the VK Nex server PC. */
export const api = {
  /** Server settings → Test connection. Public route, no device headers. */
  health: (server: ServerAddress) => request<unknown>('/health', { server, device: false, timeoutMs: SYNC.pingTimeoutMs }),
  device: {
    /** First call of every sync: announces the phone and returns its approval status. */
    register: (info: DeviceInfo) => http.post<RegisterDeviceResponse>('/mobile/devices/register', info),
  },
  sync: {
    push: (body: PushRequest) => http.post<PushResponse>('/mobile/sync/push', body),
    pull: <Row>(scope: PullScope, cursor: string | null, limit: number) =>
      http.get<PullResponse<Row>>(`/mobile/sync/pull/${scope}`, { cursor, limit }),
  },
};
