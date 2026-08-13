package org.allchat.mobile

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AllChatAudioModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  override fun getName() = "AllChatAudio"

  @ReactMethod
  fun listRoutes(promise: Promise) {
    val routes = Arguments.createArray()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      audio.availableCommunicationDevices.forEach { device -> routes.pushMap(route(device)) }
    } else {
      routes.pushMap(Arguments.createMap().apply { putString("id", "earpiece"); putString("name", "Phone") })
      routes.pushMap(Arguments.createMap().apply { putString("id", "speaker"); putString("name", "Speaker") })
      if (audio.isBluetoothScoAvailableOffCall) routes.pushMap(Arguments.createMap().apply { putString("id", "bluetooth"); putString("name", "Bluetooth") })
      if (audio.isWiredHeadsetOn) routes.pushMap(Arguments.createMap().apply { putString("id", "wired"); putString("name", "Wired headset") })
    }
    promise.resolve(routes)
  }

  @ReactMethod
  fun selectRoute(id: String, promise: Promise) {
    try {
      audio.mode = AudioManager.MODE_IN_COMMUNICATION
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val device = audio.availableCommunicationDevices.firstOrNull { it.id.toString() == id }
        promise.resolve(device != null && audio.setCommunicationDevice(device))
      } else {
        @Suppress("DEPRECATION")
        when (id) {
          "speaker" -> audio.isSpeakerphoneOn = true
          "bluetooth" -> { audio.startBluetoothSco(); audio.isBluetoothScoOn = true; audio.isSpeakerphoneOn = false }
          else -> { audio.stopBluetoothSco(); audio.isBluetoothScoOn = false; audio.isSpeakerphoneOn = false }
        }
        promise.resolve(true)
      }
    } catch (error: Exception) { promise.reject("audio_route_failed", error) }
  }

  private fun route(device: AudioDeviceInfo) = Arguments.createMap().apply {
    putString("id", device.id.toString())
    putString("name", when (device.type) {
      AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Speaker"
      AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Phone"
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> "Bluetooth"
      AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET -> "Wired headset"
      else -> device.productName?.toString() ?: "Audio device"
    })
  }
}
