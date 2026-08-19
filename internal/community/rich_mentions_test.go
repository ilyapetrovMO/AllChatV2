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

func TestRenderMarkdownFormatsCompactFencedCode(t *testing.T) {
	rendered := renderMarkdown("```json [\"123\", \"321\"] ```")
	if want := `<pre><code class="language-json">[&#34;123&#34;, &#34;321&#34;]</code></pre>`; rendered != want {
		t.Fatalf("rendered fenced code = %q, want %q", rendered, want)
	}
}

func TestMentionPatternDoesNotTreatEmailAsMention(t *testing.T) {
	if markdownMention.MatchString("contact@example.com") {
		t.Fatal("email was recognized as a mention")
	}
}
