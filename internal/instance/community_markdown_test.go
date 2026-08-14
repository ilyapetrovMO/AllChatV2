// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"bytes"
	"strings"
	"testing"
)

func TestCommunityMarkdownSupportsGuideStructures(t *testing.T) {
	source := "- parent\n  - nested\n\n| Name | Value |\n|---|---|\n| Guide | Yes |\n\n- [x] done\n\n```json\n{\"ok\":true}\n```"
	var output bytes.Buffer
	if err := communityMarkdown.Convert([]byte(source), &output); err != nil {
		t.Fatal(err)
	}
	html := output.String()
	for _, expected := range []string{"<ul>", "<table>", `type="checkbox"`, `class="language-json"`} {
		if !strings.Contains(html, expected) {
			t.Fatalf("rendered Markdown missing %q:\n%s", expected, html)
		}
	}
}
