import type { PtyManager } from '../pty';
import { registerFsIpc } from './fsIpc';
import { registerGitIpc } from './gitIpc';
import { registerAppIpc } from './appIpc';
import { registerIntegrationsIpc } from './integrationsIpc';

export { registerFsIpc } from './fsIpc';
export { registerGitIpc } from './gitIpc';
export { registerAppIpc } from './appIpc';
export { registerIntegrationsIpc } from './integrationsIpc';

export interface IpcRegistrationContext {
  ptyManager: PtyManager;
}

/**
 * Registers all modular IPC handlers.
 */
export function registerModularIpc(ctx: IpcRegistrationContext): void {
  registerFsIpc();
  registerGitIpc(ctx.ptyManager);
  registerAppIpc();
  registerIntegrationsIpc();
}
