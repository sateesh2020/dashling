package dev.dashling.panel;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Wakes the screen when power is connected.
 *
 * Many phones (and phones with a broken power button) don't turn the screen on when you plug in a charger, and the panel
 * turns the screen off on battery to save power. Android doesn't deliver "power connected" to an app that isn't running,
 * so this tiny foreground service stays alive (with a minimal, silent notification) and wakes the screen for a moment;
 * the panel, still on top, then shows over the lock screen and keeps the screen on while charging.
 */
public class PowerWakeService extends Service {
    private static final String CHANNEL = "dashling_power";

    private final BroadcastReceiver rx = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_POWER_CONNECTED.equals(i.getAction())) wake();
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        startForeground(1, notification());
        registerReceiver(rx, new IntentFilter(Intent.ACTION_POWER_CONNECTED));
    }

    private Notification notification() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Wake screen on power", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_MIN);
        }
        return b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Dashling")
                .setContentText("Wakes the screen when power is connected").setOngoing(true).build();
    }

    @SuppressWarnings("deprecation")   // the only wake-lock type that can turn the screen on from a service
    private void wake() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP
                | PowerManager.ON_AFTER_RELEASE, "dashling:power");
        wl.acquire(5000);              // released by itself; MainActivity then holds the screen on while charging
    }

    @Override public int onStartCommand(Intent i, int flags, int startId) { return START_STICKY; }
    @Override public IBinder onBind(Intent i) { return null; }
    @Override public void onDestroy() {
        try { unregisterReceiver(rx); } catch (IllegalArgumentException ignored) { }
        super.onDestroy();
    }
}
