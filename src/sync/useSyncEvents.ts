import { useEffect } from 'react';

import { revalidateSession } from '@/auth/auth-service';
import { useAppDispatch } from '@/store';
import { syncFinished, syncStarted } from '@/store/syncSlice';

import { onSyncEvent } from './engine';

/**
 * Mounted once at the root (sync can run from the login screen too).
 * Mirrors engine events into Redux and, after each sync, re-checks the signed-in
 * salesman and the device status. It never starts a sync by itself.
 */
export function useSyncEvents(): void {
  const dispatch = useAppDispatch();

  useEffect(
    () =>
      onSyncEvent((e) => {
        if (e.type === 'start') {
          dispatch(syncStarted());
          return;
        }
        dispatch(syncFinished(e.report));
        void revalidateSession();
      }),
    [dispatch],
  );
}
