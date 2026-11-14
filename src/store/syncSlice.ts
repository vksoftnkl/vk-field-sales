import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { SyncReport } from '@/sync/engine';

/** UI-facing sync status. Record-level state lives in the SQLite outbox. */
export interface SyncState {
  running: boolean;
  lastReport: SyncReport | null;
}

const initialState: SyncState = { running: false, lastReport: null };

const syncSlice = createSlice({
  name: 'sync',
  initialState,
  reducers: {
    syncStarted(state) {
      state.running = true;
    },
    syncFinished(state, action: PayloadAction<SyncReport>) {
      state.running = false;
      state.lastReport = action.payload;
    },
  },
});

export const { syncStarted, syncFinished } = syncSlice.actions;
export default syncSlice.reducer;
