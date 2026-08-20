// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"strings"
	"testing"
)

func TestWebMediaOwnershipPrefersAuthoritativeSFUStreamIdentity(t *testing.T) {
	app, err := embeddedWeb.ReadFile("web/assets/app.js")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(app), "for(const value of [streamID,trackID])") {
		t.Fatal("media ownership must prefer the SFU stream ID over Chromium's rewritten track ID")
	}
	for _, asset := range []string{"web/assets/voice-sidebar.js", "web/assets/call.js"} {
		source, readErr := embeddedWeb.ReadFile(asset)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if !strings.Contains(string(source), "allchatMediaOwnerID") {
			t.Fatalf("%s does not use the shared media-owner resolver", asset)
		}
	}
}
