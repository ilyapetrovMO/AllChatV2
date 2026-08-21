package instance

import (
	"html/template"
	"net/http"
)

func (i *Instance) ringtoneSettingsPage(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	communitySet, memberSet := i.ringtoneStatus(member.ID)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = ringtoneSettingsTemplate.Execute(w, struct {
		CommunitySet bool
		MemberSet    bool
	}{communitySet, memberSet})
}

var ringtoneSettingsTemplate = template.Must(template.New("ringtone-settings").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ringtone — AllChat</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script><script src="/assets/voice-settings.js" defer></script><script src="/assets/member-ringtone-settings.js" defer></script></head><body><div class="app-shell"><aside class="community-rail"><a class="community-mark" href="/">AC</a></aside><aside class="channel-sidebar"><div class="community-header">Member Settings</div><nav class="channel-nav settings-nav"><a href="/profile">My Account</a><a href="/voice-video">Voice &amp; Video</a><a href="/ringtone" aria-current="page">Ringtone</a><a href="/sessions">Sessions</a><a href="/">Back to Community</a></nav></aside><main class="content-shell"><header class="content-header"><button class="mobile-menu" type="button" data-sidebar-toggle aria-label="Open settings navigation" aria-expanded="false">☰</button><h1>Ringtone</h1></header><section class="content voice-settings" data-member-ringtone-settings data-member-ringtone="{{.MemberSet}}" data-community-ringtone="{{.CommunitySet}}"><header class="voice-settings-intro"><p class="eyebrow">Member settings</p><p class="page-description">Choose the sound and volume used for incoming Direct Calls on this device.</p></header><section class="voice-settings-section"><h2>Incoming call ringtone</h2><p data-ringtone-status></p><label>Audio file (MP3, WAV, or Ogg; up to 2 MiB)<input type="file" accept="audio/mpeg,audio/wav,audio/ogg" data-ringtone-file></label><button type="button" class="button-secondary" data-ringtone-remove>Use Community default</button><p class="muted" data-ringtone-notice role="status"></p></section><section class="voice-settings-section"><h2>Ringtone volume</h2><div class="setting-row setting-slider"><span><strong>Volume</strong><small>Adjust incoming Call ringing on this device.</small></span><label><output data-ringtone-volume-output></output><input type="range" min="0" max="1" step="0.05" aria-label="Ringtone volume" data-ringtone-volume></label></div></section></section></main></div></body></html>`))
