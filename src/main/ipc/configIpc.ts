import { ipcMain, app } from 'electron';
import { resolve, join, sep } from 'node:path';
import { existsSync, cpSync } from 'node:fs';
import { readConfig, writeConfig, ensureHarnessHome, setAgentTokenCap, type HarnessConfig } from '../config';
import { expandTilde } from '../fs';
import { analytics } from '../analytics';
import type { PtyManager } from '../pty';

export interface ConfigIpcServices {
  hive: {
    enabled: () => boolean;
    setOrchestratorMaySpawn: (allowed: boolean) => void;
  };
  ptyManager: PtyManager;
  bootstrapHiveServices: () => void;
  teardownForChangeHome: () => void;
  recoverAfterMoveFailure: () => void;
  setAllowQuit: (allow: boolean) => void;
  trackOnboardingCompleted?: (wasOnboarded: boolean, next: HarnessConfig) => void;
}

/**
 * Registers configuration and harness-home lifecycle IPC handlers.
 */
export function registerConfigIpc(services: ConfigIpcServices): void {
  ipcMain.handle('config:get', (): HarnessConfig => readConfig());

  ipcMain.handle('config:update', (_evt, patch: Partial<HarnessConfig>) => {
    // FIRST RUN: every hive-bound service is started by bootstrapHiveServices(),
    // which runs once at app-ready and early-returns on `!hive.enabled()` — i.e.
    // whenever harnessHome is still null, which is exactly the state a fresh
    // install boots in. Onboarding then sets harnessHome through THIS handler and
    // nothing re-bootstrapped, so the hook server, message router, telemetry
    // collector and mission scheduler all stayed dead for the rest of the session.
    //
    // Symptom: agents spawn and run (the PTY is not hive-bound), but no hook ever
    // reaches the app — no `hooks.sock` on disk, so no SessionStart, which means
    // recordSession() is never called and "Restart & Continue" fails with "No
    // recorded session ID"; the cards also sit on "ctx no status tick yet" and 0
    // tool calls. Everything healed on the next app launch, which is what hid it.
    //
    // changeHome() has always handled this by relaunching; onboarding does not
    // relaunch, so bootstrap here on the null → set transition. Gated on the
    // transition so ordinary config writes never re-enter it.
    const hiveWasEnabled = services.hive.enabled();
    const wasOnboarded = readConfig().onboardingComplete;
    const next = writeConfig(patch);
    // Live opt-in/out from Settings → Privacy (TELEMETRY.md).
    if (typeof patch?.telemetryEnabled === 'boolean') analytics.setEnabled(patch.telemetryEnabled);
    // Activation funnel (v0.4.6): onboarding just finished (false → true) — the top of
    // the launch → first-agent funnel. `provider` is the engine chosen in the wizard.
    // Fired here (main), not in the renderer, so it rides the same allowlist as the rest.
    if (services.trackOnboardingCompleted) {
      services.trackOnboardingCompleted(wasOnboarded, next);
    } else if (!wasOnboarded && next.onboardingComplete) {
      analytics.track('onboarding_completed', { provider: next.godProvider ?? 'claude' });
    }
    // Keep the hive's mirror of the spawn gate current. The queue itself reads
    // config per tick so it gates immediately; this is for the PROMPT, which is
    // built per spawn, so flipping the toggle reaches god the next time he starts.
    if (typeof patch?.orchestratorMaySpawn === 'boolean') {
      services.hive.setOrchestratorMaySpawn(patch.orchestratorMaySpawn);
    }
    if (!hiveWasEnabled && services.hive.enabled()) {
      console.log('[hive] harnessHome configured — bootstrapping hive services');
      try {
        services.bootstrapHiveServices();
      } catch (e) {
        console.error('[hive] bootstrap after onboarding:', e);
      }
    }
    return next;
  });

  ipcMain.handle('config:setAgentTokenCap', (_evt, agentId: unknown, tokenCap: unknown) =>
    setAgentTokenCap(agentId, tokenCap)
  );

  ipcMain.handle('config:ensureHome', (_evt, path: unknown) => {
    if (typeof path !== 'string' || path.length === 0) return { ok: false, error: 'invalid path' };
    return ensureHarnessHome(path);
  });

  // Change the harnessHome folder. Because every derived path (hive root, palace,
  // sock, agent dirs) resolves lazily through getHome(), the only real work is
  // optionally MOVING the existing hive + palace and relaunching so every service
  // re-binds against the new root. mode: 'move' copies the data (old kept as a
  // safety net), 'fresh' just re-points and bootstraps an empty home.
  ipcMain.handle('config:changeHome', async (_evt, payload: unknown) => {
    const p = (payload ?? {}) as { newHome?: unknown; mode?: unknown };
    if (typeof p.newHome !== 'string' || !p.newHome) return { ok: false, error: 'invalid newHome' };
    const mode: 'move' | 'fresh' = p.mode === 'fresh' ? 'fresh' : 'move';
    // expandTilde BEFORE resolve: both UI callers feed a folder-dialog result
    // (always absolute), but the hive picker's recents list can serve a literal
    // "~/…" persisted by a pre-#140 build — resolve() would anchor that at cwd
    // and the app would relaunch against a real directory named "~". Same
    // defence-in-depth-at-the-consumer rule as expandTilde's own doc.
    const newHome = resolve(expandTilde(p.newHome));
    const oldRaw = readConfig().harnessHome;
    const oldHome = oldRaw ? resolve(oldRaw) : null;

    // Guard against same-folder / nested-folder (a move would self-copy forever).
    if (oldHome) {
      if (newHome === oldHome) return { ok: false, error: 'That is already the current home folder.' };
      const a = newHome + sep, b = oldHome + sep;
      if (a.startsWith(b) || b.startsWith(a)) {
        return { ok: false, error: 'Pick a folder that is not inside (or a parent of) the current home.' };
      }
    }

    const ensured = ensureHarnessHome(newHome);
    if (!ensured.ok) return ensured;

    // Tear down everything bound to the OLD root before copying, so nothing writes
    // mid-copy — a live git commit into hive/.git would otherwise be copied as a
    // half-written object and corrupt the moved repo.
    services.teardownForChangeHome();

    if (mode === 'move' && oldHome) {
      try {
        // roster.json + its backups ride along with hive/palace: the roster is the
        // renderer's half of the same state, and leaving it behind would move the
        // agents' sessions and memory to the new home while their names, notes and
        // worktree paths stayed at the old one.
        for (const sub of ['hive', 'palace', 'roster.json', 'roster-backups']) {
          const src = join(oldHome, sub);
          if (!existsSync(src)) continue;
          // cpSync copies the whole tree incl. .git and is cross-device safe (unlike
          // renameSync, which throws EXDEV across volumes). We COPY, never delete —
          // the old folder stays as a safety net the user removes manually.
          cpSync(src, join(newHome, sub), { recursive: true, force: true, dereference: false });
        }
      } catch (e) {
        // Copy failed: recover IN PLACE against the unchanged old home (config never
        // repointed) so the user loses nothing, and surface the error — no relaunch.
        services.recoverAfterMoveFailure();
        return { ok: false, error: `Could not copy data: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // Repoint config and relaunch so every service re-bootstraps against newHome.
    // (Identical recovery path to resetAll — relaunch is the clean re-bind.)
    services.setAllowQuit(true);
    writeConfig({ harnessHome: newHome });
    try { services.ptyManager.killAll(); } catch (e) { console.error('[changeHome] killAll:', e); }
    app.relaunch();
    app.exit(0);
    return { ok: true as const }; // unreachable (process exits) — typed for the renderer
  });

  ipcMain.on('config:homeSync', (evt) => {
    evt.returnValue = readConfig().harnessHome ?? null;
  });
}
