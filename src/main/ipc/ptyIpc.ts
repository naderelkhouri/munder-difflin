import { ipcMain } from 'electron';
import type { PtyManager } from '../pty';

export interface PtyIpcOptions {
  ptyManager: PtyManager;
  onTeardown: (id: string) => void;
}

/**
 * Registers PTY IPC handlers (write, resize, redraw, kill, list).
 */
export function registerPtyIpc(opts: PtyIpcOptions): void {
  const { ptyManager, onTeardown } = opts;

  ipcMain.handle('pty:write', (_evt, id: string, data: string) => {
    if (typeof id !== 'string' || typeof data !== 'string') return { ok: false, error: 'invalid args' };
    return ptyManager.write(id, data);
  });

  ipcMain.handle('pty:resize', (_evt, id: string, cols: number, rows: number) => {
    if (typeof id !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') {
      return { ok: false, error: 'invalid args' };
    }
    return ptyManager.resize(id, cols, rows);
  });

  ipcMain.handle('pty:redraw', (_evt, id: string) => {
    if (typeof id !== 'string') return { ok: false, error: 'invalid id' };
    return ptyManager.redraw(id);
  });

  ipcMain.handle('pty:kill', (_evt, id: string) => {
    if (typeof id !== 'string') return { ok: false, error: 'invalid id' };
    // Kill the process, then run the shared lifecycle teardown (archive the agent,
    // remove its isolated worktree, drop the maps). teardownPty is idempotent, so
    // node-pty firing onExit once the child actually dies is a harmless no-op.
    const res = ptyManager.kill(id);
    onTeardown(id);
    return res;
  });

  ipcMain.handle('pty:list', () => ptyManager.list());
}
