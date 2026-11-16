import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { LineInput } from './order-math';

/**
 * The order being taken (Order entry → Order item → Order summary), in memory until Save order
 * writes it to sale_order. One at a time, for one customer and company; starting an order for
 * another customer or company starts a new one.
 */

/** One unit on the order, with what the screens show of it, so Summary needs no look-up. */
export interface DraftLine extends LineInput {
  /** item_unit_conversion.iuc_id: one line per unit, as in the Qt app. */
  iucId: string;
  itemId: string;
  name: string;
  nameTa: string | null;
  unitName: string;
  /** VK Nex price level the price came from (1-4), null when typed by hand from the start. */
  priceLevel: number | null;
  /** Allow promotion (schemes) on this line; only offered when the item allows it. */
  promo: boolean;
  allowPromo: boolean;
  mrp: string | null;
  minPrice: string | null;
}

export interface OrderDraftState {
  customerId: string | null;
  companyId: string | null;
  lines: DraftLine[];
  vehicleNo: string;
  remarks: string;
}

const initialState: OrderDraftState = { customerId: null, companyId: null, lines: [], vehicleNo: '', remarks: '' };

const orderDraftSlice = createSlice({
  name: 'orderDraft',
  initialState,
  reducers: {
    /** Order entry opened: keeps the draft if it is for this customer and company, else starts afresh. */
    orderStarted(state, action: PayloadAction<{ customerId: string; companyId: string }>) {
      const { customerId, companyId } = action.payload;
      if (state.customerId === customerId && state.companyId === companyId) return;
      return { ...initialState, customerId, companyId };
    },
    /** Qty typed on a list row: adds the line (from `seed`) the first time. */
    qtyTyped(state, action: PayloadAction<{ seed: DraftLine; qty: string }>) {
      const line = state.lines.find((l) => l.iucId === action.payload.seed.iucId);
      if (line) line.qty = action.payload.qty;
      else if (action.payload.qty !== '') state.lines.push({ ...action.payload.seed, qty: action.payload.qty });
    },
    /** Save on Order item. */
    lineSaved(state, action: PayloadAction<DraftLine>) {
      const i = state.lines.findIndex((l) => l.iucId === action.payload.iucId);
      if (i >= 0) state.lines[i] = action.payload;
      else state.lines.push(action.payload);
    },
    lineRemoved(state, action: PayloadAction<string>) {
      state.lines = state.lines.filter((l) => l.iucId !== action.payload);
    },
    vehicleTyped(state, action: PayloadAction<string>) {
      state.vehicleNo = action.payload;
    },
    remarksTyped(state, action: PayloadAction<string>) {
      state.remarks = action.payload;
    },
    /** Saved or discarded. */
    orderCleared() {
      return initialState;
    },
  },
});

export const { orderStarted, qtyTyped, lineSaved, lineRemoved, vehicleTyped, remarksTyped, orderCleared } = orderDraftSlice.actions;
export default orderDraftSlice.reducer;
