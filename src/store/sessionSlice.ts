import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { DeviceStatus } from '@/api/types';
import type { StoredSession } from '@/auth/keystore';

export interface SessionState {
  status: 'restoring' | 'signedOut' | 'signedIn';
  session: StoredSession | null;
  /** The office's decision about this phone. Belongs to the device, so it survives sign-out. */
  deviceStatus: DeviceStatus | null;
}

const initialState: SessionState = { status: 'restoring', session: null, deviceStatus: null };

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<StoredSession>) {
      state.status = 'signedIn';
      state.session = action.payload;
    },
    signedOut(state) {
      state.status = 'signedOut';
      state.session = null;
    },
    deviceStatusChanged(state, action: PayloadAction<DeviceStatus | null>) {
      state.deviceStatus = action.payload;
    },
  },
});

export const { signedIn, signedOut, deviceStatusChanged } = sessionSlice.actions;
export default sessionSlice.reducer;
