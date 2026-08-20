package org.allchat.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Base64
import java.io.File
import java.net.URI
import java.security.MessageDigest

internal object PushAvatarCache {
  private const val MAX_SOURCE_BYTES = 8 * 1024 * 1024
  private const val MAX_FILES = 128
  private const val SIZE = 192

  fun identity(avatarURL: String): String? {
    val uri = runCatching { URI(avatarURL) }.getOrNull() ?: return null
    val memberID = Regex("/api/v1/members/([^/]+)/avatar").find(uri.path.orEmpty())?.groupValues?.get(1) ?: return null
    if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrBlank()) return null
    val port = if (uri.port >= 0) ":${uri.port}" else ""
    return "${uri.scheme}://${uri.host}$port|$memberID"
  }

  fun put(context: Context, avatarURL: String, avatarVersion: String, dataURI: String) {
    val identity = identity(avatarURL)?.let { versionedIdentity(it, avatarVersion) } ?: return
    val encoded = dataURI.substringAfter(";base64,", "")
    if (encoded.isBlank() || encoded.length > MAX_SOURCE_BYTES * 2) return
    val bytes = runCatching { Base64.decode(encoded, Base64.DEFAULT) }.getOrNull() ?: return
    if (bytes.isEmpty() || bytes.size > MAX_SOURCE_BYTES) return
    val source = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
    val side = minOf(source.width, source.height)
    val square = Bitmap.createBitmap(source, (source.width - side) / 2, (source.height - side) / 2, side, side)
    val thumbnail = Bitmap.createScaledBitmap(square, SIZE, SIZE, true)
    val directory = directory(context)
    directory.mkdirs()
    val destination = File(directory, filename(identity))
    val temporary = File(directory, "${destination.name}.tmp")
    temporary.outputStream().use { thumbnail.compress(Bitmap.CompressFormat.PNG, 90, it) }
    temporary.renameTo(destination)
    destination.setLastModified(System.currentTimeMillis())
    if (square !== source) square.recycle()
    if (thumbnail !== square) thumbnail.recycle()
    source.recycle()
    prune(directory)
  }

  fun get(context: Context, instanceURL: String, memberID: String, avatarVersion: String): Bitmap? {
    if (instanceURL.isBlank() || memberID.isBlank()) return null
    val uri = runCatching { URI(instanceURL) }.getOrNull() ?: return null
    val port = if (uri.port >= 0) ":${uri.port}" else ""
    val identity = versionedIdentity("${uri.scheme}://${uri.host}$port|$memberID", avatarVersion)
    val file = File(directory(context), filename(identity))
    if (!file.isFile) return null
    file.setLastModified(System.currentTimeMillis())
    return BitmapFactory.decodeFile(file.path)
  }

  fun fallback(name: String): Bitmap {
    val bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = Color.rgb(88, 101, 242)
    canvas.drawCircle(SIZE / 2f, SIZE / 2f, SIZE / 2f, paint)
    paint.color = Color.WHITE
    paint.textAlign = Paint.Align.CENTER
    paint.textSize = 88f
    paint.isFakeBoldText = true
    val initial = name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    canvas.drawText(initial, SIZE / 2f, SIZE / 2f - (paint.ascent() + paint.descent()) / 2f, paint)
    return bitmap
  }

  private fun directory(context: Context) = File(context.cacheDir, "push-avatars")
  private fun versionedIdentity(identity: String, avatarVersion: String) = "$identity|$avatarVersion"
  private fun filename(identity: String) = MessageDigest.getInstance("SHA-256")
    .digest(identity.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) } + ".png"

  private fun prune(directory: File) {
    directory.listFiles()?.filter { it.extension == "png" }?.sortedByDescending { it.lastModified() }
      ?.drop(MAX_FILES)?.forEach { it.delete() }
  }
}
