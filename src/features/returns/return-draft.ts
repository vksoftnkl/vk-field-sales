import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { ReturnLine } from './return-math';

/**
 * The sales return being made (Sales return → Product list → Return item), in memory until
 * Create credit note writes it to sale_return. One at a time. Change customer keeps the lines.
 */
export interface ReturnDraftState {
  /** The customer Sales return was opened for: opening it again for them keeps the return. */
  startedFor: string | null;
  customerId: string | null;
  companyId: string | null;
  lines: ReturnLine[];
}

const initialState: ReturnDraftState = { startedFor: null, customerId: null, companyId: null, lines: [] };

const returnDraftSlice = createSlice({
  name: 'returnDraft',
  initialState,
  reducers: {
    /** Sales return opened: keeps the return if it was started here, else starts afresh. */
    returnStarted(state, action: PayloadAction<{ customerId: string; companyId: string }>) {
      const { customerId, companyId } = action.payload;
      if (state.startedFor === customerId && state.companyId === companyId) return;
      return { ...initialState, startedFor: customerId, customerId, companyId };
    },
    /** Choose customer. */
    returnCustomerChanged(state, action: PayloadAction<string>) {
      state.customerId = action.payload;
    },
    /** Save on Return item: replaces the line with the same key, else adds it. */
    returnLineSaved(state, action: PayloadAction<ReturnLine>) {
      const i = state.lines.findIndex((l) => l.key === action.payload.key);
      if (i >= 0) state.lines[i] = action.payload;
      else state.lines.push(action.payload);
    },
    returnLineRemoved(state, action: PayloadAction<string>) {
      state.lines = state.lines.filter((l) => l.key !== action.payload);
    },
    /** Saved or discarded. */
    returnCleared() {
      return initialState;
    },
  },
});

export const { returnStarted, returnCustomerChanged, returnLineSaved, returnLineRemoved, returnCleared } = returnDraftSlice.actions;
export default returnDraftSlice.reducer;
