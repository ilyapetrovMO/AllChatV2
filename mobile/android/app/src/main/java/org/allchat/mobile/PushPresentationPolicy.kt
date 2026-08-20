package org.allchat.mobile

internal object PushPresentationPolicy {
  fun shouldPost(kind: String, appForegrounded: Boolean): Boolean = kind == "call" || !appForegrounded

  fun channelID(kind: String, sound: Boolean): String {
    val base = if (kind == "call") "allchat_incoming_calls_v2" else "allchat_messages"
    return base + if (sound) "" else "_silent"
  }
}
