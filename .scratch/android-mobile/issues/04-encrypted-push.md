# Encrypted Android push

Type: task
Status: claimed
Blocked by: 01, 02

Implement the optional capability-based Go push relay, per-Instance encrypted device registration, native FCM decryption and notification rendering, token rotation, policy evaluation, deduplication, rate limiting, and deployment documentation.

## Comments

- Added native Android notification rendering for live realtime Messages, testable policy evaluation, active-conversation suppression, own-message/mute/mention handling, per-conversation toast and global sound cooldowns, and global/Channel settings UI.
- The Android build remains Firebase-independent. Encrypted FCM registration/delivery, token rotation, and the optional server relay remain open.
