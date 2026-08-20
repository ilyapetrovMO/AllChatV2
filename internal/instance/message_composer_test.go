// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"bytes"
	"strings"
	"testing"
)

func TestChannelComposerIsKeyboardOnlyAndMultiline(t *testing.T) {
	var page bytes.Buffer
	err := channelTemplate.Execute(&page, map[string]any{
		"Channel":            map[string]any{"ID": "channel", "Name": "general"},
		"Messages":           []any{},
		"Member":             map[string]any{"ID": "member", "Username": "alex", "DisplayName": "Alex", "Owner": false, "AvatarURL": "/avatar"},
		"Members":            []any{},
		"Presence":           map[string]string{},
		"Overview":           map[string]any{"Categories": []any{}, "Channels": []any{}},
		"DirectMessages":     []any{},
		"Direct":             false,
		"CSRF":               "token",
		"LastSequence":       int64(0),
		"FirstSequence":      int64(0),
		"MaxAttachmentBytes": int64(1024),
	})
	if err != nil {
		t.Fatal(err)
	}

	html := page.String()
	if !strings.Contains(html, `<textarea id="message-body"`) {
		t.Fatal("channel composer must use a multiline textarea")
	}
	if strings.Contains(html, `id="composer-submit"`) || strings.Contains(html, `aria-label="Send Message"`) {
		t.Fatal("channel composer must not render a Send button")
	}
	if !strings.Contains(html, `event.key==="Enter"&&!event.shiftKey&&!event.isComposing`) || !strings.Contains(html, `composer.requestSubmit()`) {
		t.Fatal("channel composer must submit Enter while preserving Shift+Enter and IME composition")
	}
	if !strings.Contains(html, `event.key==="ArrowUp"&&!bodyInput.value`) || !strings.Contains(html, `.slice(-10).reverse()`) {
		t.Fatal("empty channel composer must edit the Member's latest Message within the last ten Messages")
	}
}

func TestChannelAttachmentButtonIsABareMutedIcon(t *testing.T) {
	stylesheet, err := embeddedWeb.ReadFile("web/assets/channel.css")
	if err != nil {
		t.Fatal(err)
	}
	css := string(stylesheet)
	start := strings.Index(css, ".attachment-button {")
	if start < 0 {
		t.Fatal("attachment button style is missing")
	}
	end := strings.Index(css[start:], "}")
	if end < 0 {
		t.Fatal("attachment button style is incomplete")
	}
	rule := css[start : start+end]
	if !strings.Contains(rule, "background: transparent") || !strings.Contains(rule, "color: var(--muted)") {
		t.Fatalf("attachment button must be a bare muted icon; rule: %s", rule)
	}
}

func TestAnimatedGIFUsesOriginalMediaInsteadOfStaticPreview(t *testing.T) {
	if got := imageSource("image/gif", "/preview", "/original"); got != "/original" {
		t.Fatalf("GIF source = %q, want original", got)
	}
	if got := imageSource("image/png", "/preview", "/original"); got != "/preview" {
		t.Fatalf("PNG source = %q, want preview", got)
	}
}
