import type { PtyManager } from '../pty';
import type { RosterStore } from '../roster';
import { registerFsIpc } from './fsIpc';
import { registerGitIpc } from './gitIpc';
import { registerAppIpc } from './appIpc';
import { registerIntegrationsIpc } from './integrationsIpc';
import { registerRosterIpc } from './rosterIpc';
import { registerPtyIpc } from './ptyIpc';
import { registerConfigIpc, type ConfigIpcServices } from './configIpc';

export { registerFsIpc } from './fsIpc';
export { registerGitIpc } from './gitIpc';
export { registerAppIpc } from './appIpc';
export { registerIntegrationsIpc } from './integrationsIpc';
export { registerRosterIpc } from './rosterIpc';
export { registerPtyIpc } from './ptyIpc';
export { registerConfigIpc, type ConfigIpcServices } from './configIpc';

export interface IpcRegistrationContext {
  ptyManager: PtyManager;
  roster?: RosterStore;
  onTeardownPty?: (id: string) => void;
  configServices?: ConfigIpcServices;
}

/**
 * Registers all modular IPC handlers.
 */
export function registerModularIpc(ctx: IpcRegistrationContext): void {
  registerFsIpc();
  registerGitIpc(ctx.ptyManager);
  registerAppIpc();
  registerIntegrationsIpc();

  if (ctx.roster) {
    registerRosterIpc(ctx.roster);
  }

  if (ctx.onTeardownPty) {
    registerPtyIpc({
      ptyManager: ctx.ptyManager,
      onTeardown: ctx.onTeardownPty
    });
  }

  if (ctx.configServices) {
    registerConfigIpc(ctx.configServices);
  }
}

