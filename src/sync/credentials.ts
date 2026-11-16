import type { ServerCredentials } from './vk-nex-api';

/**
 * The VK Nex user Sync signs in as. Set when the salesman logs in on the phone (the same login
 * name and password), or typed on the Sync page if VK Nex refuses those. Kept in memory only:
 * never written to the phone, and gone on Log out or when the app closes.
 */
let current: ServerCredentials | null = null;

export const getServerCredentials = (): ServerCredentials | null => current;
export const setServerCredentials = (c: ServerCredentials | null): void => {
  current = c;
};
