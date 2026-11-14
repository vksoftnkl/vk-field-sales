import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** Who is logged in. Kept in memory only, so the app always opens on the login page. */
export interface Session {
  userId: string;
  username: string;
  displayName: string;
  /** Second salesman working with them (multi-user mode). Only the first one's password is checked. */
  secondUserId: string | null;
  secondDisplayName: string | null;
}

export interface SessionState {
  session: Session | null;
}

const initialState: SessionState = { session: null };

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<Session>) {
      state.session = action.payload;
    },
    signedOut(state) {
      state.session = null;
    },
  },
});

export const { signedIn, signedOut } = sessionSlice.actions;
export default sessionSlice.reducer;
