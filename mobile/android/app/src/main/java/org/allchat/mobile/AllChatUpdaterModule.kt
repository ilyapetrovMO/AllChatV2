package org.allchat.mobile

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AllChatUpdaterModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  override fun getName() = "AllChatUpdater"

  override fun getConstants(): Map<String, Any> = mapOf("appVersion" to BuildConfig.VERSION_NAME)

  @ReactMethod
  fun download(url: String, token: String, filename: String, promise: Promise) {
    try {
      val uri = Uri.parse(url)
      if (uri.scheme != "https" && !(BuildConfig.DEBUG && uri.scheme == "http")) {
        promise.reject("invalid_url", "Updates require HTTPS.")
        return
      }
      val safeName = filename.replace(Regex("[^A-Za-z0-9._-]"), "_").take(180)
      val request = DownloadManager.Request(uri)
        .setTitle("AllChat update")
        .setDescription(safeName)
        .setMimeType("application/vnd.android.package-archive")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "AllChat/$safeName")
      request.addRequestHeader("Authorization", "Bearer $token")
      val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      manager.enqueue(request)
      promise.resolve("The update is downloading. Open it from the download notification to install.")
    } catch (error: Exception) {
      promise.reject("update_failed", error.message ?: "Could not download the update.", error)
    }
  }
}
