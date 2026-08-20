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

func TestWebParticipantMenusControlIndividualVolume(t *testing.T) {
	settings, err := embeddedWeb.ReadFile("web/assets/voice-settings.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"openParticipantVolumeMenu", "memberVolumes", "allchat:voice-settings"} {
		if !strings.Contains(string(settings), want) {
			t.Fatalf("voice settings do not expose per-participant volume control: missing %q", want)
		}
	}
	for _, asset := range []string{"web/assets/voice-sidebar.js", "web/assets/voice.js", "web/assets/call.js"} {
		source, readErr := embeddedWeb.ReadFile(asset)
		if readErr != nil {
			t.Fatal(readErr)
		}
		for _, want := range []string{"oncontextmenu", "openParticipantVolumeMenu", "dataset.memberId"} {
			if !strings.Contains(string(source), want) {
				t.Fatalf("%s does not bind remote audio to a right-click participant volume menu: missing %q", asset, want)
			}
		}
	}
}
