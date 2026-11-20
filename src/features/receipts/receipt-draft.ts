import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * The receipt being taken (Dues and amount → Payment → Review), in memory until Save receipt
 * writes it to the receipts table. One at a time, for one customer and company; starting one for
 * another customer or company starts afresh. Since the desktop-rule receipt (canvas 5b) it also
 * keeps the bills and credits adjusted by hand; the rest is worked out by settle().
 */

/** One way of paying, as typed on Payment. */
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
  /** Cheques: branch, IFSC and drawer (optional, as the desktop's cheque window). */
  chequeBranch?: string;
  chequeIfsc?: string;
  chequeDrawer?: string;
  /** Bank transfers: 'NEFT' | 'IMPS' | 'RTGS' ('' = not picked yet). */
  transferType?: string;
}

/** A bill adjusted by hand (Bill adjustment), as typed (rupees). */
export interface TypedBill {
  receive: string;
  discount: string;
  roundoff: string;
}

export interface ReceiptDraftState {
  customerId: string | null;
  companyId: string | null;
  /** The receipt amount as typed. */
  amount: string;
  lines: TenderLine[];
  remarks: string;
  /** Bills adjusted by hand, by bill key (billId|billAccYear). */
  typedBills: Record<string, TypedBill>;
  /** Credits lowered by hand, by key (rupees as typed). */
  typedCredits: Record<string, string>;
  /** The shop's own receipt no. and its date (YYYY-MM-DD). */
  docRefno: string;
  docDate: string | null;
  /** A sent-back receipt being fixed (Edit): Save replaces it. */
  editingId: string | null;
}

const initialState: ReceiptDraftState = {
  customerId: null,
  companyId: null,
  amount: '',
  lines: [],
  remarks: '',
  typedBills: {},
  typedCredits: {},
  docRefno: '',
  docDate: null,
  editingId: null,
};

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
    /** Bill adjustment saved (null = back to Fill oldest first for that bill). */
    billTyped(state, action: PayloadAction<{ key: string; entry: TypedBill | null }>) {
      if (action.payload.entry) state.typedBills[action.payload.key] = action.payload.entry;
      else delete state.typedBills[action.payload.key];
    },
    creditTyped(state, action: PayloadAction<{ key: string; amount: string | null }>) {
      if (action.payload.amount === null) delete state.typedCredits[action.payload.key];
      else state.typedCredits[action.payload.key] = action.payload.amount;
    },
    /** Fill oldest first: every bill and credit back to the desktop's Auto-allocate. */
    handEntriesCleared(state) {
      state.typedBills = {};
      state.typedCredits = {};
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
    docRefTyped(state, action: PayloadAction<{ docRefno?: string; docDate?: string | null }>) {
      if (action.payload.docRefno !== undefined) state.docRefno = action.payload.docRefno;
      if (action.payload.docDate !== undefined) state.docDate = action.payload.docDate;
    },
    /** A sent-back receipt opened again to fix it (Edit). */
    receiptLoaded(_state, action: PayloadAction<ReceiptDraftState>) {
      return action.payload;
    },
    /** Saved or discarded. */
    receiptCleared() {
      return initialState;
    },
  },
});

export const {
  receiptStarted,
  receiptAmountTyped,
  billTyped,
  creditTyped,
  handEntriesCleared,
  tenderAdded,
  tenderChanged,
  tenderRemoved,
  receiptRemarksTyped,
  docRefTyped,
  receiptLoaded,
  receiptCleared,
} = receiptDraftSlice.actions;
export default receiptDraftSlice.reducer;
