# Mobile reply/edit composer

Source: `mobile/src/screens/CommunityScreen.tsx:1500–1625`.

Native light captures now cover Reply and Edit. Reply shows “Replying to visual-owner”; Edit shows “Editing your Message” and the existing message in the multiline input. Both expose Cancel Message action. Cancel clears the reply/edit context; cancelling Edit also clears the draft.

The source disables Send when the trimmed draft and file list are empty, while sending, or when either DM member has blocked the other. Attachment selection is disabled while sending or blocked; the text input becomes non-editable when blocked. Error text, selected-file rows and mention suggestions are separate conditional surfaces still needing complete capture coverage.

The captured edit state reports Send disabled despite populated text. This run used an expired fixture session; the disabled condition has not been isolated and is not presented as the normal successful-edit state. Nothing was submitted or changed.

Reply/edit context components preserve text and close-control bounds. Android flattened the container out of the accessibility tree, so the 1028×142 container is derived from child bounds plus source margin/padding. Full composer reconstruction, exact glyph metrics, enabled Send, keyboard, error, attachment and mention variants remain pending.
