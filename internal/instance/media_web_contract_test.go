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

func TestWebCallPreparationDoesNotSerializeIndependentWork(t *testing.T) {
	app, err := embeddedWeb.ReadFile("web/assets/app.js")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(app), `Promise.all([`) || !strings.Contains(string(app), `import("/assets/voice-connection.js")`) {
		t.Fatal("web app must preload independent voice modules concurrently")
	}

	call, err := embeddedWeb.ReadFile("web/assets/call.js")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(call), `await Promise.all([`) || !strings.Contains(string(call), `window.AllChatVoiceSettings ? null`) {
		t.Fatal("Direct Call must load independent media modules concurrently")
	}

	sidebar, err := embeddedWeb.ReadFile("web/assets/voice-sidebar.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`const [microphoneCapture, mediaConfig, iceServers] = await Promise.all([`, `window.AllChatVoiceSettings.capture()`, `fetch("/api/v1/media/config")`, `fetch("/api/v1/turn-credentials")`, `fetchCredentials:async()=>iceServers`} {
		if !strings.Contains(string(sidebar), want) {
			t.Fatalf("Voice Room connection critical path is serialized: missing %q", want)
		}
	}
}

func TestWebCallRingtoneUsesResolvedMemberPolicyWithToneFallback(t *testing.T) {
	call, err := embeddedWeb.ReadFile("web/assets/call.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"/api/v1/ringtone", "ringAudio.loop=true", "ringPulse()"} {
		if !strings.Contains(string(call), want) {
			t.Fatalf("web Call ringtone policy missing %q", want)
		}
	}
	settings, err := embeddedWeb.ReadFile("web/assets/notification-service.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"/api/v1/member-ringtone", "Use Community default"} {
		if !strings.Contains(string(settings), want) {
			t.Fatalf("web Member ringtone setting missing %q", want)
		}
	}
}
