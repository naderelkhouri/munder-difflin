import { ipcMain } from 'electron';
import type { RosterStore } from '../roster';

/**
 * Registers roster mirror IPC handlers (readSync, read, write).
 */
export function registerRosterIpc(roster: RosterStore): void {
  // The renderer's store is built synchronously at module load, before any async
  // IPC could resolve, so the read is `ipcMain.on` + `returnValue` — one blocking
  // round trip at boot, in exchange for the roster being correct on first paint
  // instead of flashing an empty floor and then filling in.
  ipcMain.on('roster:readSync', (evt) => { evt.returnValue = roster.read(); });
  ipcMain.handle('roster:read', () => roster.read());
  ipcMain.handle('roster:write', (_evt, snap: unknown) => roster.write(snap));
}
