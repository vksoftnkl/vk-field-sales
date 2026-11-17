import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { DraftLine } from '@/features/orders/order-draft';

/**
 * The bill being made (Select items → Bill item → Bill), in memory until Save writes it to
 * sale_bill. One at a time, for one customer and company; starting a bill for another customer
 * or company starts a new one.
 */

/** One unit on the bill: an order line plus what tax and stock need. Cooly and freight stay '0'. */
export interface SaleLine extends DraftLine {
  /** GST % ('5.000') and whether the price already includes it. */
  taxPerc: string | null;
  inclTax: boolean;
  taxId: string | null;
  hsnCode: string | null;
  /** Base units in one of this unit. */
  factor: string;
  /** Free to sell in this unit when the line was started (last Sync less this phone's bills). */
  stockLeft: number;
}

export interface SaleDraftState {
  customerId: string | null;
  companyId: string | null;
  lines: SaleLine[];
  /** Bill discount as typed: a % or rupees, never both (typing one clears the other). */
  discPerc: string;
  discAmount: string;
  remarks: string;
}

const initialState: SaleDraftState = { customerId: null, companyId: null, lines: [], discPerc: '', discAmount: '', remarks: '' };

const saleDraftSlice = createSlice({
  name: 'saleDraft',
  initialState,
  reducers: {
    /** Select items opened: keeps the bill if it is for this customer and company, else starts afresh. */
    saleStarted(state, action: PayloadAction<{ customerId: string; companyId: string }>) {
      const { customerId, companyId } = action.payload;
      if (state.customerId === customerId && state.companyId === companyId) return;
      return { ...initialState, customerId, companyId };
    },
    /** Qty typed on a row of Select items or Bill: adds the line (from `seed`) the first time. */
    saleQtyTyped(state, action: PayloadAction<{ seed: SaleLine; qty: string }>) {
      const line = state.lines.find((l) => l.iucId === action.payload.seed.iucId);
      if (line) line.qty = action.payload.qty;
      else if (action.payload.qty !== '') state.lines.push({ ...action.payload.seed, qty: action.payload.qty });
    },
    /** Save on Bill item. */
    saleLineSaved(state, action: PayloadAction<SaleLine>) {
      const i = state.lines.findIndex((l) => l.iucId === action.payload.iucId);
      if (i >= 0) state.lines[i] = action.payload;
      else state.lines.push(action.payload);
    },
    saleLineRemoved(state, action: PayloadAction<string>) {
      state.lines = state.lines.filter((l) => l.iucId !== action.payload);
    },
    billDiscPercTyped(state, action: PayloadAction<string>) {
      state.discPerc = action.payload;
      state.discAmount = '';
    },
    billDiscAmountTyped(state, action: PayloadAction<string>) {
      state.discAmount = action.payload;
      state.discPerc = '';
    },
    billRemarksTyped(state, action: PayloadAction<string>) {
      state.remarks = action.payload;
    },
    /** Saved or discarded. */
    saleCleared() {
      return initialState;
    },
  },
});

export const { saleStarted, saleQtyTyped, saleLineSaved, saleLineRemoved, billDiscPercTyped, billDiscAmountTyped, billRemarksTyped, saleCleared } =
  saleDraftSlice.actions;
export default saleDraftSlice.reducer;
