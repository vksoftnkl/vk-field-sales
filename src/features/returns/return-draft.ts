import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { lineKeyOf, type Condition, type ReturnPart, type SettleMode } from './return-math';

/**
 * The sales return being made (canvas 6b: Shop and bill → Return items → Return line → Review →
 * Adjust), in memory until Save return writes it to sale_return. One at a time. `editingId` is a
 * saved return being changed (waiting to send, or sent back by VK Nex): Save replaces it.
 */
export interface DraftBill {
  sbId: string;
  accYear: string;
  refno: string;
  date: string;
}

export interface DraftAdjustRow {
  billId: string;
  billAccYear: string;
  refno: string;
  amountPaise: number;
}

export interface ReturnDraftState {
  /** The customer Sales return was opened for: opening it again for them keeps the return. */
  startedFor: string | null;
  editingId: string | null;
  customerId: string | null;
  companyId: string | null;
  branchId: string | null;
  /** The bill the goods came on; null with noBill = a return with no bill. */
  bill: DraftBill | null;
  noBill: boolean;
  reasonId: string | null;
  parts: ReturnPart[];
  /** null = VK Nex's default for this return (defaultSettle). */
  settleMode: SettleMode | null;
  /** The salesman's own Adjust split; null = VK Nex's plan (this bill first, then oldest). */
  adjust: DraftAdjustRow[] | null;
  /** Goods go into; null = each bill line's own godown (the branch's default with no bill). */
  godownId: string | null;
  usrRefno: string;
  usrRefdate: string;
  remarks: string;
}

const initialState: ReturnDraftState = {
  startedFor: null,
  editingId: null,
  customerId: null,
  companyId: null,
  branchId: null,
  bill: null,
  noBill: false,
  reasonId: null,
  parts: [],
  settleMode: null,
  adjust: null,
  godownId: null,
  usrRefno: '',
  usrRefdate: '',
  remarks: '',
};

const returnDraftSlice = createSlice({
  name: 'returnDraft',
  initialState,
  reducers: {
    /** Sales return opened for a shop: keeps the return if it was started here, else starts afresh. */
    returnStarted(state, action: PayloadAction<{ customerId: string; companyId: string; branchId: string | null }>) {
      const { customerId, companyId, branchId } = action.payload;
      if (state.startedFor === customerId && state.companyId === companyId && !state.editingId) return;
      return { ...initialState, startedFor: customerId, customerId, companyId, branchId };
    },
    /** A saved return opened to change it (Edit on a waiting or sent-back return). */
    returnLoaded(_state, action: PayloadAction<Omit<ReturnDraftState, 'startedFor'>>) {
      return { ...action.payload, startedFor: action.payload.customerId };
    },
    /** Choose customer: only before a bill is picked (the desktop locks the customer then). */
    returnCustomerChanged(state, action: PayloadAction<string>) {
      if (state.bill) return;
      state.customerId = action.payload;
    },
    /** A bill picked: a different bill starts the lines afresh. */
    returnBillPicked(state, action: PayloadAction<DraftBill>) {
      const b = action.payload;
      if (state.bill?.sbId !== b.sbId || state.bill?.accYear !== b.accYear || state.noBill) {
        state.parts = [];
        state.adjust = null;
        state.settleMode = null;
      }
      state.bill = b;
      state.noBill = false;
    },
    /** No bill chosen: lines from a bill go. */
    returnNoBillChosen(state) {
      if (!state.noBill) {
        state.parts = [];
        state.adjust = null;
        state.settleMode = null;
      }
      state.bill = null;
      state.noBill = true;
    },
    /**
     * The reason (one per return). Parts still on the old reason's condition take the new one's,
     * as the desktop fills the rows not yet typed.
     */
    returnReasonSet(state, action: PayloadAction<{ reasonId: string; from: Condition | null; to: Condition | null }>) {
      const { reasonId, from, to } = action.payload;
      state.reasonId = reasonId;
      if (to) for (const p of state.parts) if (!from || p.condition === from) p.condition = to;
    },
    /** Return line saved: its parts replace the line's parts (an empty list removes it). */
    returnLineSaved(state, action: PayloadAction<{ lineKey: string; parts: ReturnPart[] }>) {
      const { lineKey, parts } = action.payload;
      const at = state.parts.findIndex((p) => lineKeyOf(p) === lineKey);
      const rest = state.parts.filter((p) => lineKeyOf(p) !== lineKey);
      rest.splice(at >= 0 ? at : rest.length, 0, ...parts);
      state.parts = rest;
      state.adjust = null;
    },
    returnLineRemoved(state, action: PayloadAction<string>) {
      state.parts = state.parts.filter((p) => lineKeyOf(p) !== action.payload);
      state.adjust = null;
    },
    /** All back: these parts are added for the lines not on the return yet. */
    returnAllBack(state, action: PayloadAction<ReturnPart[]>) {
      const have = new Set(state.parts.map(lineKeyOf));
      state.parts.push(...action.payload.filter((p) => !have.has(lineKeyOf(p))));
      state.adjust = null;
    },
    returnLinesCleared(state) {
      state.parts = [];
      state.adjust = null;
    },
    returnSettleSet(state, action: PayloadAction<SettleMode>) {
      state.settleMode = action.payload;
    },
    returnAdjustSet(state, action: PayloadAction<DraftAdjustRow[] | null>) {
      state.adjust = action.payload;
    },
    returnGodownSet(state, action: PayloadAction<string | null>) {
      state.godownId = action.payload;
    },
    returnFieldsSet(state, action: PayloadAction<Partial<Pick<ReturnDraftState, 'usrRefno' | 'usrRefdate' | 'remarks'>>>) {
      Object.assign(state, action.payload);
    },
    /** Saved or discarded. */
    returnCleared() {
      return initialState;
    },
  },
});

export const {
  returnStarted,
  returnLoaded,
  returnCustomerChanged,
  returnBillPicked,
  returnNoBillChosen,
  returnReasonSet,
  returnLineSaved,
  returnLineRemoved,
  returnAllBack,
  returnLinesCleared,
  returnSettleSet,
  returnAdjustSet,
  returnGodownSet,
  returnFieldsSet,
  returnCleared,
} = returnDraftSlice.actions;
export default returnDraftSlice.reducer;
