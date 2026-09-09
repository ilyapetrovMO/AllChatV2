# Notification settings coverage

Source: desktop/src/renderer/app.tsx NotificationSettings (3465–3534), styles.css:453–465. Milestone 23 introduces Community/default, muted/sound-off, three channel override levels, and no eligible channels. Only non-archived Text Channels belong in this list. Synthetic general/announcements/support fixtures are used. Desktop-notification permission is a fixed enabled statement in the current component, not a conditional permission prompt.

Milestone 24 adds expanded Community/Channel menus, Community All Messages selection, all four save success/failure notices and retained values after failure. Milestone 25 adds keyboard-focus references for both levels, Community mute, notification sound and channel mute. Remaining: hover, minimum-window and scrolled states, full runtime geometry and typography review; cross-platform native menu differences. Community options are All Messages / Only @mentions / Nothing. Channel options add Community default.

Both save handlers update local state before awaiting the action, and failures only change notice text. They do not revert the selected level or checkbox. Exact notices: “Community notification settings saved.”, “Could not save notification settings.”, “Channel notification settings saved.”, “Could not save channel notification settings.” No explicit Save button, loading spinner, or disabled state is implemented here. Community level “default” normalizes to mentions_only.

Milestone 23 also adds the Ringtone file-selector hover colour from styles.css:209. The native file-picker investigation remains unresolved and is not counted as design coverage.
