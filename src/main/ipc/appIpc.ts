import { ipcMain, clipboard, BrowserWindow, dialog } from 'electron';
import { spawn } from 'node:child_process';
import { resolveSessionCwd } from '../transcript';

/**
 * Registers application-level IPC handlers (clipboard, folder dialog, native terminal launch, session cwd resolution).
 */
export function registerAppIpc(): void {
  // Resolve a pasted Claude session id to the cwd it originally ran in, so the Add
  // Agent dialog can auto-fill the folder for a resume (#2 zero-step resume). Reads
  // the cwd from a transcript record; null when the id is invalid/unknown.
  ipcMain.handle('session:resolveCwd', (_evt, sessionId: unknown) =>
    (typeof sessionId === 'string' ? resolveSessionCwd(sessionId) : null));

  // ─── IPC: clipboard ─────────────────────────────────────────────────────────
  ipcMain.handle('app:copyToClipboard', (_evt, text: unknown) => {
    if (typeof text !== 'string') return { ok: false, error: 'invalid text' };
    try { clipboard.writeText(text); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('app:readClipboard', () => {
    try { return clipboard.readText(); } catch { return ''; }
  });

  // Same read, SYNCHRONOUS, for the terminal's paste shortcut.
  // Dictation tools (muesli.works, Wispr Flow, …) type by stashing the user's
  // clipboard, writing the transcript, sending the paste key, then restoring the
  // old clipboard immediately. An `invoke` read returns a tick or two later — by
  // which point the restore has already landed and we paste the PREVIOUS text.
  // A `sendSync` read completes inside the keydown handler, before the tool gets
  // a chance to put the old contents back.
  ipcMain.on('app:readClipboardSync', (evt) => {
    try { evt.returnValue = clipboard.readText(); } catch { evt.returnValue = ''; }
  });

  // ─── IPC: folder picker ─────────────────────────────────────────────────────
  ipcMain.handle('dialog:chooseFolder', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) return { ok: false as const, error: 'no window' };
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Pick a folder'
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false as const, error: 'cancelled' };
    return { ok: true as const, path: res.filePaths[0] };
  });

  // ─── IPC: Terminal.app at a folder ──────────────────────────────────────────
  ipcMain.handle('terminal:openAtFolder', async (_evt, cwd: unknown) => {
    if (typeof cwd !== 'string' || cwd.length === 0) return { ok: false, error: 'invalid cwd' };
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const p = spawn('open', ['-a', 'Terminal', cwd]);
      let err = '';
      p.stderr.on('data', (d) => { err += d.toString(); });
      p.on('error', (e) => resolve({ ok: false, error: e.message }));
      p.on('close', (code) => {
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: err.trim() || `open exited ${code}` });
      });
    });
  });
}
