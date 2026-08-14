package org.allchat.mobile

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AllChatMediaSaverModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  override fun getName() = "AllChatMediaSaver"

  @ReactMethod
  fun save(url: String, token: String, filename: String, mimeType: String, promise: Promise) {
    try {
      val uri = Uri.parse(url)
      if (uri.scheme != "https" && uri.scheme != "http") {
        promise.reject("invalid_url", "Only HTTP media can be saved.")
        return
      }
      val safeName = sanitizeFilename(filename)
      val request = DownloadManager.Request(uri)
        .setTitle(safeName)
        .setDescription("Downloaded from AllChat")
        .setMimeType(mimeType.ifBlank { "application/octet-stream" })
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(true)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "AllChat/$safeName")
      if (token.isNotBlank()) request.addRequestHeader("Authorization", "Bearer $token")
      val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      manager.enqueue(request)
      promise.resolve("download")
    } catch (error: Exception) {
      promise.reject("save_failed", error.message ?: "Could not save media.", error)
    }
  }

  private fun sanitizeFilename(value: String): String {
    val cleaned = value
      .substringAfterLast('/')
      .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
      .take(180)
    return cleaned.ifBlank { "allchat-media" }
  }
}
