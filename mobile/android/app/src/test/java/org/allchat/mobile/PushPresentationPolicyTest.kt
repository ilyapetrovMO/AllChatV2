package org.allchat.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushPresentationPolicyTest {
  @Test
  fun `incoming calls are posted in every app state`() {
    assertTrue(PushPresentationPolicy.shouldPost("call", appForegrounded = true))
    assertTrue(PushPresentationPolicy.shouldPost("call", appForegrounded = false))
  }

  @Test
  fun `ordinary messages remain suppressed while foregrounded`() {
    assertFalse(PushPresentationPolicy.shouldPost("message", appForegrounded = true))
    assertTrue(PushPresentationPolicy.shouldPost("message", appForegrounded = false))
  }

  @Test
  fun `incoming calls use a versioned ringtone channel`() {
    assertTrue(PushPresentationPolicy.channelID("call", sound = true).startsWith("allchat_incoming_calls_v2"))
  }
}
