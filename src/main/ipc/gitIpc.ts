import { ipcMain } from 'electron';
import {
  getBranch, getStatus, getLog, getBranches, getAheadBehind, isRepo, getDiff, mainRepoRoot,
  getLogGraph, getCommitFiles, getFileAtRev, compareRefs, listWorktrees, checkoutRef
} from '../git';
import type { PtyManager } from '../pty';

/**
 * Registers git repository IPC handlers and visual git operations.
 */
export function registerGitIpc(ptyManager: PtyManager): void {
  ipcMain.handle('git:isRepo', (_evt, cwd: unknown) => {
    if (typeof cwd !== 'string') return false;
    return isRepo(cwd);
  });

  // The repo a cwd belongs to, following a linked worktree back to its main
  // checkout — the renderer groups the agent roster by this.
  ipcMain.handle('git:mainRepo', (_evt, cwd: unknown) => {
    if (typeof cwd !== 'string' || !cwd) return null;
    return mainRepoRoot(cwd);
  });

  ipcMain.handle('git:branch', (_evt, cwd: unknown) => {
    if (typeof cwd !== 'string') return { error: 'invalid cwd' };
    return getBranch(cwd);
  });

  ipcMain.handle('git:status', (_evt, cwd: unknown) => {
    if (typeof cwd !== 'string') return { error: 'invalid cwd' };
    return getStatus(cwd);
  });

  ipcMain.handle('git:log', (_evt, cwd: unknown, n: unknown) => {
    if (typeof cwd !== 'string') return { error: 'invalid cwd' };
    const count = typeof n === 'number' ? Math.min(500, Math.max(1, n)) : 50;
    return getLog(cwd, count);
  });

  ipcMain.handle('git:branches', (_evt, cwd: unknown) => {
    if (typeof cwd !== 'string') return { error: 'invalid cwd' };
    return getBranches(cwd);
  });

  ipcMain.handle('git:aheadBehind', (_evt, cwd: unknown) => {
    if (typeof cwd !== 'string') return { error: 'invalid cwd' };
    return getAheadBehind(cwd);
  });

  ipcMain.handle('git:diff', (_evt, cwd: unknown, relPath: unknown) => {
    if (typeof cwd !== 'string' || typeof relPath !== 'string') {
      return { ok: false, error: 'invalid args' };
    }
    return getDiff(cwd, relPath);
  });

  // ─── v0.3.4: history / compare / checkout (git visualization) ───────────────
  ipcMain.handle('git:logGraph', (_evt, cwd: unknown, n: unknown, skip: unknown) => {
    if (typeof cwd !== 'string') return { error: 'invalid args' };
    const count = Math.min(500, Math.max(1, typeof n === 'number' ? n : 200));
    const off = Math.max(0, typeof skip === 'number' ? skip : 0);
    return getLogGraph(cwd, count, off);
  });

  ipcMain.handle('git:commitFiles', (_evt, cwd: unknown, sha: unknown) => {
    if (typeof cwd !== 'string' || typeof sha !== 'string') return { error: 'invalid args' };
    return getCommitFiles(cwd, sha);
  });

  ipcMain.handle('git:showFile', (_evt, cwd: unknown, rev: unknown, relPath: unknown) => {
    if (typeof cwd !== 'string' || typeof rev !== 'string' || typeof relPath !== 'string') {
      return { ok: false, error: 'invalid args' };
    }
    return getFileAtRev(cwd, rev, relPath);
  });

  ipcMain.handle('git:compareRefs', (_evt, cwd: unknown, base: unknown, head: unknown, mode: unknown) => {
    if (typeof cwd !== 'string' || typeof base !== 'string' || typeof head !== 'string') {
      return { error: 'invalid args' };
    }
    return compareRefs(cwd, base, head, mode === 'two' ? 'two' : 'three');
  });

  ipcMain.handle('git:worktrees', (_evt, cwd: unknown) => {
    if (typeof cwd !== 'string') return { error: 'invalid args' };
    return listWorktrees(cwd);
  });

  ipcMain.handle('git:checkout', async (_evt, cwd: unknown, ref: unknown, detach: unknown) => {
    if (typeof cwd !== 'string' || typeof ref !== 'string') return { ok: false, error: 'invalid args' };
    // Guard: never swap files under an actively-working agent. Objective signal
    // owned by main — any live pty whose cwd sits in this tree and emitted output
    // in the last 10s is treated as mid-run. (Idle-but-open terminals are fine:
    // checkoutRef additionally requires a clean tree, and TUIs redraw on fs
    // changes gracefully.)
    const busy = ptyManager.list().find((p) =>
      (p.cwd === cwd || p.cwd.startsWith(cwd.endsWith('/') ? cwd : `${cwd}/`)) &&
      Date.now() - p.lastOutputAt < 10_000
    );
    if (busy) {
      return { ok: false, error: `an agent is actively working in this repo (${busy.id}) — try again when it goes quiet` };
    }
    return checkoutRef(cwd, ref, detach === true);
  });
}
