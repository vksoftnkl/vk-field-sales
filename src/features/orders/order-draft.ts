import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { LineInput } from './order-math';
import type { DiscMode, SoLineInput } from './so-math';
import { DEFAULT_PRIORITY, type SoPriority } from './so-priority.ts';

/**
 * One unit on a bill (Sales builds its SaleLine on this). Orders use SoLine below since the 3b
 * workflow; this stays as it was for Sales.
 */
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

/** The check-in made when the visit opened: when, and where (null = no GPS fix). */
export interface CheckIn {
  at: string;
  fix: { latitude: number; longitude: number; accuracyM: number | null; locatedAt: string } | null;
}

/**
 * One item on the order (canvas 3b): one line per item, in the unit picked on Order item (the
 * same item added again adds to its line). Carries what the screens and the save need, so Review
 * needs no look-up.
 */
export interface SoLine extends SoLineInput {
  itemId: string;
  /** item_unit_conversion.iuc_id of the unit the line is in. */
  iucId: string;
  name: string;
  nameTa: string | null;
  unitName: string;
  /** Base units in one of this unit. */
  factor: string;
  /** VK Nex price level the rate came from (1-4), null when typed by hand. */
  priceLevel: number | null;
  mrp: string | null;
  minPrice: string | null;
  taxId: string | null;
  hsnCode: string | null;
  /** The customer's promotion flag AND the item's: offers may apply to this line (the line's own switch is the draft's offersOn). */
  promo: boolean;
}

/**
 * How the order was started, which decides the screen that asks before throwing it away:
 * Visit for a new order, Add items for a repeat, Review for an edit of a saved order.
 */
export type OrderEntry = 'visit' | 'repeat' | 'edit';

/**
 * The order being taken (Visit → Add items → Order item → Review), in memory until Save writes
 * it to sale_order. One at a time, for one customer and company.
 */
export interface OrderDraftState {
  customerId: string | null;
  /**
   * The company and branch the order is for: Switch company's when the order was started, kept
   * with the order from then on. branchId is null only on orders saved before branches came.
   */
  companyId: string | null;
  branchId: string | null;
  entry: OrderEntry;
  /** The saved order being edited (its so_id), or null for a new one. */
  editingSoId: string | null;
  lines: SoLine[];
  /** YYYY-MM-DD; null = the order date. */
  deliveryDate: string | null;
  /** LOW | NORMAL | HIGH | URGENT (the Review dropdown); URGENT needs a remark. */
  priority: SoPriority;
  remarks: string;
  checkIn: CheckIn | null;
  /**
   * The per-line "Offers on this line" switch, by itemId. Only an explicit off is kept (false); a
   * missing key = on. It can only turn offers off: a line the shop or the item doesn't take offers
   * on never gets them.
   */
  offersOn: Record<string, boolean>;
  /** The order's Apply offers switch; null = not touched: the customer's own allow-promotion flag. */
  applyOffers: boolean | null;
}

const initialState: OrderDraftState = {
  customerId: null,
  companyId: null,
  branchId: null,
  entry: 'visit',
  editingSoId: null,
  lines: [],
  deliveryDate: null,
  priority: DEFAULT_PRIORITY,
  remarks: '',
  checkIn: null,
  offersOn: {},
  applyOffers: null,
};

/** Opening the Visit for this customer carries on with the draft: a new order with items in it. */
export const resumesVisit = (d: OrderDraftState, customerId: string): boolean => d.customerId === customerId && !d.editingSoId && d.lines.length > 0;

const orderDraftSlice = createSlice({
  name: 'orderDraft',
  initialState,
  reducers: {
    /**
     * Visit opened: an order in progress for this customer goes on (same check-in); anything else
     * starts afresh with a new check-in.
     */
    visitStarted(state, action: PayloadAction<{ customerId: string; companyId: string | null; branchId: string | null; at: string }>) {
      const { customerId, companyId, branchId, at } = action.payload;
      if (resumesVisit(state, customerId)) {
        state.checkIn ??= { at, fix: null };
        return;
      }
      return { ...initialState, customerId, companyId, branchId, checkIn: { at, fix: null } };
    },
    /** The GPS fix for the check-in arrived (or was read again). */
    fixFound(state, action: PayloadAction<CheckIn['fix']>) {
      if (state.checkIn) state.checkIn.fix = action.payload;
    },
    /**
     * Switch company picked a company and branch for an order that had none yet. Another company's
     * prices differ, so its lines go; the same company keeps them.
     */
    contextChosen(state, action: PayloadAction<{ companyId: string; branchId: string | null }>) {
      if (state.companyId !== action.payload.companyId) {
        state.lines = [];
        state.offersOn = {};
      }
      state.companyId = action.payload.companyId;
      state.branchId = action.payload.branchId;
    },
    /** Add items opened straight from Repeat order: the copied lines, at today's prices. */
    orderRepeated(_state, action: PayloadAction<{ customerId: string; companyId: string; branchId: string | null; lines: SoLine[] }>) {
      return { ...initialState, ...action.payload, entry: 'repeat' };
    },
    /** Edit before sending: a saved order back into the draft. */
    orderLoaded(_state, action: PayloadAction<Omit<OrderDraftState, 'entry'>>) {
      return { ...action.payload, entry: 'edit' };
    },
    /** Qty typed on an Add items row: adds the line (from `seed`) the first time; '' takes it off. */
    qtyTyped(state, action: PayloadAction<{ seed: SoLine; qty: string }>) {
      const { seed, qty } = action.payload;
      const i = state.lines.findIndex((l) => l.itemId === seed.itemId);
      if (i >= 0) {
        if (qty === '') {
          state.lines.splice(i, 1);
          delete state.offersOn[seed.itemId];
        } else state.lines[i]!.qty = qty;
      } else if (qty !== '') state.lines.push({ ...seed, qty });
    },
    /** Save line on Order item. */
    lineSaved(state, action: PayloadAction<SoLine>) {
      const i = state.lines.findIndex((l) => l.itemId === action.payload.itemId);
      if (i >= 0) state.lines[i] = action.payload;
      else state.lines.push(action.payload);
    },
    lineRemoved(state, action: PayloadAction<string>) {
      state.lines = state.lines.filter((l) => l.itemId !== action.payload);
      delete state.offersOn[action.payload];
    },
    /** The "Offers on this line" switch of Order item. */
    lineOffersSet(state, action: PayloadAction<{ itemId: string; on: boolean }>) {
      if (action.payload.on) delete state.offersOn[action.payload.itemId];
      else state.offersOn[action.payload.itemId] = false;
    },
    /** The "Apply offers" switch of Review. */
    applyOffersSet(state, action: PayloadAction<boolean>) {
      state.applyOffers = action.payload;
    },
    deliveryPicked(state, action: PayloadAction<string>) {
      state.deliveryDate = action.payload;
    },
    prioritySet(state, action: PayloadAction<SoPriority>) {
      state.priority = action.payload;
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

export const {
  visitStarted,
  fixFound,
  contextChosen,
  orderRepeated,
  orderLoaded,
  qtyTyped,
  lineSaved,
  lineRemoved,
  lineOffersSet,
  applyOffersSet,
  deliveryPicked,
  prioritySet,
  remarksTyped,
  orderCleared,
} = orderDraftSlice.actions;
export type { DiscMode };
export default orderDraftSlice.reducer;
