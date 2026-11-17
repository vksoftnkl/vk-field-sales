import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';

import orderDraft from '@/features/orders/order-draft';
import receiptDraft from '@/features/receipts/receipt-draft';
import saleDraft from '@/features/sales/sale-draft';

import session from './sessionSlice';

/**
 * Redux holds the login session and the order, bill and receipt being taken (until Save writes
 * them to SQLite). Everything else is read straight from SQLite.
 */
export const store = configureStore({
  reducer: { session, orderDraft, saleDraft, receiptDraft },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
