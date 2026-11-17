import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * The receipt being taken (Receipt → Payment types), in memory until Save receipt writes it to
 * the receipts table. One at a time, for one customer and company; starting one for another
 * customer or company starts afresh.
 */

/** One way of paying, as typed on Payment types. */
export interface TenderLine {
  /** The tender (a tender can be on a receipt once, so it also keys the line). */
  tndId: string;
  typeId: number;
  name: string;
  needsRef: boolean;
  refLabel: string | null;
  /** What this line pays towards the receipt (surcharge not included). */
  amount: string;
  refNo: string;
  bankName: string;
  /** YYYY-MM-DD; cheques only. */
  instrumentDate: string | null;
  /** The tender's surcharge (exact text): the customer pays it on top of amount. */
  surchargePerc: string;
  surchargeFlat: string;
}

export interface ReceiptDraftState {
  customerId: string | null;
  companyId: string | null;
  /** The receipt amount as typed. */
  amount: string;
  lines: TenderLine[];
  remarks: string;
}

const initialState: ReceiptDraftState = { customerId: null, companyId: null, amount: '', lines: [], remarks: '' };

const receiptDraftSlice = createSlice({
  name: 'receiptDraft',
  initialState,
  reducers: {
    /** Receipt opened: keeps the draft if it is for this customer and company, else starts afresh. */
    receiptStarted(state, action: PayloadAction<{ customerId: string; companyId: string }>) {
      const { customerId, companyId } = action.payload;
      if (state.customerId === customerId && state.companyId === companyId) return;
      return { ...initialState, customerId, companyId };
    },
    receiptAmountTyped(state, action: PayloadAction<string>) {
      state.amount = action.payload;
    },
    tenderAdded(state, action: PayloadAction<TenderLine>) {
      if (!state.lines.some((l) => l.tndId === action.payload.tndId)) state.lines.push(action.payload);
    },
    tenderChanged(state, action: PayloadAction<{ tndId: string; patch: Partial<Omit<TenderLine, 'tndId'>> }>) {
      const line = state.lines.find((l) => l.tndId === action.payload.tndId);
      if (line) Object.assign(line, action.payload.patch);
    },
    tenderRemoved(state, action: PayloadAction<string>) {
      state.lines = state.lines.filter((l) => l.tndId !== action.payload);
    },
    receiptRemarksTyped(state, action: PayloadAction<string>) {
      state.remarks = action.payload;
    },
    /** Saved or discarded. */
    receiptCleared() {
      return initialState;
    },
  },
});

export const { receiptStarted, receiptAmountTyped, tenderAdded, tenderChanged, tenderRemoved, receiptRemarksTyped, receiptCleared } =
  receiptDraftSlice.actions;
export default receiptDraftSlice.reducer;
