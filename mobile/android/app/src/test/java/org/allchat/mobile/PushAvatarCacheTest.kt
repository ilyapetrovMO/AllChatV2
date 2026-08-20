package org.allchat.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushAvatarCacheTest {
  @Test
  fun `avatar identity excludes cache busting query`() {
    assertEquals(
      "https://chat.example|member-123",
      PushAvatarCache.identity("https://chat.example/api/v1/members/member-123/avatar?v=7"),
    )
  }

  @Test
  fun `untrusted paths are not cached as avatars`() {
    assertNull(PushAvatarCache.identity("https://chat.example/api/v1/attachments/private"))
    assertNull(PushAvatarCache.identity("file:///tmp/avatar.png"))
  }
}
