import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';

import session from './sessionSlice';
import sync from './syncSlice';

/**
 * Redux holds session + UI state only. Business data (customers, items, orders)
 * is read straight from SQLite with Drizzle live queries — no copying into Redux.
 */
export const store = configureStore({
  reducer: { session, sync },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
