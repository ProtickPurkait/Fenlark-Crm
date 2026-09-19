package llp.fenlark.trace;

import android.Manifest;
import android.content.Context;
import android.os.Build;
import android.os.SystemClock;
import android.telephony.PhoneStateListener;
import android.telephony.TelephonyCallback;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Bridges the CRM to Android's real telephony call state, so a call's
 * duration comes from the OS reporting the call actually ended — not from a
 * telecaller typing a number, and not from guessing at how long the app was
 * in the background while the native dialer had focus (the web-only
 * fallback this replaces; see use-call-session.ts).
 *
 * NOT MEASURED HERE: the moment the far end actually answers. Getting that
 * needs PRECISE_CALL_STATE, which is restricted to apps holding carrier
 * privileges or the default-dialer role — this plugin holds neither. What it
 * reports is OFFHOOK (the OS begins placing the call) through IDLE (the call
 * is over), which still includes ring time. What it *does* guarantee, which
 * the web estimate could not: the boundary comes from the OS, not from page
 * visibility, and nothing the telecaller does in the CRM can change it.
 *
 * Scoped to one call at a time by design, matching call_sessions' own
 * constraint (one open session per caller) — this plugin does not try to
 * identify *which* lead a call belongs to, only when the device's current
 * call started and ended. The JS side is responsible for correlating that
 * with whichever call_sessions row is currently open.
 */
@CapacitorPlugin(
    name = "CallTracker",
    permissions = { @Permission(alias = "phoneState", strings = { Manifest.permission.READ_PHONE_STATE }) }
)
public class CallTrackerPlugin extends Plugin {

    private TelephonyManager telephonyManager;
    private TelephonyCallback telephonyCallback; // API 31+
    private PhoneStateListener phoneStateListener; // API < 31
    private boolean listening = false;

    // Set the instant the OS call state first becomes OFFHOOK; null when idle.
    // elapsedRealtime(), not currentTimeMillis(): a duration measured this way
    // cannot be thrown off by the device's clock changing mid-call (timezone,
    // NTP sync, manual adjustment), which currentTimeMillis() is exposed to.
    private Long offHookSinceElapsedRealtime = null;
    private int lastState = TelephonyManager.CALL_STATE_IDLE;

    @Override
    public void load() {
        telephonyManager = (TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (getPermissionState("phoneState") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("READ_PHONE_STATE not granted; call requestPermissions() first.");
            return;
        }
        if (telephonyManager == null) {
            call.reject("TelephonyManager unavailable on this device.");
            return;
        }
        if (!listening) {
            registerCallback();
            listening = true;
        }
        JSObject ret = new JSObject();
        ret.put("listening", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        unregisterCallback();
        listening = false;
        offHookSinceElapsedRealtime = null;
        lastState = TelephonyManager.CALL_STATE_IDLE;
        call.resolve();
    }

    @PermissionCallback
    private void phoneStatePermsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put(
            "phoneState",
            getPermissionState("phoneState") == com.getcapacitor.PermissionState.GRANTED ? "granted" : "denied"
        );
        call.resolve(ret);
    }

    @PluginMethod
    public void requestCallStatePermission(PluginCall call) {
        if (getPermissionState("phoneState") == com.getcapacitor.PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("phoneState", "granted");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("phoneState", call, "phoneStatePermsCallback");
    }

    // A named class, not an anonymous one: an anonymous class can extend one
    // class OR implement one interface, never both in the same expression,
    // and TelephonyCallback.CallStateListener requires exactly that (extend
    // TelephonyCallback, implement its nested CallStateListener interface).
    private final class CallStateCallback extends TelephonyCallback implements TelephonyCallback.CallStateListener {
        @Override
        public void onCallStateChanged(int state) {
            handleStateChange(state);
        }
    }

    private void registerCallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            telephonyCallback = new CallStateCallback();
            telephonyManager.registerTelephonyCallback(
                ContextCompat.getMainExecutor(getContext()),
                telephonyCallback
            );
        } else {
            phoneStateListener = new PhoneStateListener() {
                @Override
                public void onCallStateChanged(int state, String phoneNumber) {
                    handleStateChange(state);
                }
            };
            telephonyManager.listen(phoneStateListener, PhoneStateListener.LISTEN_CALL_STATE);
        }
    }

    private void unregisterCallback() {
        if (telephonyManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && telephonyCallback != null) {
            telephonyManager.unregisterTelephonyCallback(telephonyCallback);
            telephonyCallback = null;
        } else if (phoneStateListener != null) {
            telephonyManager.listen(phoneStateListener, PhoneStateListener.LISTEN_NONE);
            phoneStateListener = null;
        }
    }

    // Called on the main thread by both codepaths above.
    private void handleStateChange(int state) {
        if (state == lastState) return; // duplicate callbacks happen; ignore no-ops

        boolean wasIdle = lastState == TelephonyManager.CALL_STATE_IDLE;
        boolean nowOffHook = state == TelephonyManager.CALL_STATE_OFFHOOK;
        boolean nowIdle = state == TelephonyManager.CALL_STATE_IDLE;

        if (wasIdle && nowOffHook) {
            offHookSinceElapsedRealtime = SystemClock.elapsedRealtime();
            JSObject data = new JSObject();
            data.put("state", "offhook");
            notifyListeners("callStateChanged", data);
        } else if (!wasIdle && nowIdle) {
            long durationSeconds = 0;
            if (offHookSinceElapsedRealtime != null) {
                durationSeconds = Math.max(
                    0,
                    (SystemClock.elapsedRealtime() - offHookSinceElapsedRealtime) / 1000
                );
            }
            offHookSinceElapsedRealtime = null;

            JSObject data = new JSObject();
            data.put("state", "idle");
            data.put("durationSeconds", durationSeconds);
            notifyListeners("callEnded", data);
        }
        // RINGING is deliberately not surfaced: for the outgoing calls this app
        // places, RINGING never fires — OFFHOOK covers dialing through to
        // either answer or hangup — so there is nothing distinct to report.

        lastState = state;
    }

    @Override
    protected void handleOnDestroy() {
        unregisterCallback();
        super.handleOnDestroy();
    }
}
