package org.allchat.mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.oney.WebRTCModule.WebRTCModuleOptions
import org.webrtc.PeerConnectionFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(AllChatAudioPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true
    WebRTCModuleOptions.getInstance().audioProcessingFactory =
      org.webrtc.AudioProcessingFactory { PeerConnectionFactory.createAllChatAudioProcessing() }
    loadReactNative(this)
  }
}
