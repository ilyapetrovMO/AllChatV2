// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"strings"
	"testing"
)

func TestRenderMarkdownHighlightsInlineMention(t *testing.T) {
	rendered := renderMarkdown("hello @EliteDarkLord666, welcome")
	if !strings.Contains(rendered, `<mark class="mention">@EliteDarkLord666</mark>`) {
		t.Fatalf("rendered = %q", rendered)
	}
}

func TestMentionPatternDoesNotTreatEmailAsMention(t *testing.T) {
	if markdownMention.MatchString("contact@example.com") {
		t.Fatal("email was recognized as a mention")
	}
}
