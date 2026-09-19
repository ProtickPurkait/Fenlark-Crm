import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";

/**
 * JS-side bridge to CallTrackerPlugin (android/app/src/main/java/llp/fenlark/
 * trace/CallTrackerPlugin.java). Only meaningful inside the native Android
 * shell — on the plain web PWA there is nothing on the other end of this
 * registration, so every method here must only be called after checking
 * isNativeCallTrackerAvailable().
 */

export interface CallEndedEvent {
  state: "idle";
  /** Seconds from the OS reporting the call as OFFHOOK to it reporting IDLE.
   *  Includes ring time — see the plugin's own doc comment for why that
   *  boundary, not "answered", is what's achievable without carrier
   *  privileges or the default-dialer role. */
  durationSeconds: number;
}

export interface CallStateChangedEvent {
  state: "offhook";
}

export type PhoneStatePermission = "granted" | "denied" | "prompt" | "prompt-with-rationale";

interface CallTrackerPlugin {
  startListening(): Promise<{ listening: boolean }>;
  stopListening(): Promise<void>;
  requestCallStatePermission(): Promise<{ phoneState: PhoneStatePermission }>;
  addListener(
    eventName: "callEnded",
    listenerFunc: (event: CallEndedEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "callStateChanged",
    listenerFunc: (event: CallStateChangedEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const CallTracker = registerPlugin<CallTrackerPlugin>("CallTracker");

/** True only inside the native Android shell — never in a browser, even one
 *  running the installed PWA (that has no native plugin bridge at all). */
export function isNativeCallTrackerAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}
