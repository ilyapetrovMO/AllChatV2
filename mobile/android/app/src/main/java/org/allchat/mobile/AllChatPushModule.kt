package org.allchat.mobile

import android.app.Application
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

class AllChatPushModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "AllChatPush"

  @ReactMethod
  fun getRegistration(promise: Promise) {
    if (FirebaseApp.getApps(reactApplicationContext).isEmpty()) {
      promise.resolve(null)
      return
    }
    try {
      val publicKey = encryptionPublicKey()
      FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        if (!task.isSuccessful || task.result.isNullOrBlank()) {
          promise.reject("push_token_unavailable", task.exception ?: IllegalStateException("FCM token unavailable"))
          return@addOnCompleteListener
        }
        Log.i(TAG, "FCM registration available; project_id=${BuildConfig.ALLCHAT_FIREBASE_PROJECT_ID} token_fingerprint=${fingerprint(task.result)}")
        val value = WritableNativeMap()
        value.putString("platform", "android")
        value.putString("token", task.result)
        value.putString("public_key", encode(publicKey))
        promise.resolve(value)
      }
    } catch (error: Exception) {
      promise.reject("push_registration_failed", error)
    }
  }

  companion object {
    private const val TAG = "AllChatPush"
    private const val KEY_ALIAS = "allchat_mobile_push_v1"

    fun initializeFirebase(application: Application) {
      if (FirebaseApp.getApps(application).isNotEmpty() || BuildConfig.ALLCHAT_FIREBASE_API_KEY.isBlank() || BuildConfig.ALLCHAT_FIREBASE_APP_ID.isBlank() || BuildConfig.ALLCHAT_FIREBASE_PROJECT_ID.isBlank() || BuildConfig.ALLCHAT_FIREBASE_SENDER_ID.isBlank()) return
      val options = FirebaseOptions.Builder()
        .setApiKey(BuildConfig.ALLCHAT_FIREBASE_API_KEY)
        .setApplicationId(BuildConfig.ALLCHAT_FIREBASE_APP_ID)
        .setProjectId(BuildConfig.ALLCHAT_FIREBASE_PROJECT_ID)
        .setGcmSenderId(BuildConfig.ALLCHAT_FIREBASE_SENDER_ID)
        .build()
      FirebaseApp.initializeApp(application, options)
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun encryptionPublicKey(): ByteArray {
      val store = keyStore()
      if (!store.containsAlias(KEY_ALIAS)) {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_DECRYPT)
          .setKeySize(2048)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
          .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
          .build())
        generator.generateKeyPair()
      }
      return store.getCertificate(KEY_ALIAS).publicKey.encoded
    }

    fun decryptPayload(encodedEnvelope: String): JSONObject {
      val envelope = JSONObject(String(decode(encodedEnvelope), Charsets.UTF_8))
      val privateKey = keyStore().getKey(KEY_ALIAS, null)
      val rsa = Cipher.getInstance("RSA/ECB/OAEPPadding")
      rsa.init(Cipher.DECRYPT_MODE, privateKey, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT))
      val aesKey = rsa.doFinal(decode(envelope.getString("key")))
      val nonce = decode(envelope.getString("nonce"))
      val aes = Cipher.getInstance("AES/GCM/NoPadding")
      aes.init(Cipher.DECRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(128, nonce))
      return JSONObject(String(aes.doFinal(decode(envelope.getString("ciphertext"))), Charsets.UTF_8))
    }

    private fun encode(value: ByteArray): String = Base64.encodeToString(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    private fun decode(value: String): ByteArray = Base64.decode(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    private fun fingerprint(value: String): String = MessageDigest.getInstance("SHA-256")
      .digest(value.toByteArray(Charsets.UTF_8))
      .take(12)
      .joinToString("") { "%02x".format(it) }
  }
}
