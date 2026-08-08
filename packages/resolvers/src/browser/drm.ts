/**
 * DRM detection.
 *
 * Hooking `navigator.requestMediaKeySystemAccess` in an init script is the most
 * reliable detector available: it fires regardless of manifest format, before
 * any manifest has even been parsed, and it cannot be hidden by an obfuscated
 * player. See analysis §3.
 *
 * The hook OBSERVES. It never blocks the call, never touches a licence server
 * and never extracts a key — detecting DRM is where this project stops.
 */

import { AppError } from "@downloader/shared";
import type { DrmInfo, DrmSystem } from "@downloader/shared";

/** Playwright binding the page calls to report a key system in real time. */
export const DRM_BINDING_NAME = "__downloaderReportDrm";

/**
 * Mirror of the same information on `window`, read back at the end of the probe.
 * Belt and braces: a page that runs EME inside a frame Playwright tore down
 * early would otherwise slip through.
 */
export const DRM_WINDOW_KEY = "__downloaderDrmKeySystems";

/**
 * Page-side source. Written as a string on purpose: this package compiles
 * without the DOM lib (it is Node code), so browser globals cannot be typed
 * here, and a stringly-typed script is honest about which side it runs on.
 */
export function drmInitScript(
  bindingName: string = DRM_BINDING_NAME,
  windowKey: string = DRM_WINDOW_KEY,
): string {
  const binding = JSON.stringify(bindingName);
  const key = JSON.stringify(windowKey);
  return `(() => {
  var seen = [];
  try {
    Object.defineProperty(window, ${key}, {
      value: seen, writable: false, enumerable: false, configurable: false,
    });
  } catch {}
  var nav = window.navigator;
  if (!nav || typeof nav.requestMediaKeySystemAccess !== "function") return;
  var original = nav.requestMediaKeySystemAccess.bind(nav);
  var report = function (keySystem) {
    try { seen.push(String(keySystem)); } catch {}
    try {
      var binding = window[${binding}];
      if (typeof binding === "function") binding(String(keySystem));
    } catch {}
  };
  var wrapped = function (keySystem, configurations) {
    report(keySystem);
    // Observe only. Blocking here would change the behaviour we are measuring
    // and could suppress the very manifest requests we came to capture.
    return original(keySystem, configurations);
  };
  try {
    Object.defineProperty(wrapped, "name", { value: "requestMediaKeySystemAccess" });
    Object.defineProperty(wrapped, "toString", {
      value: function () { return "function requestMediaKeySystemAccess() { [native code] }"; },
    });
  } catch {}
  try {
    nav.requestMediaKeySystemAccess = wrapped;
  } catch {
    try { Object.defineProperty(nav, "requestMediaKeySystemAccess", { value: wrapped }); } catch {}
  }
})();`;
}

/**
 * EME key system string → the taxonomy in `@downloader/shared`.
 *
 * Everything this detector sees is by construction an EME licence exchange —
 * `requestMediaKeySystemAccess` *is* the EME entry point — so ClearKey observed
 * here stays protected, unlike the fetchable-key-URI case the HLS parser lets
 * through. Same key system, different acquisition path, different verdict.
 */
export function toDrmSystem(keySystem: string): DrmSystem {
  const value = keySystem.toLowerCase();
  if (value.includes("widevine")) return "widevine";
  if (value.includes("playready")) return "playready";
  // FairPlay appears as com.apple.fps, com.apple.fps.1_0, com.apple.fairplay…
  if (value.includes("com.apple.fps") || value.includes("fairplay")) return "fairplay";
  if (value.includes("clearkey")) return "clearkey";
  return "unknown";
}

/** Accumulates key systems reported by the init script across all frames. */
export class DrmObserver {
  readonly #keySystems = new Set<string>();

  record(keySystem: unknown): void {
    if (typeof keySystem === "string" && keySystem.length > 0 && keySystem.length < 200) {
      this.#keySystems.add(keySystem);
    }
  }

  recordAll(keySystems: readonly unknown[]): void {
    for (const keySystem of keySystems) this.record(keySystem);
  }

  get detected(): boolean {
    return this.#keySystems.size > 0;
  }

  get keySystems(): string[] {
    return [...this.#keySystems];
  }

  get systems(): DrmSystem[] {
    return [...new Set(this.keySystems.map(toDrmSystem))];
  }

  toDrmInfo(): DrmInfo {
    if (!this.detected) return { protected: false, systems: [] };
    return {
      protected: true,
      systems: this.systems,
      evidence: `EME navigator.requestMediaKeySystemAccess(${this.keySystems.map((k) => `"${k}"`).join(", ")})`,
    };
  }

  /**
   * Every EME key system is terminal, ClearKey included: it still negotiates
   * keys through a licence exchange this project deliberately does not
   * implement, so "found it, stopping" is the only honest answer.
   */
  toError(): AppError {
    const info = this.toDrmInfo();
    return new AppError("DRM_PROTECTED", undefined, {
      details: { systems: info.systems, keySystems: this.keySystems, evidence: info.evidence },
    });
  }
}

/** Page-side expression that reads the mirrored key-system list back out. */
export function drmReadbackScript(windowKey: string = DRM_WINDOW_KEY): string {
  return `(() => {
  try {
    var seen = window[${JSON.stringify(windowKey)}];
    return Array.isArray(seen) ? seen.map(String) : [];
  } catch { return []; }
})()`;
}
