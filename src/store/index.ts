import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';

import orderDraft from '@/features/orders/order-draft';

import session from './sessionSlice';

/**
 * Redux holds the login session and the order being taken (until Save order writes it to
 * SQLite). Everything else is read straight from SQLite.
 */
export const store = configureStore({
  reducer: { session, orderDraft },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
