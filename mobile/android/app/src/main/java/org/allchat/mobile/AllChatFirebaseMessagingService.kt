package org.allchat.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.ActivityManager
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class AllChatFirebaseMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    Log.i(TAG, "FCM registration token refreshed")
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val process = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(process)
    Log.i(TAG, "FCM message received; process_importance=${process.importance}")
    val encrypted = message.data["payload"]
    if (encrypted == null) {
      Log.w(TAG, "FCM message discarded because the encrypted payload is missing")
      return
    }
    val payload = try {
      AllChatPushModule.decryptPayload(encrypted)
    } catch (error: Exception) {
      Log.w(TAG, "FCM message discarded because payload decryption failed: ${error.javaClass.simpleName}")
      return
    }
    val kind = payload.optString("kind", "message")
    if (!PushPresentationPolicy.shouldPost(kind, process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND)) {
      Log.i(TAG, "FCM message suppressed because the app is foregrounded")
      return
    }
    val calls = kind == "call"
    val sound = payload.optBoolean("sound", true)
    val channelID = PushPresentationPolicy.channelID(kind, sound)
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(channelID) == null) {
      val channel = NotificationChannel(channelID, if (calls) "Incoming calls" else "Messages", if (calls) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT)
      if (!sound) channel.setSound(null, null)
      else channel.setSound(RingtoneManager.getDefaultUri(if (calls) RingtoneManager.TYPE_RINGTONE else RingtoneManager.TYPE_NOTIFICATION), AudioAttributes.Builder().setUsage(if (calls) AudioAttributes.USAGE_NOTIFICATION_RINGTONE else AudioAttributes.USAGE_NOTIFICATION).build())
      channel.enableVibration(true)
      manager.createNotificationChannel(channel)
    }
    Log.i(TAG, "Posting notification; kind=$kind channel=$channelID notifications_enabled=${manager.areNotificationsEnabled()}")
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("allchat_instance_url", payload.optString("instance_url"))
      putExtra("allchat_conversation_id", payload.optString("conversation_id"))
      putExtra("allchat_call_id", payload.optString("call_id"))
    }
    val pending = PendingIntent.getActivity(this, payload.optString("conversation_id").hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, channelID)
      .setSmallIcon(R.drawable.ic_stat_allchat)
      .setColor(Color.rgb(88, 101, 242))
      .setContentTitle(payload.optString("title", if (calls) "Incoming call" else "New message"))
      .setContentText(payload.optString("body"))
      .setContentIntent(pending)
      .setAutoCancel(!calls)
      .setCategory(if (calls) NotificationCompat.CATEGORY_CALL else NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setFullScreenIntent(if (calls) pending else null, calls)
      .setSound(if (sound) RingtoneManager.getDefaultUri(if (calls) RingtoneManager.TYPE_RINGTONE else RingtoneManager.TYPE_NOTIFICATION) else null)
      .setTimeoutAfter(if (calls) 30_000L else 0L)
      .build()
    manager.notify(if (calls) payload.optString("call_id").hashCode() else payload.optString("conversation_id").hashCode(), notification)
    Log.i(TAG, "Notification posted; kind=$kind channel=$channelID")
  }

  companion object {
    private const val TAG = "AllChatPush"
  }
}
