package org.allchat.mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.oney.WebRTCModule.WebRTCModuleOptions
import org.webrtc.PeerConnectionFactory
import org.webrtc.audio.JavaAudioDeviceModule

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(AllChatAudioPackage())
          add(AllChatMediaSaverPackage())
          add(AllChatUpdaterPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true
    // OEM hardware audio effects vary significantly and some devices couple
    // AcousticEchoCanceler with aggressive, undocumented input gain. Keep AEC
    // and noise suppression in WebRTC's software pipeline so the settings are
    // independent and RNNoise is never stacked with a hardware suppressor.
    WebRTCModuleOptions.getInstance().audioDeviceModule =
      JavaAudioDeviceModule.builder(this)
        .setUseHardwareAcousticEchoCanceler(false)
        .setUseHardwareNoiseSuppressor(false)
        .setEnableVolumeLogger(false)
        .createAudioDeviceModule()
    WebRTCModuleOptions.getInstance().audioProcessingFactory =
      org.webrtc.AudioProcessingFactory { PeerConnectionFactory.createAllChatAudioProcessing() }
    loadReactNative(this)
  }
}
