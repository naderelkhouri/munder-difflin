import { ipcMain, shell } from 'electron';
import { listDir, readFileText, readFileBinary, writeFileText, statAbs } from '../fs';

/**
 * Registers filesystem IPC handlers, sandboxed to a repository root.
 */
export function registerFsIpc(): void {
  ipcMain.handle('fs:listDir', (_evt, root: unknown, rel: unknown) => {
    if (typeof root !== 'string' || typeof rel !== 'string') return { ok: false, error: 'invalid args' };
    return listDir(root, rel);
  });

  ipcMain.handle('fs:readFile', (_evt, root: unknown, rel: unknown) => {
    if (typeof root !== 'string' || typeof rel !== 'string') return { ok: false, error: 'invalid args' };
    return readFileText(root, rel);
  });

  // Raw bytes for files the text reader refuses (images). The renderer cannot
  // load them off disk itself — the CSP has no `file:` source and no file
  // protocol is registered — so the bytes come through here and become a `blob:`
  // URL on the other side. Same root confinement as every other fs handler.
  ipcMain.handle('fs:readBinary', (_evt, root: unknown, rel: unknown) => {
    if (typeof root !== 'string' || typeof rel !== 'string') return { ok: false, error: 'invalid args' };
    return readFileBinary(root, rel);
  });

  ipcMain.handle('fs:writeFile', (_evt, root: unknown, rel: unknown, content: unknown) => {
    if (typeof root !== 'string' || typeof rel !== 'string' || typeof content !== 'string') {
      return { ok: false, error: 'invalid args' };
    }
    return writeFileText(root, rel, content);
  });

  // v0.3.4: existence check for the terminal ⌘-click markdown flow (metadata only).
  ipcMain.handle('fs:statAbs', (_evt, p: unknown) => {
    if (typeof p !== 'string' || p.length > 4096 || p.includes('\0')) {
      return { exists: false, isFile: false, path: '' };
    }
    return statAbs(p);
  });

  /** Reveal a path in the OS file browser — Finder, Explorer, or whatever the
   *  Linux desktop registers. Backs ⌘-click on a terminal path we cannot open
   *  ourselves (an image, an archive, an unknown extension).
   *
   *  `showItemInFolder`, NEVER `shell.openPath`, for a file. The path arrives
   *  from agent output, and openPath hands an arbitrary file to its default
   *  application: a printed `installer.dmg` or `.desktop` would be one click from
   *  executing. Revealing only ever opens a file browser, so the worst an agent
   *  can achieve by printing a path is a window at a folder the user could
   *  already open themselves.
   *
   *  openPath IS used for a directory, and only after statAbs has confirmed it is
   *  one — a directory has no default application to launch, so the execution
   *  argument above does not apply, and revealing a folder inside its parent is
   *  not what "open this folder" means to anyone. */
  ipcMain.handle('fs:revealPath', async (_evt, p: unknown) => {
    if (typeof p !== 'string' || !p.length || p.length > 4096 || p.includes('\0')) {
      return { ok: false, error: 'bad request' };
    }
    const st = await statAbs(p);
    if (!st.exists) return { ok: false, error: 'not found' };
    if (st.isFile) { shell.showItemInFolder(st.path); return { ok: true }; }
    const err = await shell.openPath(st.path);
    return err ? { ok: false, error: err } : { ok: true };
  });
}
