// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package acceptance_test

import (
	_ "allchat/internal/instance" // Make the subprocess source part of Go's test-cache key.

	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/webrtc/v4"
)

var allchatBinary string

func TestMain(testingMain *testing.M) {
	projectRoot, err := filepath.Abs("..")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	buildDirectory, err := os.MkdirTemp("", "allchat-acceptance-build-")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer os.RemoveAll(buildDirectory)

	allchatBinary = filepath.Join(buildDirectory, "allchat")
	build := exec.Command("go", "build", "-buildvcs=false", "-o", allchatBinary, "./cmd/allchat")
	build.Dir = projectRoot
	build.Stdout = os.Stdout
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		os.Exit(1)
	}
	os.Exit(testingMain.Run())
}

func TestFreshInstanceServesEmbeddedWebAndHealth(t *testing.T) {
	dataDirectory := t.TempDir()
	app := startInstance(t, dataDirectory)

	healthResponse := get(t, app.url("/api/v1/health"))
	defer healthResponse.Body.Close()
	if healthResponse.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d, want %d", healthResponse.StatusCode, http.StatusOK)
	}
	if contentType := healthResponse.Header.Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("health Content-Type = %q, want application/json", contentType)
	}
	var health struct {
		Status        string `json:"status"`
		SchemaVersion int    `json:"schema_version"`
	}
	if err := json.NewDecoder(healthResponse.Body).Decode(&health); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if health.Status != "ok" || health.SchemaVersion != 16 {
		t.Fatalf("health = %+v, want status ok at schema version 16", health)
	}

	client := newClient(t)
	bootstrapOwner(t, client, app, "owner", "correct horse battery staple")

	pageResponse := getWithClient(t, client, app.url("/"))
	defer pageResponse.Body.Close()
	page := readAll(t, pageResponse.Body)
	if pageResponse.StatusCode != http.StatusOK {
		t.Fatalf("page status = %d, want %d", pageResponse.StatusCode, http.StatusOK)
	}
	for _, expected := range []string{`class="app-shell"`, `class="channel-sidebar"`, `href="/assets/app.css"`, `hx-get="/api/v1/health"`, `src="/assets/htmx.min.js"`} {
		if !strings.Contains(page, expected) {
			t.Errorf("embedded page does not contain %q", expected)
		}
	}
	if strings.Contains(page, "cdn.") {
		t.Error("embedded page unexpectedly depends on a CDN")
	}

	assetResponse := get(t, app.url("/assets/htmx.min.js"))
	defer assetResponse.Body.Close()
	asset := readAll(t, assetResponse.Body)
	if assetResponse.StatusCode != http.StatusOK || !strings.Contains(asset, "htmx") {
		t.Fatalf("embedded htmx asset was not served successfully")
	}
	styles := getWithClient(t, client, app.url("/assets/app.css"))
	styleBody := readAll(t, styles.Body)
	styles.Body.Close()
	if styles.StatusCode != http.StatusOK || !strings.Contains(styleBody, "prefers-reduced-motion") || !strings.Contains(styleBody, "@media(max-width:760px)") || !strings.Contains(styleBody, ".app-shell") {
		t.Fatalf("embedded design system is incomplete: status=%d", styles.StatusCode)
	}
	script := getWithClient(t, client, app.url("/assets/app.js"))
	scriptBody := readAll(t, script.Body)
	script.Body.Close()
	if script.StatusCode != http.StatusOK || !strings.Contains(scriptBody, "data-sidebar-toggle") || !strings.Contains(scriptBody, "data-confirm") || !strings.Contains(scriptBody, "autocorrect") {
		t.Fatalf("embedded interaction foundation is incomplete: status=%d", script.StatusCode)
	}

	if _, err := os.Stat(filepath.Join(dataDirectory, "allchat.db")); err != nil {
		t.Fatalf("SQLite database was not created: %v", err)
	}
}

func TestAcceptedDirectCallNegotiatesRealPeersThroughPublicMediaWebSocket(t *testing.T) {
	app := startInstance(t, t.TempDir())
	ownerClient := newClient(t)
	owner := bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")
	invitation := createInvitation(t, ownerClient, app, 10, 1)
	memberClient := newClient(t)
	member := registerMember(t, memberClient, app, invitation.Token, "caller-peer", "another strong password")
	dmResponse := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/dms"), map[string]string{"member_id": member.ID})
	var dm directMessageView
	decodeResponse(t, dmResponse, http.StatusCreated, &dm)
	callResponse := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/dms/"+dm.ID+"/calls"), map[string]string{})
	var call struct {
		ID string `json:"id"`
	}
	decodeResponse(t, callResponse, http.StatusCreated, &call)
	accepted := requestJSON(t, memberClient, http.MethodPost, app.url("/api/v1/calls/"+call.ID+"/accept"), map[string]string{})
	decodeResponse(t, accepted, http.StatusOK, &map[string]any{})
	ownerPeer, ownerSignal := connectMediaPeer(t, ownerClient, app, call.ID)
	defer ownerPeer.Close()
	defer ownerSignal.Close(websocket.StatusNormalClosure, "test complete")
	memberPeer, memberSignal := connectMediaPeer(t, memberClient, app, call.ID)
	defer memberPeer.Close()
	defer memberSignal.Close(websocket.StatusNormalClosure, "test complete")
	if owner["id"] == "" || member.ID == "" {
		t.Fatal("test participants were not created")
	}
}

func connectMediaPeer(t *testing.T, client *http.Client, app *runningInstance, roomID string) (*webrtc.PeerConnection, *websocket.Conn) {
	t.Helper()
	peer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	track, _ := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2}, "microphone", "acceptance")
	if _, err = peer.AddTrack(track); err != nil {
		peer.Close()
		t.Fatal(err)
	}
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		peer.Close()
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(peer)
	if err = peer.SetLocalDescription(offer); err != nil {
		peer.Close()
		t.Fatal(err)
	}
	<-gathered
	target := strings.Replace(app.url("/api/v1/media"), "http://", "ws://", 1)
	headers := http.Header{}
	httpTarget, _ := url.Parse(app.url("/"))
	for _, cookie := range client.Jar.Cookies(httpTarget) {
		headers.Add("Cookie", cookie.String())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	connection, response, err := websocket.Dial(ctx, target, &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		peer.Close()
		if response != nil {
			t.Fatalf("dial media WebSocket: %v status=%d", err, response.StatusCode)
		}
		t.Fatal(err)
	}
	command := map[string]any{"version": 1, "type": "join", "room_id": roomID, "sdp": peer.LocalDescription()}
	encoded, _ := json.Marshal(command)
	if err = connection.Write(ctx, websocket.MessageText, encoded); err != nil {
		connection.CloseNow()
		peer.Close()
		t.Fatal(err)
	}
	_, encoded, err = connection.Read(ctx)
	if err != nil {
		connection.CloseNow()
		peer.Close()
		t.Fatal(err)
	}
	var frame struct {
		Type string                     `json:"type"`
		SDP  *webrtc.SessionDescription `json:"sdp"`
	}
	if err = json.Unmarshal(encoded, &frame); err != nil || frame.Type != "answer" || frame.SDP == nil {
		connection.CloseNow()
		peer.Close()
		t.Fatalf("media answer = %s, %v", encoded, err)
	}
	connected := make(chan struct{}, 1)
	peer.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateConnected {
			connected <- struct{}{}
		}
	})
	if err = peer.SetRemoteDescription(*frame.SDP); err != nil {
		connection.CloseNow()
		peer.Close()
		t.Fatal(err)
	}
	select {
	case <-connected:
	case <-time.After(10 * time.Second):
		connection.CloseNow()
		peer.Close()
		t.Fatalf("public media peer state = %s", peer.ConnectionState())
	}
	return peer, connection
}

func TestInstanceRestartsUsingTheSameInitializedData(t *testing.T) {
	dataDirectory := t.TempDir()
	first := startInstance(t, dataDirectory)
	first.stop(t)

	second := startInstance(t, dataDirectory)
	response := get(t, second.url("/api/v1/health"))
	defer response.Body.Close()
	var health map[string]any
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		t.Fatalf("decode health response after restart: %v", err)
	}
	if health["status"] != "ok" || health["schema_version"] != float64(16) {
		t.Fatalf("health after restart = %#v", health)
	}
}

func TestOwnerBootstrapAuthenticationLogoutAndRestart(t *testing.T) {
	dataDirectory := t.TempDir()
	app := startInstance(t, dataDirectory)
	if app.setupURL == "" {
		t.Fatal("fresh Instance did not emit a setup URL")
	}
	setupPage := get(t, app.setupURL)
	setupBody := readAll(t, setupPage.Body)
	setupPage.Body.Close()
	if setupPage.StatusCode != http.StatusOK || !strings.Contains(setupBody, "Create Community Owner") {
		t.Fatalf("setup page status/body = %d %q", setupPage.StatusCode, setupBody)
	}
	if mode := fileMode(t, filepath.Join(dataDirectory, "setup.token")); mode.Perm() != 0o600 {
		t.Fatalf("setup token permissions = %o, want 600", mode.Perm())
	}
	originalToken := setupToken(t, app.setupURL)
	app.stop(t)
	app = startInstance(t, dataDirectory)
	if restartedToken := setupToken(t, app.setupURL); restartedToken != originalToken {
		t.Fatal("unconsumed setup token changed across restart")
	}

	client := newClient(t)
	member := bootstrapOwner(t, client, app, "Owner.Name", "correct horse battery staple")
	if member["username"] != "Owner.Name" || member["owner"] != true || member["id"] == "" {
		t.Fatalf("created Owner = %#v", member)
	}
	if _, err := os.Stat(filepath.Join(dataDirectory, "setup.token")); !os.IsNotExist(err) {
		t.Fatalf("consumed setup token still exists: %v", err)
	}

	sessionResponse := getWithClient(t, client, app.url("/api/v1/session"))
	if sessionResponse.StatusCode != http.StatusOK {
		t.Fatalf("authenticated Session status = %d", sessionResponse.StatusCode)
	}
	sessionResponse.Body.Close()

	reuse := postJSON(t, newClient(t), app.url("/api/v1/auth/setup"), map[string]string{
		"token": setupToken(t, app.setupURL), "username": "other", "password": "another valid password",
	})
	if reuse.StatusCode != http.StatusConflict {
		t.Fatalf("reused setup status = %d, want %d", reuse.StatusCode, http.StatusConflict)
	}
	reuse.Body.Close()

	logout := postJSON(t, client, app.url("/api/v1/auth/logout"), map[string]string{})
	if logout.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status = %d", logout.StatusCode)
	}
	logout.Body.Close()
	afterLogout := getWithClient(t, client, app.url("/api/v1/session"))
	if afterLogout.StatusCode != http.StatusUnauthorized {
		t.Fatalf("Session after logout status = %d", afterLogout.StatusCode)
	}
	afterLogout.Body.Close()
	webLogin := url.Values{"username": {"owner.name"}, "password": {"correct horse battery staple"}}
	webLoginResponse, err := client.PostForm(app.url("/login"), webLogin)
	if err != nil {
		t.Fatalf("web login: %v", err)
	}
	webLoginResponse.Body.Close()
	if webLoginResponse.StatusCode != http.StatusOK || webLoginResponse.Request.URL.Path != "/" {
		t.Fatalf("web login ended at status/path %d %q", webLoginResponse.StatusCode, webLoginResponse.Request.URL.Path)
	}
	webSession := getWithClient(t, client, app.url("/api/v1/session"))
	if webSession.StatusCode != http.StatusOK {
		t.Fatalf("web-authenticated Session status = %d", webSession.StatusCode)
	}
	webSession.Body.Close()

	app.stop(t)
	restarted := startInstance(t, dataDirectory)
	if restarted.setupURL != "" {
		t.Fatalf("configured Instance regenerated setup URL %q", restarted.setupURL)
	}
	login := postJSON(t, client, restarted.url("/api/v1/auth/login"), map[string]string{
		"username": "owner.name", "password": "correct horse battery staple",
	})
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login after restart status = %d body=%s", login.StatusCode, readAll(t, login.Body))
	}
	login.Body.Close()
}

func TestLoginDoesNotRevealAccountsAndRateLimitsFailures(t *testing.T) {
	app := startInstance(t, t.TempDir())
	bootstrapOwner(t, newClient(t), app, "owner", "correct horse battery staple")
	client := newClient(t)

	unknown := postJSON(t, client, app.url("/api/v1/auth/login"), map[string]string{"username": "missing", "password": "wrong password"})
	unknownBody := readAll(t, unknown.Body)
	unknown.Body.Close()
	wrong := postJSON(t, client, app.url("/api/v1/auth/login"), map[string]string{"username": "owner", "password": "wrong password"})
	wrongBody := readAll(t, wrong.Body)
	wrong.Body.Close()
	if unknown.StatusCode != http.StatusUnauthorized || wrong.StatusCode != http.StatusUnauthorized || unknownBody != wrongBody {
		t.Fatalf("login failures differ: unknown=(%d %q), wrong=(%d %q)", unknown.StatusCode, unknownBody, wrong.StatusCode, wrongBody)
	}

	for attempt := 0; attempt < 3; attempt++ {
		response := postJSON(t, client, app.url("/api/v1/auth/login"), map[string]string{"username": fmt.Sprintf("spray%d", attempt), "password": "wrong password"})
		response.Body.Close()
	}
	limited := postJSON(t, client, app.url("/api/v1/auth/login"), map[string]string{"username": "another", "password": "wrong password"})
	if limited.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("rate-limited login status = %d, want %d", limited.StatusCode, http.StatusTooManyRequests)
	}
	limited.Body.Close()
}

func TestOfflineOwnerRecoveryChangesCredentialsAndRevokesSessions(t *testing.T) {
	dataDirectory := t.TempDir()
	app := startInstance(t, dataDirectory)
	oldClient := newClient(t)
	bootstrapOwner(t, oldClient, app, "owner", "correct horse battery staple")
	app.stop(t)

	recovery := exec.Command(allchatBinary, "recover-owner", "--data-dir", dataDirectory, "--username", "recovered-owner")
	recovery.Stdin = strings.NewReader("a completely new password\n")
	output, err := recovery.CombinedOutput()
	if err != nil {
		t.Fatalf("offline recovery failed: %v: %s", err, output)
	}
	if !strings.Contains(string(output), "all existing Sessions were revoked") {
		t.Fatalf("offline recovery output = %q", output)
	}

	restarted := startInstance(t, dataDirectory)
	oldSession := getWithClient(t, oldClient, restarted.url("/api/v1/session"))
	if oldSession.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old Session after recovery status = %d", oldSession.StatusCode)
	}
	oldSession.Body.Close()

	oldCredentials := postJSON(t, newClient(t), restarted.url("/api/v1/auth/login"), map[string]string{
		"username": "owner", "password": "correct horse battery staple",
	})
	if oldCredentials.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old credentials status = %d", oldCredentials.StatusCode)
	}
	oldCredentials.Body.Close()
	newCredentials := postJSON(t, newClient(t), restarted.url("/api/v1/auth/login"), map[string]string{
		"username": "recovered-owner", "password": "a completely new password",
	})
	if newCredentials.StatusCode != http.StatusOK {
		t.Fatalf("recovered credentials status = %d body=%s", newCredentials.StatusCode, readAll(t, newCredentials.Body))
	}
	newCredentials.Body.Close()
}

func TestMemberCanInspectAndRevokeSessionsWithCSRFProtection(t *testing.T) {
	app := startInstance(t, t.TempDir())
	first := newClient(t)
	bootstrapOwner(t, first, app, "owner", "correct horse battery staple")
	second := newClient(t)
	loginWithDevice(t, second, app, "owner", "correct horse battery staple", "AllChat Desktop Test")

	list := getWithClient(t, first, app.url("/api/v1/sessions"))
	var payload struct {
		Sessions []struct {
			ID           string `json:"id"`
			Device       string `json:"device"`
			CreatedAt    string `json:"created_at"`
			LastActivity string `json:"last_activity"`
			Current      bool   `json:"current"`
		} `json:"sessions"`
	}
	if err := json.NewDecoder(list.Body).Decode(&payload); err != nil {
		t.Fatalf("decode Sessions: %v", err)
	}
	list.Body.Close()
	if list.StatusCode != http.StatusOK || len(payload.Sessions) != 2 {
		t.Fatalf("Sessions status/count = %d/%d", list.StatusCode, len(payload.Sessions))
	}
	var otherID string
	for _, session := range payload.Sessions {
		if session.ID == "" || session.Device == "" || session.CreatedAt == "" || session.LastActivity == "" {
			t.Fatalf("incomplete Session metadata: %+v", session)
		}
		if !session.Current {
			otherID = session.ID
			if session.Device != "AllChat Desktop Test" {
				t.Fatalf("second Session device = %q", session.Device)
			}
		}
	}
	if otherID == "" {
		t.Fatal("did not find the non-current Session")
	}

	withoutCSRF, err := http.NewRequest(http.MethodPost, app.url("/api/v1/auth/logout"), strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	withoutCSRF.Header.Set("Content-Type", "application/json")
	for _, cookie := range first.Jar.Cookies(withoutCSRF.URL) {
		withoutCSRF.AddCookie(cookie)
	}
	csrfResponse, err := (&http.Client{Timeout: 5 * time.Second}).Do(withoutCSRF)
	if err != nil {
		t.Fatalf("send CSRF-negative request: %v", err)
	}
	csrfResponse.Body.Close()
	if csrfResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("missing-CSRF status = %d", csrfResponse.StatusCode)
	}
	stillAuthenticated := getWithClient(t, first, app.url("/api/v1/session"))
	if stillAuthenticated.StatusCode != http.StatusOK {
		t.Fatalf("CSRF rejection revoked Session unexpectedly")
	}
	stillAuthenticated.Body.Close()

	revoked := deleteJSON(t, first, app.url("/api/v1/sessions/"+otherID))
	if revoked.StatusCode != http.StatusNoContent {
		t.Fatalf("individual revoke status = %d body=%s", revoked.StatusCode, readAll(t, revoked.Body))
	}
	revoked.Body.Close()
	secondSession := getWithClient(t, second, app.url("/api/v1/session"))
	if secondSession.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked device Session status = %d", secondSession.StatusCode)
	}
	secondSession.Body.Close()
	firstSession := getWithClient(t, first, app.url("/api/v1/session"))
	if firstSession.StatusCode != http.StatusOK {
		t.Fatalf("unrelated Session status = %d", firstSession.StatusCode)
	}
	firstSession.Body.Close()

	loginWithDevice(t, second, app, "owner", "correct horse battery staple", "AllChat Desktop Test")
	revokeAll := deleteJSON(t, first, app.url("/api/v1/sessions"))
	if revokeAll.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke-all status = %d", revokeAll.StatusCode)
	}
	revokeAll.Body.Close()
	for name, client := range map[string]*http.Client{"current": first, "other": second} {
		response := getWithClient(t, client, app.url("/api/v1/session"))
		if response.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s Session after revoke-all = %d", name, response.StatusCode)
		}
		response.Body.Close()
	}
}

func TestRecoveryTokensAreSingleUseAndInvalidateSessions(t *testing.T) {
	app := startInstance(t, t.TempDir())
	ownerClient := newClient(t)
	member := bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")
	memberID := member["id"].(string)
	secondClient := newClient(t)
	loginWithDevice(t, secondClient, app, "owner", "correct horse battery staple", "Second device")

	issueURL := app.url("/api/v1/admin/members/" + memberID + "/recovery-token")
	firstIssue := postJSON(t, ownerClient, issueURL, map[string]string{})
	var firstToken struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(firstIssue.Body).Decode(&firstToken); err != nil {
		t.Fatalf("decode first Recovery Token: %v", err)
	}
	firstIssue.Body.Close()
	if firstIssue.StatusCode != http.StatusCreated || firstToken.Token == "" || firstToken.ExpiresAt == "" {
		t.Fatalf("first Recovery Token response = %d %+v", firstIssue.StatusCode, firstToken)
	}

	secondIssue := postJSON(t, ownerClient, issueURL, map[string]string{})
	var secondToken struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(secondIssue.Body).Decode(&secondToken); err != nil {
		t.Fatalf("decode second Recovery Token: %v", err)
	}
	secondIssue.Body.Close()

	superseded := postJSON(t, newClient(t), app.url("/api/v1/auth/recover"), map[string]string{
		"token": firstToken.Token, "password": "a replacement password",
	})
	supersededBody := readAll(t, superseded.Body)
	superseded.Body.Close()
	malformed := postJSON(t, newClient(t), app.url("/api/v1/auth/recover"), map[string]string{
		"token": "not-a-real-token", "password": "a replacement password",
	})
	malformedBody := readAll(t, malformed.Body)
	malformed.Body.Close()
	if superseded.StatusCode != http.StatusBadRequest || malformed.StatusCode != http.StatusBadRequest || supersededBody != malformedBody {
		t.Fatalf("invalid Recovery Token responses differ: superseded=(%d %q), malformed=(%d %q)", superseded.StatusCode, supersededBody, malformed.StatusCode, malformedBody)
	}

	recoveryPage := get(t, app.url("/recover?token="+url.QueryEscape(secondToken.Token)))
	pageBody := readAll(t, recoveryPage.Body)
	recoveryPage.Body.Close()
	if recoveryPage.StatusCode != http.StatusOK || !strings.Contains(pageBody, "Recover account") {
		t.Fatalf("recovery page status/body = %d %q", recoveryPage.StatusCode, pageBody)
	}

	redeemed := postJSON(t, newClient(t), app.url("/api/v1/auth/recover"), map[string]string{
		"token": secondToken.Token, "password": "a replacement password",
	})
	if redeemed.StatusCode != http.StatusNoContent {
		t.Fatalf("redeem status = %d body=%s", redeemed.StatusCode, readAll(t, redeemed.Body))
	}
	redeemed.Body.Close()
	for name, client := range map[string]*http.Client{"issuer": ownerClient, "second": secondClient} {
		response := getWithClient(t, client, app.url("/api/v1/session"))
		if response.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s Session after recovery = %d", name, response.StatusCode)
		}
		response.Body.Close()
	}

	reused := postJSON(t, newClient(t), app.url("/api/v1/auth/recover"), map[string]string{
		"token": secondToken.Token, "password": "another replacement password",
	})
	if reused.StatusCode != http.StatusBadRequest {
		t.Fatalf("reused Recovery Token status = %d", reused.StatusCode)
	}
	reused.Body.Close()
	oldLogin := postJSON(t, newClient(t), app.url("/api/v1/auth/login"), map[string]string{
		"username": "owner", "password": "correct horse battery staple",
	})
	if oldLogin.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old password status = %d", oldLogin.StatusCode)
	}
	oldLogin.Body.Close()
	newLogin := postJSON(t, newClient(t), app.url("/api/v1/auth/login"), map[string]string{
		"username": "owner", "password": "a replacement password",
	})
	if newLogin.StatusCode != http.StatusOK {
		t.Fatalf("replacement password status = %d body=%s", newLogin.StatusCode, readAll(t, newLogin.Body))
	}
	newLogin.Body.Close()
}

func TestRolesInvitationsProfilesAndOwnership(t *testing.T) {
	dataDirectory := t.TempDir()
	app := startInstance(t, dataDirectory)
	ownerClient := newClient(t)
	owner := bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")

	rolesResponse := getWithClient(t, ownerClient, app.url("/api/v1/roles"))
	var rolesPayload struct {
		Roles []map[string]any `json:"roles"`
	}
	decodeResponse(t, rolesResponse, http.StatusOK, &rolesPayload)
	if len(rolesPayload.Roles) != 4 {
		t.Fatalf("default Role count = %d, want 4", len(rolesPayload.Roles))
	}

	createdRole := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/roles"), map[string]any{
		"name": "Channel Curator", "position": 600, "permissions": []string{"manage_channels", "view_channels", "send_messages"},
	})
	var role map[string]any
	decodeResponse(t, createdRole, http.StatusCreated, &role)
	roleID := role["id"].(string)
	updatedRole := requestJSON(t, ownerClient, http.MethodPatch, app.url("/api/v1/roles/"+roleID), map[string]any{
		"name": "Channel Steward", "position": 625, "permissions": []string{"manage_channels", "view_channels", "send_messages"},
	})
	decodeResponse(t, updatedRole, http.StatusOK, &role)
	if role["name"] != "Channel Steward" || role["position"] != float64(625) {
		t.Fatalf("updated Role = %#v", role)
	}
	immutable := deleteJSON(t, ownerClient, app.url("/api/v1/roles/owner"))
	if immutable.StatusCode != http.StatusConflict {
		t.Fatalf("retire Owner Role status = %d", immutable.StatusCode)
	}
	immutable.Body.Close()

	invitation := createInvitation(t, ownerClient, app, 10, 1)
	memberClient := newClient(t)
	member := registerMember(t, memberClient, app, invitation.Token, "second-member", "another strong password")
	assign := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/members/"+member.ID+"/roles/"+roleID), map[string]string{})
	if assign.StatusCode != http.StatusNoContent {
		t.Fatalf("assign Role status = %d body=%s", assign.StatusCode, readAll(t, assign.Body))
	}
	assign.Body.Close()
	deniedRole := requestJSON(t, memberClient, http.MethodPost, app.url("/api/v1/roles"), map[string]any{"name": "Escalation", "position": 700, "permissions": []string{"manage_roles"}})
	if deniedRole.StatusCode != http.StatusForbidden {
		t.Fatalf("non-manager Role creation status = %d", deniedRole.StatusCode)
	}
	deniedRole.Body.Close()

	badTransfer := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/ownership/transfer"), map[string]any{
		"target_member_id": member.ID, "password": "wrong password", "confirmed": true,
	})
	if badTransfer.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("unauthenticated transfer status = %d", badTransfer.StatusCode)
	}
	badTransfer.Body.Close()
	transfer := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/ownership/transfer"), map[string]any{
		"target_member_id": member.ID, "password": "correct horse battery staple", "confirmed": true,
	})
	if transfer.StatusCode != http.StatusNoContent {
		t.Fatalf("ownership transfer status = %d body=%s", transfer.StatusCode, readAll(t, transfer.Body))
	}
	transfer.Body.Close()
	if sessionOwnerFlag(t, ownerClient, app) || !sessionOwnerFlag(t, memberClient, app) {
		t.Fatal("ownership flags did not move atomically")
	}

	profileResponse := requestJSON(t, memberClient, http.MethodPatch, app.url("/api/v1/profile"), map[string]string{
		"username": "new-owner", "display_name": "New Owner",
	})
	var profile map[string]any
	decodeResponse(t, profileResponse, http.StatusOK, &profile)
	if profile["id"] != member.ID || profile["username"] != "new-owner" || profile["display_name"] != "New Owner" {
		t.Fatalf("updated profile = %#v", profile)
	}
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13, 'I', 'H', 'D', 'R', 0, 0, 0, 1, 0, 0, 0, 1}
	avatar := requestBytes(t, memberClient, http.MethodPut, app.url("/api/v1/profile/avatar"), "image/png", png)
	if avatar.StatusCode != http.StatusNoContent {
		t.Fatalf("avatar update status = %d body=%s", avatar.StatusCode, readAll(t, avatar.Body))
	}
	avatar.Body.Close()
	avatarGet := getWithClient(t, ownerClient, app.url("/api/v1/members/"+member.ID+"/avatar"))
	if avatarGet.StatusCode != http.StatusOK || avatarGet.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("avatar response = %d %q", avatarGet.StatusCode, avatarGet.Header.Get("Content-Type"))
	}
	avatarGet.Body.Close()
	app.stop(t)
	app = startInstance(t, dataDirectory)
	restartedProfile := getWithClient(t, ownerClient, app.url("/api/v1/members/"+member.ID))
	decodeResponse(t, restartedProfile, http.StatusOK, &profile)
	if profile["username"] != "new-owner" || profile["display_name"] != "New Owner" || profile["avatar_url"] == "" {
		t.Fatalf("profile did not survive restart: %#v", profile)
	}

	rolesPage := getWithClient(t, memberClient, app.url("/admin/roles"))
	if rolesPage.StatusCode != http.StatusOK || !strings.Contains(readAll(t, rolesPage.Body), "Channel Steward") {
		t.Fatal("embedded Role management page does not show the custom Role")
	}
	rolesPage.Body.Close()
	retired := deleteJSON(t, memberClient, app.url("/api/v1/roles/"+roleID))
	if retired.StatusCode != http.StatusNoContent {
		t.Fatalf("retire custom Role status = %d", retired.StatusCode)
	}
	retired.Body.Close()
	_ = owner
}

func TestInvitationUseLimitIsAtomic(t *testing.T) {
	app := startInstance(t, t.TempDir())
	ownerClient := newClient(t)
	bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")
	revokedInvitation := createInvitation(t, ownerClient, app, 10, 1)
	revoked := deleteJSON(t, ownerClient, app.url("/api/v1/invitations/"+revokedInvitation.ID))
	if revoked.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke Invitation status = %d", revoked.StatusCode)
	}
	revoked.Body.Close()
	revokedRegistration := requestJSON(t, newClient(t), http.MethodPost, app.url("/api/v1/auth/register"), map[string]string{"token": revokedInvitation.Token, "username": "revoked-member", "password": "another strong password"})
	if revokedRegistration.StatusCode != http.StatusBadRequest {
		t.Fatalf("revoked Invitation registration status = %d", revokedRegistration.StatusCode)
	}
	revokedRegistration.Body.Close()
	invitation := createInvitation(t, ownerClient, app, 10, 1)

	statuses := make(chan int, 2)
	for index := 0; index < 2; index++ {
		go func(index int) {
			body, _ := json.Marshal(map[string]string{"token": invitation.Token, "username": fmt.Sprintf("member-%d", index), "password": "another strong password"})
			request, _ := http.NewRequest(http.MethodPost, app.url("/api/v1/auth/register"), bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
			if err != nil {
				statuses <- 0
				return
			}
			response.Body.Close()
			statuses <- response.StatusCode
		}(index)
	}
	counts := map[int]int{}
	counts[<-statuses]++
	counts[<-statuses]++
	if counts[http.StatusCreated] != 1 || counts[http.StatusBadRequest] != 1 {
		t.Fatalf("concurrent Invitation results = %#v", counts)
	}
}

func TestChannelFrontendAndPersistentMessages(t *testing.T) {
	dataDirectory := t.TempDir()
	app := startInstance(t, dataDirectory)
	ownerClient := newClient(t)
	bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")
	invitation := createInvitation(t, ownerClient, app, 10, 1)
	memberClient := newClient(t)
	member := registerMember(t, memberClient, app, invitation.Token, "member", "another strong password")

	categoryResponse := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/categories"), map[string]any{"name": "General", "position": 0})
	var category map[string]any
	decodeResponse(t, categoryResponse, http.StatusCreated, &category)
	categoryID := category["id"].(string)
	categoryUpdate := requestJSON(t, ownerClient, http.MethodPatch, app.url("/api/v1/categories/"+categoryID), map[string]any{"name": "Community", "position": 1})
	decodeResponse(t, categoryUpdate, http.StatusOK, &category)
	channel := createChannel(t, ownerClient, app, categoryID, "general", "text", 0)
	voice := createChannel(t, ownerClient, app, categoryID, "Lounge", "voice", 1)
	if voice.Type != "voice" {
		t.Fatalf("voice Channel = %+v", voice)
	}
	channelUpdate := requestJSON(t, ownerClient, http.MethodPatch, app.url("/api/v1/channels/"+channel.ID), map[string]any{"category_id": categoryID, "name": "town-square", "type": "text", "position": 2})
	decodeResponse(t, channelUpdate, http.StatusOK, &map[string]any{})
	archiveCategory := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/categories/"+categoryID+"/archive"), map[string]string{})
	if archiveCategory.StatusCode != http.StatusNoContent {
		t.Fatalf("archive Category status = %d", archiveCategory.StatusCode)
	}
	archiveCategory.Body.Close()
	archivedOverview := getWithClient(t, ownerClient, app.url("/api/v1/channels"))
	var overview struct {
		Channels []channelView `json:"channels"`
	}
	decodeResponse(t, archivedOverview, http.StatusOK, &overview)
	if len(overview.Channels) != 0 {
		t.Fatalf("archived Category leaked active Channels: %+v", overview.Channels)
	}
	restoreCategory := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/categories/"+categoryID+"/restore"), map[string]string{})
	if restoreCategory.StatusCode != http.StatusNoContent {
		t.Fatalf("restore Category status = %d", restoreCategory.StatusCode)
	}
	restoreCategory.Body.Close()

	first := publishMessage(t, ownerClient, app, channel.ID, "Hello Community")
	second := publishMessage(t, ownerClient, app, channel.ID, "Second message")
	if first.Sequence != 1 || second.Sequence != 2 {
		t.Fatalf("Message sequences = %d, %d", first.Sequence, second.Sequence)
	}
	memberHistory := listMessages(t, memberClient, app, channel.ID)
	if len(memberHistory) != 2 {
		t.Fatalf("Member history length = %d", len(memberHistory))
	}

	deny := requestJSON(t, ownerClient, http.MethodPut, app.url("/api/v1/channels/"+channel.ID+"/overrides"), map[string]string{"role_id": "member", "permission": "view_channels", "effect": "deny"})
	if deny.StatusCode != http.StatusNoContent {
		t.Fatalf("deny override status = %d", deny.StatusCode)
	}
	deny.Body.Close()
	hidden := getWithClient(t, memberClient, app.url("/api/v1/channels/"+channel.ID+"/messages"))
	if hidden.StatusCode != http.StatusNotFound {
		t.Fatalf("hidden history status = %d", hidden.StatusCode)
	}
	hidden.Body.Close()
	allow := requestJSON(t, ownerClient, http.MethodPut, app.url("/api/v1/channels/"+channel.ID+"/overrides"), map[string]string{"role_id": "member", "permission": "view_channels", "effect": "allow"})
	if allow.StatusCode != http.StatusNoContent {
		t.Fatalf("allow override status = %d", allow.StatusCode)
	}
	allow.Body.Close()
	if len(listMessages(t, memberClient, app, channel.ID)) != 2 {
		t.Fatal("restored visibility did not expose retained history")
	}

	unauthorizedEdit := requestJSON(t, memberClient, http.MethodPatch, app.url("/api/v1/messages/"+first.ID), map[string]string{"body": "hijacked"})
	if unauthorizedEdit.StatusCode != http.StatusNotFound {
		t.Fatalf("non-author edit status = %d", unauthorizedEdit.StatusCode)
	}
	unauthorizedEdit.Body.Close()
	edited := requestJSON(t, ownerClient, http.MethodPatch, app.url("/api/v1/messages/"+first.ID), map[string]string{"body": "Hello, edited"})
	var editedMessage messageView
	decodeResponse(t, edited, http.StatusOK, &editedMessage)
	if editedMessage.EditedAt == "" || editedMessage.Body != "Hello, edited" {
		t.Fatalf("edited Message = %+v", editedMessage)
	}
	deleted := deleteJSON(t, ownerClient, app.url("/api/v1/messages/"+second.ID))
	if deleted.StatusCode != http.StatusNoContent {
		t.Fatalf("delete Message status = %d", deleted.StatusCode)
	}
	deleted.Body.Close()
	history := listMessages(t, ownerClient, app, channel.ID)
	if len(history) != 2 || !history[1].Deleted || history[1].Body != "" {
		t.Fatalf("history after deletion = %+v", history)
	}

	archive := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/archive"), map[string]string{})
	if archive.StatusCode != http.StatusNoContent {
		t.Fatalf("archive status = %d", archive.StatusCode)
	}
	archive.Body.Close()
	archivedWrite := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/messages"), map[string]string{"body": "not allowed"})
	if archivedWrite.StatusCode != http.StatusForbidden {
		t.Fatalf("archived write status = %d", archivedWrite.StatusCode)
	}
	archivedWrite.Body.Close()
	if len(listMessages(t, ownerClient, app, channel.ID)) != 2 {
		t.Fatal("archived history unavailable")
	}
	restore := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/restore"), map[string]string{})
	if restore.StatusCode != http.StatusNoContent {
		t.Fatalf("restore status = %d", restore.StatusCode)
	}
	restore.Body.Close()

	page := getWithClient(t, ownerClient, app.url("/channels/"+channel.ID))
	pageBody := readAll(t, page.Body)
	page.Body.Close()
	for _, expected := range []string{"Hello, edited", `name="body"`, `autocomplete="off"`, `id="header-search"`, `id="search-pane"`, `data-edit-message`, `id="editing-banner"`, `id="jump-to-present"`, `href="/assets/channel.css"`, `src="/assets/channel-scroll.js"`, `id="member-menu-toggle"`, `data-presence-mode="available"`, `data-presence-mode="dnd"`, `id="copy-member-id"`, `aria-label="User Settings"`, `>Switch Account</button>`, `createConversationFollower`, `conversationFollower.isFollowing()`} {
		if !strings.Contains(pageBody, expected) {
			t.Fatalf("channel page missing %q", expected)
		}
	}
	if page.StatusCode != http.StatusOK || strings.Contains(pageBody, `id="edit-`) {
		t.Fatalf("channel page missing chat UI: %d", page.StatusCode)
	}
	adminPage := getWithClient(t, ownerClient, app.url("/admin/channels"))
	adminBody := readAll(t, adminPage.Body)
	adminPage.Body.Close()
	if adminPage.StatusCode != http.StatusOK || !strings.Contains(adminBody, "town-square") {
		t.Fatal("channel management UI missing")
	}

	app.stop(t)
	app = startInstance(t, dataDirectory)
	if len(listMessages(t, ownerClient, app, channel.ID)) != 2 {
		t.Fatal("Message history did not survive restart")
	}

	confirmation := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/deletion-confirmation"), map[string]string{})
	var confirmationBody map[string]string
	decodeResponse(t, confirmation, http.StatusCreated, &confirmationBody)
	wrongDelete := requestJSON(t, ownerClient, http.MethodDelete, app.url("/api/v1/channels/"+channel.ID), map[string]string{"confirmation_token": "wrong"})
	if wrongDelete.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("wrong confirmation status = %d", wrongDelete.StatusCode)
	}
	wrongDelete.Body.Close()
	correctDelete := requestJSON(t, ownerClient, http.MethodDelete, app.url("/api/v1/channels/"+channel.ID), map[string]string{"confirmation_token": confirmationBody["confirmation_token"]})
	if correctDelete.StatusCode != http.StatusNoContent {
		t.Fatalf("confirmed delete status = %d body=%s", correctDelete.StatusCode, readAll(t, correctDelete.Body))
	}
	correctDelete.Body.Close()
	missing := getWithClient(t, ownerClient, app.url("/api/v1/channels/"+channel.ID+"/messages"))
	if missing.StatusCode != http.StatusNotFound {
		t.Fatalf("deleted Channel history status=%d", missing.StatusCode)
	}
	missing.Body.Close()
	_ = member
}

func TestConcurrentMessagesReceiveUniqueConversationSequences(t *testing.T) {
	app := startInstance(t, t.TempDir())
	client := newClient(t)
	bootstrapOwner(t, client, app, "owner", "correct horse battery staple")
	categoryResponse := requestJSON(t, client, http.MethodPost, app.url("/api/v1/categories"), map[string]any{"name": "General", "position": 0})
	var category map[string]any
	decodeResponse(t, categoryResponse, http.StatusCreated, &category)
	channel := createChannel(t, client, app, category["id"].(string), "general", "text", 0)

	type result struct {
		status   int
		sequence int64
	}
	results := make(chan result, 12)
	for index := 0; index < 12; index++ {
		go func(index int) {
			body, _ := json.Marshal(map[string]string{"body": fmt.Sprintf("concurrent %d", index)})
			request, _ := http.NewRequest(http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/messages"), bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			addCSRFHeader(client, request)
			response, err := client.Do(request)
			if err != nil {
				results <- result{}
				return
			}
			var message messageView
			_ = json.NewDecoder(response.Body).Decode(&message)
			response.Body.Close()
			results <- result{status: response.StatusCode, sequence: message.Sequence}
		}(index)
	}
	seen := map[int64]bool{}
	for index := 0; index < 12; index++ {
		item := <-results
		if item.status != http.StatusCreated || item.sequence < 1 || item.sequence > 12 || seen[item.sequence] {
			t.Fatalf("invalid concurrent Message result: %+v seen=%v", item, seen)
		}
		seen[item.sequence] = true
	}
	history := listMessages(t, client, app, channel.ID)
	if len(history) != 12 {
		t.Fatalf("concurrent history length = %d", len(history))
	}
	for index, message := range history {
		if message.Sequence != int64(index+1) {
			t.Fatalf("history sequence at %d = %d", index, message.Sequence)
		}
	}
}

func TestRealtimeEventsResumeConvergeAndRespectVisibility(t *testing.T) {
	app := startInstance(t, t.TempDir())
	ownerClient := newClient(t)
	bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")
	invitation := createInvitation(t, ownerClient, app, 10, 1)
	memberClient := newClient(t)
	registerMember(t, memberClient, app, invitation.Token, "member", "another strong password")
	categoryResponse := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/categories"), map[string]any{"name": "General", "position": 0})
	var category map[string]any
	decodeResponse(t, categoryResponse, http.StatusCreated, &category)
	channel := createChannel(t, ownerClient, app, category["id"].(string), "general", "text", 0)
	avatarPNG := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13, 'I', 'H', 'D', 'R', 0, 0, 0, 1, 0, 0, 0, 1}
	avatarResponse := requestBytes(t, ownerClient, http.MethodPut, app.url("/api/v1/profile/avatar"), "image/png", avatarPNG)
	if avatarResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("set realtime author avatar status = %d", avatarResponse.StatusCode)
	}
	avatarResponse.Body.Close()

	stream := dialRealtime(t, ownerClient, app, "0")
	ready := readRealtime(t, stream)
	if ready.Type != "ready" || ready.Cursor != 0 {
		t.Fatalf("initial realtime frame = %+v", ready)
	}
	createdMessage := publishMessage(t, ownerClient, app, channel.ID, "created while connected")
	created := readRealtimeType(t, stream, "message.created")
	if created.Type != "message.created" || created.ChannelID != channel.ID {
		t.Fatalf("created realtime frame = %+v", created)
	}
	var eventMessage messageView
	if err := json.Unmarshal(created.Payload, &eventMessage); err != nil || eventMessage.ID != createdMessage.ID || eventMessage.AuthorAvatarURL == "" {
		t.Fatalf("created realtime payload = %s error=%v", created.Payload, err)
	}
	stream.CloseNow()

	editedResponse := requestJSON(t, ownerClient, http.MethodPatch, app.url("/api/v1/messages/"+createdMessage.ID), map[string]string{"body": "edited while disconnected"})
	decodeResponse(t, editedResponse, http.StatusOK, &eventMessage)
	resumed := dialRealtime(t, ownerClient, app, strconv.FormatInt(created.Cursor, 10))
	resumeReady := readRealtime(t, resumed)
	if resumeReady.Type != "ready" || resumeReady.Cursor != created.Cursor {
		t.Fatalf("resume ready frame = %+v", resumeReady)
	}
	edited := readRealtimeType(t, resumed, "message.edited")
	if edited.Type != "message.edited" || edited.Cursor <= created.Cursor {
		t.Fatalf("resumed edit frame = %+v", edited)
	}
	if err := json.Unmarshal(edited.Payload, &eventMessage); err != nil || eventMessage.Body != "edited while disconnected" {
		t.Fatalf("edit payload = %s error=%v", edited.Payload, err)
	}
	deletedResponse := deleteJSON(t, ownerClient, app.url("/api/v1/messages/"+createdMessage.ID))
	if deletedResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("delete Message status = %d", deletedResponse.StatusCode)
	}
	deletedResponse.Body.Close()
	deleted := readRealtimeType(t, resumed, "message.deleted")
	if deleted.Type != "message.deleted" || deleted.Cursor <= edited.Cursor {
		t.Fatalf("delete realtime frame = %+v", deleted)
	}
	eventMessage = messageView{}
	if err := json.Unmarshal(deleted.Payload, &eventMessage); err != nil || !eventMessage.Deleted || eventMessage.Body != "" {
		t.Fatalf("delete payload retained content: %s error=%v", deleted.Payload, err)
	}
	resumed.CloseNow()

	history := listMessages(t, ownerClient, app, channel.ID)
	if len(history) != 1 || !history[0].Deleted || history[0].Body != "" {
		t.Fatalf("HTTP history and realtime state diverged: history=%+v realtime=%+v", history, eventMessage)
	}

	expired := dialRealtime(t, ownerClient, app, "999999999")
	snapshotRequired := readRealtime(t, expired)
	if snapshotRequired.Type != "snapshot_required" || snapshotRequired.Snapshot == nil || snapshotRequired.Snapshot.Cursor != snapshotRequired.Cursor {
		t.Fatalf("snapshot-required frame = %+v", snapshotRequired)
	}
	if len(snapshotRequired.Snapshot.Messages[channel.ID]) != 1 {
		t.Fatalf("authorized snapshot missing history: %+v", snapshotRequired.Snapshot)
	}
	expired.CloseNow()

	memberStream := dialRealtime(t, memberClient, app, "")
	_ = readRealtime(t, memberStream)
	denied := requestJSON(t, ownerClient, http.MethodPut, app.url("/api/v1/channels/"+channel.ID+"/overrides"), map[string]string{"role_id": "member", "permission": "view_channels", "effect": "deny"})
	if denied.StatusCode != http.StatusNoContent {
		t.Fatalf("deny visibility status = %d", denied.StatusCode)
	}
	denied.Body.Close()
	removed := readRealtimeType(t, memberStream, "channel.removed")
	if removed.Type != "channel.removed" || removed.ChannelID != channel.ID {
		t.Fatalf("permission-loss frame = %+v", removed)
	}
	publishMessage(t, ownerClient, app, channel.ID, "must remain hidden")
	filtered := readRealtimeType(t, memberStream, "cursor")
	if filtered.Type != "cursor" || filtered.ChannelID != "" || len(filtered.Payload) != 0 {
		t.Fatalf("hidden activity leaked through realtime: %+v", filtered)
	}
	memberStream.CloseNow()
}

func TestPresenceReadPositionsAndTypingSynchronize(t *testing.T) {
	app := startInstance(t, t.TempDir())
	ownerClient := newClient(t)
	owner := bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")
	secondOwnerClient := newClient(t)
	loginWithDevice(t, secondOwnerClient, app, "owner", "correct horse battery staple", "Second browser")
	invitation := createInvitation(t, ownerClient, app, 10, 1)
	memberClient := newClient(t)
	member := registerMember(t, memberClient, app, invitation.Token, "member", "another strong password")
	categoryResponse := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/categories"), map[string]any{"name": "General", "position": 0})
	var category map[string]any
	decodeResponse(t, categoryResponse, http.StatusCreated, &category)
	channel := createChannel(t, ownerClient, app, category["id"].(string), "general", "text", 0)
	first := publishMessage(t, ownerClient, app, channel.ID, "one")
	second := publishMessage(t, ownerClient, app, channel.ID, "two")

	ownerStream := dialRealtime(t, ownerClient, app, "")
	_ = readRealtime(t, ownerStream)
	writeRealtimeCommand(t, ownerStream, map[string]any{"type": "heartbeat"})
	secondStream := dialRealtime(t, secondOwnerClient, app, "")
	_ = readRealtime(t, secondStream)
	writeRealtimeCommand(t, secondStream, map[string]any{"type": "heartbeat"})
	memberStream := dialRealtime(t, memberClient, app, "")
	_ = readRealtime(t, memberStream)
	presence := readRealtimeType(t, memberStream, "state.ephemeral")
	var ephemeral struct {
		Presence map[string]string `json:"presence"`
		Typing   []struct {
			MemberID  string `json:"member_id"`
			ChannelID string `json:"channel_id"`
		} `json:"typing"`
	}
	if err := json.Unmarshal(presence.Payload, &ephemeral); err != nil || ephemeral.Presence[owner["id"].(string)] != "online" {
		t.Fatalf("aggregate Presence = %s error=%v", presence.Payload, err)
	}

	positionResponse := requestJSON(t, ownerClient, http.MethodPut, app.url("/api/v1/channels/"+channel.ID+"/read-position"), map[string]int64{"sequence": second.Sequence})
	var position struct {
		ReadSequence int64 `json:"read_sequence"`
		Unread       int64 `json:"unread"`
	}
	decodeResponse(t, positionResponse, http.StatusOK, &position)
	regressionResponse := requestJSON(t, secondOwnerClient, http.MethodPut, app.url("/api/v1/channels/"+channel.ID+"/read-position"), map[string]int64{"sequence": first.Sequence})
	decodeResponse(t, regressionResponse, http.StatusOK, &position)
	if position.ReadSequence != second.Sequence || position.Unread != 0 {
		t.Fatalf("Read Position regressed across Sessions: %+v", position)
	}
	if frame := readRealtimeType(t, secondStream, "read.updated"); frame.ChannelID != channel.ID {
		t.Fatalf("read-position realtime frame = %+v", frame)
	}
	writeRealtimeCommand(t, ownerStream, map[string]any{"type": "activity", "active": false})
	writeRealtimeCommand(t, secondStream, map[string]any{"type": "activity", "active": false})
	idleFrame := readRealtimeType(t, memberStream, "state.ephemeral")
	if err := json.Unmarshal(idleFrame.Payload, &ephemeral); err != nil || ephemeral.Presence[owner["id"].(string)] != "idle" {
		t.Fatalf("multi-device idle Presence = %s error=%v", idleFrame.Payload, err)
	}
	writeRealtimeCommand(t, ownerStream, map[string]any{"type": "activity", "active": true})

	writeRealtimeCommand(t, ownerStream, map[string]any{"type": "typing", "channel_id": channel.ID})
	typing := readRealtimeType(t, memberStream, "state.ephemeral")
	if err := json.Unmarshal(typing.Payload, &ephemeral); err != nil || len(ephemeral.Typing) != 1 || ephemeral.Typing[0].MemberID != owner["id"].(string) {
		t.Fatalf("typing state = %s error=%v", typing.Payload, err)
	}
	dnd := requestJSON(t, ownerClient, http.MethodPut, app.url("/api/v1/presence-mode"), map[string]string{"mode": "dnd"})
	if dnd.StatusCode != http.StatusOK {
		t.Fatalf("DND status = %d", dnd.StatusCode)
	}
	dnd.Body.Close()
	dndFrame := readRealtimeType(t, memberStream, "state.ephemeral")
	if err := json.Unmarshal(dndFrame.Payload, &ephemeral); err != nil || ephemeral.Presence[owner["id"].(string)] != "dnd" {
		t.Fatalf("DND Presence = %s error=%v", dndFrame.Payload, err)
	}
	writeRealtimeCommand(t, ownerStream, map[string]any{"type": "disconnect"})
	time.Sleep(300 * time.Millisecond)
	_ = ownerStream.Close(websocket.StatusNormalClosure, "device closed")
	stillOnline := readRealtimeType(t, memberStream, "state.ephemeral")
	if err := json.Unmarshal(stillOnline.Payload, &ephemeral); err != nil || ephemeral.Presence[owner["id"].(string)] != "dnd" {
		t.Fatalf("one-device disconnect flickered Presence: %s", stillOnline.Payload)
	}
	writeRealtimeCommand(t, secondStream, map[string]any{"type": "disconnect"})
	time.Sleep(300 * time.Millisecond)
	_ = secondStream.Close(websocket.StatusNormalClosure, "device closed")
	memberStream.CloseNow()
	_ = member

	page := getWithClient(t, ownerClient, app.url("/channels/"+channel.ID))
	pageBody := readAll(t, page.Body)
	page.Body.Close()
	if !strings.Contains(pageBody, "Enable notifications") || !strings.Contains(pageBody, "Notification.requestPermission") {
		t.Fatal("embedded client lacks deliberate browser-notification control")
	}
}

func TestRichMessagesRemainStructuredSafeAndDurable(t *testing.T) {
	dataDirectory := t.TempDir()
	app := startInstance(t, dataDirectory)
	ownerClient := newClient(t)
	bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")
	invitation := createInvitation(t, ownerClient, app, 10, 1)
	memberClient := newClient(t)
	member := registerMember(t, memberClient, app, invitation.Token, "member", "another strong password")
	categoryResponse := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/categories"), map[string]any{"name": "General", "position": 0})
	var category map[string]any
	decodeResponse(t, categoryResponse, http.StatusCreated, &category)
	channel := createChannel(t, ownerClient, app, category["id"].(string), "general", "text", 0)
	other := createChannel(t, ownerClient, app, category["id"].(string), "other", "text", 1)
	parent := publishMessage(t, ownerClient, app, channel.ID, "parent")
	foreign := publishMessage(t, ownerClient, app, other.ID, "foreign")

	stream := dialRealtime(t, ownerClient, app, "")
	_ = readRealtime(t, stream)
	richResponse := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/messages"), map[string]any{
		"body": "<script>alert(1)</script> **bold**", "reply_to": parent.ID, "mention_ids": []string{member.ID},
	})
	var rich struct {
		messageView
		RenderedHTML string `json:"rendered_html"`
		Reply        *struct {
			MessageID string `json:"message_id"`
		} `json:"reply"`
		Mentions []struct {
			MemberID string `json:"member_id"`
			Username string `json:"username"`
		} `json:"mentions"`
	}
	decodeResponse(t, richResponse, http.StatusCreated, &rich)
	if strings.Contains(rich.RenderedHTML, "<script>") || !strings.Contains(rich.RenderedHTML, "&lt;script&gt;") || !strings.Contains(rich.RenderedHTML, "<strong>bold</strong>") {
		t.Fatalf("unsafe or missing Markdown rendering: %q", rich.RenderedHTML)
	}
	if rich.Reply == nil || rich.Reply.MessageID != parent.ID || len(rich.Mentions) != 1 || rich.Mentions[0].MemberID != member.ID {
		t.Fatalf("structured Message data = %+v", rich)
	}
	_ = readRealtimeType(t, stream, "message.created")
	crossReply := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/messages"), map[string]any{"body": "bad reply", "reply_to": foreign.ID})
	if crossReply.StatusCode != http.StatusNotFound {
		t.Fatalf("cross-conversation Reply status = %d", crossReply.StatusCode)
	}
	crossReply.Body.Close()

	for attempts := 0; attempts < 2; attempts++ {
		reaction := requestJSON(t, memberClient, http.MethodPut, app.url("/api/v1/messages/"+rich.ID+"/reactions"), map[string]string{"emoji": "👍"})
		if reaction.StatusCode != http.StatusNoContent {
			t.Fatalf("Reaction status = %d", reaction.StatusCode)
		}
		reaction.Body.Close()
	}
	if frame := readRealtimeType(t, stream, "reaction.updated"); frame.ChannelID != channel.ID {
		t.Fatalf("Reaction realtime frame = %+v", frame)
	}
	pin := requestJSON(t, ownerClient, http.MethodPut, app.url("/api/v1/messages/"+rich.ID+"/pin"), map[string]string{})
	if pin.StatusCode != http.StatusNoContent {
		t.Fatalf("pin status = %d", pin.StatusCode)
	}
	pin.Body.Close()
	_ = readRealtimeType(t, stream, "pin.updated")
	stream.CloseNow()

	profileResponse := requestJSON(t, memberClient, http.MethodPatch, app.url("/api/v1/profile"), map[string]string{"username": "renamed-member", "display_name": "Renamed"})
	profileResponse.Body.Close()
	app.stop(t)
	app = startInstance(t, dataDirectory)
	pins := getWithClient(t, ownerClient, app.url("/api/v1/channels/"+channel.ID+"/pins"))
	var pinned struct {
		Messages []json.RawMessage `json:"messages"`
	}
	decodeResponse(t, pins, http.StatusOK, &pinned)
	if len(pinned.Messages) != 1 || !bytes.Contains(pinned.Messages[0], []byte(`"username":"renamed-member"`)) || !bytes.Contains(pinned.Messages[0], []byte(`"count":1`)) {
		t.Fatalf("rich interactions did not survive restart: %s", pinned.Messages)
	}
}

func TestAttachmentsPublishSafelyAndRequireMessageAuthorization(t *testing.T) {
	dataDirectory := t.TempDir()
	app := startInstance(t, dataDirectory)
	client := newClient(t)
	bootstrapOwner(t, client, app, "owner", "correct horse battery staple")
	categoryResponse := requestJSON(t, client, http.MethodPost, app.url("/api/v1/categories"), map[string]any{"name": "General", "position": 0})
	var category map[string]any
	decodeResponse(t, categoryResponse, http.StatusCreated, &category)
	channel := createChannel(t, client, app, category["id"].(string), "general", "text", 0)
	content := []byte("attachment bytes")
	attachment := uploadAttachment(t, client, app, "../../unsafe.html", "text/html", content)
	quarantined := getWithClient(t, client, app.url("/api/v1/attachments/"+attachment.ID))
	if quarantined.StatusCode != http.StatusNotFound {
		t.Fatalf("quarantined Attachment status = %d", quarantined.StatusCode)
	}
	quarantined.Body.Close()
	publishedResponse := requestJSON(t, client, http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/messages"), map[string]any{"body": "with file", "attachment_ids": []string{attachment.ID}})
	var published messageView
	decodeResponse(t, publishedResponse, http.StatusCreated, &published)
	image := uploadAttachment(t, client, app, "preview.png", "image/png", []byte("not-a-decoded-image"))
	imageMessageResponse := requestJSON(t, client, http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/messages"), map[string]any{"body": "with image", "attachment_ids": []string{image.ID}})
	var imageMessage messageView
	decodeResponse(t, imageMessageResponse, http.StatusCreated, &imageMessage)
	channelPage := getWithClient(t, client, app.url("/channels/"+channel.ID))
	channelHTML := readAll(t, channelPage.Body)
	channelPage.Body.Close()
	if channelPage.StatusCode != http.StatusOK || !strings.Contains(channelHTML, `class="message-image"`) || !strings.Contains(channelHTML, `alt="preview.png"`) {
		t.Fatalf("image Attachment was not rendered inline: status=%d", channelPage.StatusCode)
	}
	download := getWithClient(t, client, app.url("/api/v1/attachments/"+attachment.ID))
	downloaded := readAll(t, download.Body)
	download.Body.Close()
	if download.StatusCode != http.StatusOK || downloaded != string(content) || download.Header.Get("Content-Type") != "application/octet-stream" || download.Header.Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(download.Header.Get("Content-Disposition"), "attachment") || strings.Contains(download.Header.Get("Content-Disposition"), "..") {
		t.Fatalf("unsafe Attachment download: status=%d headers=%v body=%q", download.StatusCode, download.Header, downloaded)
	}
	app.stop(t)
	app = startInstance(t, dataDirectory)
	persisted := getWithClient(t, client, app.url("/api/v1/attachments/"+attachment.ID))
	if persisted.StatusCode != http.StatusOK {
		t.Fatalf("Attachment unavailable after restart: %d", persisted.StatusCode)
	}
	persisted.Body.Close()
	deleted := deleteJSON(t, client, app.url("/api/v1/messages/"+published.ID))
	deleted.Body.Close()
	unreferenced := getWithClient(t, client, app.url("/api/v1/attachments/"+attachment.ID))
	if unreferenced.StatusCode != http.StatusNotFound {
		t.Fatalf("deleted Message Attachment remained visible: %d", unreferenced.StatusCode)
	}
	unreferenced.Body.Close()

	orphan := uploadAttachment(t, client, app, "orphan.txt", "text/plain", []byte("orphan"))
	failed := requestJSON(t, client, http.MethodPost, app.url("/api/v1/channels/"+channel.ID+"/messages"), map[string]any{"body": "invalid", "reply_to": "missing", "attachment_ids": []string{orphan.ID}})
	if failed.StatusCode != http.StatusNotFound {
		t.Fatalf("failed Message status = %d", failed.StatusCode)
	}
	failed.Body.Close()
	orphanDownload := getWithClient(t, client, app.url("/api/v1/attachments/"+orphan.ID))
	if orphanDownload.StatusCode != http.StatusNotFound {
		t.Fatalf("failed Message published Attachment: %d", orphanDownload.StatusCode)
	}
	orphanDownload.Body.Close()
}

func TestSearchReturnsOnlyCurrentlyAuthorizedRetainedMessages(t *testing.T) {
	dataDirectory := t.TempDir()
	app := startInstance(t, dataDirectory)
	ownerClient := newClient(t)
	bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")
	invitation := createInvitation(t, ownerClient, app, 10, 1)
	memberClient := newClient(t)
	registerMember(t, memberClient, app, invitation.Token, "member", "another strong password")
	categoryResponse := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/categories"), map[string]any{"name": "General", "position": 0})
	var category map[string]any
	decodeResponse(t, categoryResponse, http.StatusCreated, &category)
	visibleChannel := createChannel(t, ownerClient, app, category["id"].(string), "visible", "text", 0)
	hiddenChannel := createChannel(t, ownerClient, app, category["id"].(string), "hidden", "text", 1)
	visibleMessage := publishMessage(t, ownerClient, app, visibleChannel.ID, "needlemagic visible <b>safe</b>")
	hiddenMessage := publishMessage(t, ownerClient, app, hiddenChannel.ID, "needlemagic hidden secret")

	deny := requestJSON(t, ownerClient, http.MethodPut, app.url("/api/v1/channels/"+hiddenChannel.ID+"/overrides"), map[string]string{"role_id": "member", "permission": "view_channels", "effect": "deny"})
	if deny.StatusCode != http.StatusNoContent {
		t.Fatalf("deny hidden Channel status = %d", deny.StatusCode)
	}
	deny.Body.Close()
	memberResults := searchMessages(t, memberClient, app, "needlemagic")
	if len(memberResults) != 1 || memberResults[0].Message.ID != visibleMessage.ID || strings.Contains(memberResults[0].Snippet, "secret") {
		t.Fatalf("search leaked hidden content: %+v", memberResults)
	}
	ownerResults := searchMessages(t, ownerClient, app, "needlemagic")
	if len(ownerResults) != 2 {
		t.Fatalf("Owner search results = %+v", ownerResults)
	}
	pageMessages := []messageView{
		publishMessage(t, ownerClient, app, visibleChannel.ID, "pageterm first"),
		publishMessage(t, ownerClient, app, visibleChannel.ID, "pageterm second"),
		publishMessage(t, ownerClient, app, visibleChannel.ID, "pageterm third"),
	}
	firstPageResponse := getWithClient(t, memberClient, app.url("/api/v1/search?q=pageterm&limit=2"))
	var firstPage struct {
		Results    []searchResultView `json:"results"`
		NextCursor string             `json:"next_cursor"`
	}
	decodeResponse(t, firstPageResponse, http.StatusOK, &firstPage)
	if len(firstPage.Results) != 2 || firstPage.NextCursor == "" {
		t.Fatalf("first search page = %+v", firstPage)
	}
	publishMessage(t, ownerClient, app, visibleChannel.ID, "pageterm concurrent newer")
	secondPageResponse := getWithClient(t, memberClient, app.url("/api/v1/search?q=pageterm&limit=2&cursor="+url.QueryEscape(firstPage.NextCursor)))
	var secondPage struct {
		Results []searchResultView `json:"results"`
	}
	decodeResponse(t, secondPageResponse, http.StatusOK, &secondPage)
	if len(secondPage.Results) != 1 {
		t.Fatalf("second stable search page = %+v", secondPage)
	}
	seenPageIDs := map[string]bool{}
	for _, result := range append(firstPage.Results, secondPage.Results...) {
		if seenPageIDs[result.Message.ID] {
			t.Fatalf("search pagination duplicated Message %s", result.Message.ID)
		}
		seenPageIDs[result.Message.ID] = true
	}
	for _, message := range pageMessages {
		if !seenPageIDs[message.ID] {
			t.Fatalf("search pagination skipped retained Message %s", message.ID)
		}
	}
	archiveVisible := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/channels/"+visibleChannel.ID+"/archive"), map[string]string{})
	archiveVisible.Body.Close()
	if results := searchMessages(t, memberClient, app, "replacementterm"); len(results) != 0 {
		t.Fatalf("replacement term existed before edit: %+v", results)
	}
	if results := searchMessages(t, memberClient, app, "pageterm first"); len(results) != 1 {
		t.Fatalf("archived visible Channel was not searchable: %+v", results)
	}
	restoreVisible := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/channels/"+visibleChannel.ID+"/restore"), map[string]string{})
	restoreVisible.Body.Close()

	edited := requestJSON(t, ownerClient, http.MethodPatch, app.url("/api/v1/messages/"+visibleMessage.ID), map[string]string{"body": "replacementterm after edit"})
	if edited.StatusCode != http.StatusOK {
		t.Fatalf("edit searchable Message status = %d", edited.StatusCode)
	}
	edited.Body.Close()
	if results := searchMessages(t, ownerClient, app, "needlemagic visible"); len(results) != 0 {
		t.Fatalf("old edited content remained searchable: %+v", results)
	}
	if results := searchMessages(t, memberClient, app, "replacementterm"); len(results) != 1 || results[0].Message.ID != visibleMessage.ID {
		t.Fatalf("edited content was not indexed: %+v", results)
	}
	deleted := deleteJSON(t, ownerClient, app.url("/api/v1/messages/"+hiddenMessage.ID))
	if deleted.StatusCode != http.StatusNoContent {
		t.Fatalf("delete searchable Message status = %d", deleted.StatusCode)
	}
	deleted.Body.Close()
	if results := searchMessages(t, ownerClient, app, "hidden secret"); len(results) != 0 {
		t.Fatalf("deleted content remained searchable: %+v", results)
	}
	if response := getWithClient(t, ownerClient, app.url("/api/v1/search?q="+url.QueryEscape(`" OR *`))); response.StatusCode >= 500 {
		response.Body.Close()
		t.Fatalf("search syntax caused server failure: %d", response.StatusCode)
	} else {
		response.Body.Close()
	}

	page := getWithClient(t, memberClient, app.url("/search?q="+url.QueryEscape("replacementterm")))
	pageBody := readAll(t, page.Body)
	page.Body.Close()
	if page.StatusCode != http.StatusOK || !strings.Contains(pageBody, "/channels/"+visibleChannel.ID+"#message-"+visibleMessage.ID) {
		t.Fatalf("embedded search page missing conversation link: status=%d body=%s", page.StatusCode, pageBody)
	}
	app.stop(t)
	app = startInstance(t, dataDirectory)
	if results := searchMessages(t, memberClient, app, "replacementterm"); len(results) != 1 || results[0].Message.ID != visibleMessage.ID {
		t.Fatalf("search index did not survive restart: %+v", results)
	}
}

func TestDirectMessagesRemainPrivateUniqueAndBlockNewInteraction(t *testing.T) {
	dataDirectory := t.TempDir()
	app := startInstance(t, dataDirectory)
	ownerClient := newClient(t)
	owner := bootstrapOwner(t, ownerClient, app, "owner", "correct horse battery staple")
	ownerID := owner["id"].(string)
	invitation := createInvitation(t, ownerClient, app, 10, 2)
	memberClient := newClient(t)
	member := registerMember(t, memberClient, app, invitation.Token, "member", "another strong password")
	outsiderClient := newClient(t)
	registerMember(t, outsiderClient, app, invitation.Token, "outsider", "outsider strong password")

	type result struct {
		status int
		item   directMessageView
	}
	results := make(chan result, 2)
	open := func(client *http.Client, otherID string) {
		response := requestJSON(t, client, http.MethodPost, app.url("/api/v1/dms"), map[string]string{"member_id": otherID})
		var item directMessageView
		status := response.StatusCode
		if status == http.StatusCreated {
			_ = json.NewDecoder(response.Body).Decode(&item)
		}
		response.Body.Close()
		results <- result{status: status, item: item}
	}
	go open(ownerClient, member.ID)
	go open(memberClient, ownerID)
	first, second := <-results, <-results
	if first.status != http.StatusCreated || second.status != http.StatusCreated || first.item.ID == "" || first.item.ID != second.item.ID {
		t.Fatalf("concurrent Direct Message creation = %+v / %+v", first, second)
	}
	dmID := first.item.ID
	home := getWithClient(t, ownerClient, app.url("/"))
	homeBody := readAll(t, home.Body)
	home.Body.Close()
	if home.StatusCode != http.StatusOK || !strings.Contains(homeBody, `value="`+member.ID+`"`) || !strings.Contains(homeBody, `/channels/`+dmID) {
		t.Fatalf("Direct Message discovery UI status/body = %d %q", home.StatusCode, homeBody)
	}
	for _, expected := range []string{`data-community-menu-toggle`, `data-community-menu`, `id="member-menu-toggle"`, `aria-label="User Settings"`} {
		if !strings.Contains(homeBody, expected) {
			t.Fatalf("home shell missing %q", expected)
		}
	}
	for _, legacy := range []string{`class="sidebar-footer"`, `>Manage channels</a>`} {
		if strings.Contains(homeBody, legacy) {
			t.Fatalf("home shell contains legacy navigation %q", legacy)
		}
	}
	dmPage := getWithClient(t, ownerClient, app.url("/channels/"+dmID))
	dmPageBody := readAll(t, dmPage.Body)
	dmPage.Body.Close()
	for _, expected := range []string{"Direct Message", member.Username, `action="/dms/` + dmID + `/block"`, `class="dm-link"`} {
		if dmPage.StatusCode != http.StatusOK || !strings.Contains(dmPageBody, expected) {
			t.Fatalf("Direct Message page missing %q: status=%d", expected, dmPage.StatusCode)
		}
	}
	outsiderPage := getWithClient(t, outsiderClient, app.url("/channels/"+dmID))
	if outsiderPage.StatusCode != http.StatusNotFound {
		t.Fatalf("non-participant Direct Message page status = %d", outsiderPage.StatusCode)
	}
	outsiderPage.Body.Close()

	outsiderRead := getWithClient(t, outsiderClient, app.url("/api/v1/dms/"+dmID+"/messages"))
	if outsiderRead.StatusCode != http.StatusNotFound {
		t.Fatalf("non-participant Direct Message history status = %d", outsiderRead.StatusCode)
	}
	outsiderRead.Body.Close()
	ownerMessageResponse := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/dms/"+dmID+"/messages"), map[string]string{"body": "private hello"})
	var ownerMessage messageView
	decodeResponse(t, ownerMessageResponse, http.StatusCreated, &ownerMessage)
	replyResponse := requestJSON(t, memberClient, http.MethodPost, app.url("/api/v1/dms/"+dmID+"/messages"), map[string]any{
		"body": "private reply", "reply_to": ownerMessage.ID, "mention_ids": []string{ownerID},
	})
	var reply messageView
	decodeResponse(t, replyResponse, http.StatusCreated, &reply)

	reaction := requestJSON(t, ownerClient, http.MethodPut, app.url("/api/v1/messages/"+reply.ID+"/reactions"), map[string]string{"emoji": "👍"})
	if reaction.StatusCode != http.StatusNoContent {
		t.Fatalf("Direct Message Reaction status = %d", reaction.StatusCode)
	}
	reaction.Body.Close()
	pin := requestJSON(t, memberClient, http.MethodPut, app.url("/api/v1/messages/"+ownerMessage.ID+"/pin"), map[string]string{})
	if pin.StatusCode != http.StatusNoContent {
		t.Fatalf("pin Direct Message status = %d", pin.StatusCode)
	}
	pin.Body.Close()
	read := requestJSON(t, memberClient, http.MethodPut, app.url("/api/v1/dms/"+dmID+"/read-position"), map[string]int64{"sequence": reply.Sequence})
	if read.StatusCode != http.StatusOK {
		t.Fatalf("Direct Message Read Position status = %d", read.StatusCode)
	}
	read.Body.Close()
	participantStream := dialRealtime(t, ownerClient, app, "0")
	_ = readRealtime(t, participantStream)
	participantEvent := readRealtimeType(t, participantStream, "message.created")
	if participantEvent.ChannelID != dmID {
		t.Fatalf("participant realtime Direct Message event = %+v", participantEvent)
	}
	participantStream.CloseNow()
	outsiderStream := dialRealtime(t, outsiderClient, app, "0")
	_ = readRealtime(t, outsiderStream)
	advancedWithoutLeak := false
	for attempts := 0; attempts < 20; attempts++ {
		frame := readRealtime(t, outsiderStream)
		if frame.ChannelID == dmID || bytes.Contains(frame.Payload, []byte("private hello")) {
			t.Fatalf("Direct Message event leaked to non-participant: %+v", frame)
		}
		if frame.Type == "cursor" {
			advancedWithoutLeak = true
			break
		}
	}
	outsiderStream.CloseNow()
	if !advancedWithoutLeak {
		t.Fatal("non-participant realtime cursor did not advance past private events")
	}

	ownerSnapshot := getWithClient(t, ownerClient, app.url("/api/v1/realtime/snapshot"))
	ownerSnapshotBody := readAll(t, ownerSnapshot.Body)
	ownerSnapshot.Body.Close()
	outsiderSnapshot := getWithClient(t, outsiderClient, app.url("/api/v1/realtime/snapshot"))
	outsiderSnapshotBody := readAll(t, outsiderSnapshot.Body)
	outsiderSnapshot.Body.Close()
	if !strings.Contains(ownerSnapshotBody, dmID) || strings.Contains(outsiderSnapshotBody, dmID) || strings.Contains(outsiderSnapshotBody, "private hello") {
		t.Fatalf("Direct Message snapshot privacy failed: owner=%s outsider=%s", ownerSnapshotBody, outsiderSnapshotBody)
	}

	block := requestJSON(t, memberClient, http.MethodPut, app.url("/api/v1/blocks/"+ownerID), map[string]string{})
	if block.StatusCode != http.StatusNoContent {
		t.Fatalf("Block status = %d", block.StatusCode)
	}
	block.Body.Close()
	blockedPage := getWithClient(t, memberClient, app.url("/channels/"+dmID))
	blockedPageBody := readAll(t, blockedPage.Body)
	blockedPage.Body.Close()
	if blockedPage.StatusCode != http.StatusOK || !strings.Contains(blockedPageBody, "cannot send new Messages") || !strings.Contains(blockedPageBody, `/unblock`) {
		t.Fatalf("blocked Direct Message UI status/body = %d %q", blockedPage.StatusCode, blockedPageBody)
	}
	for name, client := range map[string]*http.Client{"blocker": memberClient, "blocked": ownerClient} {
		blockedPost := requestJSON(t, client, http.MethodPost, app.url("/api/v1/dms/"+dmID+"/messages"), map[string]string{"body": "must not publish"})
		if blockedPost.StatusCode != http.StatusForbidden {
			t.Fatalf("%s Message while blocked status = %d", name, blockedPost.StatusCode)
		}
		blockedPost.Body.Close()
	}
	blockedReaction := requestJSON(t, ownerClient, http.MethodPut, app.url("/api/v1/messages/"+reply.ID+"/reactions"), map[string]string{"emoji": "🎉"})
	if blockedReaction.StatusCode != http.StatusForbidden {
		t.Fatalf("Reaction while blocked status = %d", blockedReaction.StatusCode)
	}
	blockedReaction.Body.Close()
	retained := getWithClient(t, memberClient, app.url("/api/v1/dms/"+dmID+"/messages"))
	var retainedBody struct {
		Messages []messageView `json:"messages"`
	}
	decodeResponse(t, retained, http.StatusOK, &retainedBody)
	if len(retainedBody.Messages) != 2 {
		t.Fatalf("retained Direct Message history = %+v", retainedBody.Messages)
	}
	edit := requestJSON(t, ownerClient, http.MethodPatch, app.url("/api/v1/messages/"+ownerMessage.ID), map[string]string{"body": "private hello edited"})
	if edit.StatusCode != http.StatusOK {
		t.Fatalf("retained Message edit while blocked status = %d", edit.StatusCode)
	}
	edit.Body.Close()
	unblock := deleteJSON(t, memberClient, app.url("/api/v1/blocks/"+ownerID))
	if unblock.StatusCode != http.StatusNoContent {
		t.Fatalf("unblock status = %d", unblock.StatusCode)
	}
	unblock.Body.Close()
	afterUnblock := requestJSON(t, ownerClient, http.MethodPost, app.url("/api/v1/dms/"+dmID+"/messages"), map[string]string{"body": "interaction restored"})
	if afterUnblock.StatusCode != http.StatusCreated {
		t.Fatalf("Message after unblock status = %d", afterUnblock.StatusCode)
	}
	afterUnblock.Body.Close()
	deletedReply := deleteJSON(t, memberClient, app.url("/api/v1/messages/"+reply.ID))
	if deletedReply.StatusCode != http.StatusNoContent {
		t.Fatalf("delete Direct Message status = %d", deletedReply.StatusCode)
	}
	deletedReply.Body.Close()

	list := getWithClient(t, ownerClient, app.url("/api/v1/dms"))
	var listed struct {
		DirectMessages []directMessageView `json:"direct_messages"`
	}
	decodeResponse(t, list, http.StatusOK, &listed)
	if len(listed.DirectMessages) != 1 || listed.DirectMessages[0].ID != dmID {
		t.Fatalf("Direct Message list = %+v", listed.DirectMessages)
	}

	app.stop(t)
	app = startInstance(t, dataDirectory)
	persisted := getWithClient(t, memberClient, app.url("/api/v1/dms/"+dmID+"/messages"))
	if persisted.StatusCode != http.StatusOK {
		t.Fatalf("persisted Direct Message status = %d", persisted.StatusCode)
	}
	persisted.Body.Close()
}

type searchResultView struct {
	Message messageView `json:"message"`
	Snippet string      `json:"snippet"`
	URL     string      `json:"url"`
}

func searchMessages(t *testing.T, client *http.Client, app *runningInstance, query string) []searchResultView {
	t.Helper()
	response := getWithClient(t, client, app.url("/api/v1/search?q="+url.QueryEscape(query)))
	var body struct {
		Results []searchResultView `json:"results"`
	}
	decodeResponse(t, response, http.StatusOK, &body)
	return body.Results
}

type realtimeFrameView struct {
	Type      string          `json:"type"`
	Cursor    int64           `json:"cursor"`
	ChannelID string          `json:"channel_id"`
	Payload   json.RawMessage `json:"payload"`
	Snapshot  *struct {
		Cursor   int64                    `json:"cursor"`
		Messages map[string][]messageView `json:"messages"`
	} `json:"snapshot"`
}

func writeRealtimeCommand(t *testing.T, connection *websocket.Conn, value any) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := connection.Write(ctx, websocket.MessageText, encoded); err != nil {
		t.Fatalf("write realtime command: %v", err)
	}
}

func dialRealtime(t *testing.T, client *http.Client, app *runningInstance, cursor string) *websocket.Conn {
	t.Helper()
	target := strings.Replace(app.url("/api/v1/realtime"), "http://", "ws://", 1)
	if cursor != "" {
		target += "?cursor=" + url.QueryEscape(cursor)
	}
	headers := http.Header{}
	httpTarget, err := url.Parse(app.url("/"))
	if err != nil {
		t.Fatal(err)
	}
	for _, cookie := range client.Jar.Cookies(httpTarget) {
		headers.Add("Cookie", cookie.String())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, response, err := websocket.Dial(ctx, target, &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		if response != nil {
			t.Fatalf("dial realtime: %v status=%d", err, response.StatusCode)
		}
		t.Fatalf("dial realtime: %v", err)
	}
	return connection
}

func readRealtime(t *testing.T, connection *websocket.Conn) realtimeFrameView {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, encoded, err := connection.Read(ctx)
	if err != nil {
		t.Fatalf("read realtime frame: %v", err)
	}
	var frame realtimeFrameView
	if err := json.Unmarshal(encoded, &frame); err != nil {
		t.Fatalf("decode realtime frame %s: %v", encoded, err)
	}
	return frame
}

func readRealtimeType(t *testing.T, connection *websocket.Conn, wanted string) realtimeFrameView {
	t.Helper()
	for attempts := 0; attempts < 20; attempts++ {
		frame := readRealtime(t, connection)
		if frame.Type == wanted {
			return frame
		}
	}
	t.Fatalf("realtime stream did not deliver %q", wanted)
	return realtimeFrameView{}
}

func TestSecondProcessCannotOwnTheSameInstance(t *testing.T) {
	dataDirectory := t.TempDir()
	first := startInstance(t, dataDirectory)

	second := exec.Command(allchatBinary, "--data-dir", dataDirectory, "--listen", "127.0.0.1:0")
	output, err := second.CombinedOutput()
	if err == nil {
		t.Fatal("second process unexpectedly acquired the Instance")
	}
	if !strings.Contains(string(output), "already owned by another process") {
		t.Fatalf("second process output = %q, want ownership error", output)
	}

	response := get(t, first.url("/api/v1/health"))
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("first process health status = %d after rejected second process", response.StatusCode)
	}
}

func TestInvalidConfigurationFailsBeforeStartup(t *testing.T) {
	tests := []struct {
		name string
		args []string
	}{
		{name: "missing data directory", args: []string{"--listen", "127.0.0.1:0"}},
		{name: "invalid listen address", args: []string{"--data-dir", filepath.Join(t.TempDir(), "must-not-exist"), "--listen", "not-an-address"}},
		{name: "unexpected argument", args: []string{"--data-dir", t.TempDir(), "extra"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			command := exec.Command(allchatBinary, test.args...)
			output, err := command.CombinedOutput()
			if err == nil {
				t.Fatalf("invalid command unexpectedly succeeded: %s", output)
			}
			if !strings.Contains(string(output), "invalid configuration") && !strings.Contains(string(output), "unexpected positional arguments") {
				t.Fatalf("output = %q, want configuration error", output)
			}
		})
	}
}

type runningInstance struct {
	command  *exec.Cmd
	address  string
	setupURL string
	stderr   *bytes.Buffer
	stopOnce sync.Once
	stopErr  error
}

func startInstance(t *testing.T, dataDirectory string) *runningInstance {
	t.Helper()
	command := exec.Command(allchatBinary, "--data-dir", dataDirectory, "--listen", "127.0.0.1:0")
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("open Instance stdout: %v", err)
	}
	stderr := new(bytes.Buffer)
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		t.Fatalf("start Instance: %v", err)
	}

	startups := make(chan startup, 1)
	scanErrors := make(chan error, 1)
	go scanListeningAddress(stdout, startups, scanErrors)

	var startup startup
	select {
	case startup = <-startups:
	case err := <-scanErrors:
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatalf("read Instance startup: %v; stderr: %s", err, stderr.String())
	case <-time.After(10 * time.Second):
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatalf("Instance did not become ready; stderr: %s", stderr.String())
	}

	app := &runningInstance{command: command, address: startup.Address, setupURL: startup.SetupURL, stderr: stderr}
	t.Cleanup(func() { app.stop(t) })
	return app
}

type startup struct {
	Event    string `json:"event"`
	Address  string `json:"address"`
	SetupURL string `json:"setup_url"`
}

func scanListeningAddress(stdout io.Reader, startups chan<- startup, scanErrors chan<- error) {
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var event startup
		if err := json.Unmarshal(scanner.Bytes(), &event); err == nil && event.Event == "listening" {
			startups <- event
			_, _ = io.Copy(io.Discard, stdout)
			return
		}
	}
	if err := scanner.Err(); err != nil {
		scanErrors <- err
		return
	}
	scanErrors <- fmt.Errorf("process exited before announcing its listen address")
}

func (i *runningInstance) url(path string) string {
	return "http://" + i.address + path
}

func (i *runningInstance) stop(t *testing.T) {
	t.Helper()
	i.stopOnce.Do(func() {
		if runtime.GOOS == "windows" {
			i.stopErr = i.command.Process.Kill()
		} else {
			i.stopErr = i.command.Process.Signal(os.Interrupt)
		}
		if i.stopErr != nil {
			return
		}
		done := make(chan error, 1)
		go func() { done <- i.command.Wait() }()
		select {
		case i.stopErr = <-done:
		case <-time.After(10 * time.Second):
			_ = i.command.Process.Kill()
			i.stopErr = fmt.Errorf("Instance did not stop gracefully")
		}
	})
	if i.stopErr != nil {
		t.Errorf("stop Instance: %v; stderr: %s", i.stopErr, i.stderr.String())
	}
}

func get(t *testing.T, url string) *http.Response {
	t.Helper()
	return getWithClient(t, &http.Client{Timeout: 5 * time.Second}, url)
}

func getWithClient(t *testing.T, client *http.Client, url string) *http.Response {
	t.Helper()
	response, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	return response
}

func newClient(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("create cookie jar: %v", err)
	}
	return &http.Client{Timeout: 10 * time.Second, Jar: jar}
}

func bootstrapOwner(t *testing.T, client *http.Client, app *runningInstance, username, password string) map[string]any {
	t.Helper()
	response := postJSON(t, client, app.url("/api/v1/auth/setup"), map[string]string{
		"token": setupToken(t, app.setupURL), "username": username, "password": password,
	})
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("bootstrap status = %d body=%s", response.StatusCode, readAll(t, response.Body))
	}
	var sessionCookie, csrfCookie *http.Cookie
	for _, cookie := range response.Cookies() {
		switch cookie.Name {
		case "allchat_session":
			sessionCookie = cookie
		case "allchat_csrf":
			csrfCookie = cookie
		}
	}
	if sessionCookie == nil || !sessionCookie.HttpOnly || sessionCookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("Session cookie lacks required protections: %#v", sessionCookie)
	}
	if csrfCookie == nil || csrfCookie.HttpOnly || csrfCookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("CSRF cookie has incorrect protections: %#v", csrfCookie)
	}
	var member map[string]any
	if err := json.NewDecoder(response.Body).Decode(&member); err != nil {
		t.Fatalf("decode bootstrap response: %v", err)
	}
	return member
}

func setupToken(t *testing.T, setupURL string) string {
	t.Helper()
	parsed, err := url.Parse(setupURL)
	if err != nil {
		t.Fatalf("parse setup URL: %v", err)
	}
	token := parsed.Query().Get("token")
	if token == "" {
		t.Fatal("setup URL contains no token")
	}
	return token
}

func postJSON(t *testing.T, client *http.Client, target string, body any) *http.Response {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost, target, bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("create POST %s: %v", target, err)
	}
	request.Header.Set("Content-Type", "application/json")
	addCSRFHeader(client, request)
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("POST %s: %v", target, err)
	}
	return response
}

func deleteJSON(t *testing.T, client *http.Client, target string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(http.MethodDelete, target, nil)
	if err != nil {
		t.Fatalf("create DELETE %s: %v", target, err)
	}
	addCSRFHeader(client, request)
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("DELETE %s: %v", target, err)
	}
	return response
}

func addCSRFHeader(client *http.Client, request *http.Request) {
	if client.Jar == nil {
		return
	}
	for _, cookie := range client.Jar.Cookies(request.URL) {
		if cookie.Name == "allchat_csrf" {
			request.Header.Set("X-CSRF-Token", cookie.Value)
			return
		}
	}
}

func loginWithDevice(t *testing.T, client *http.Client, app *runningInstance, username, password, device string) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	request, err := http.NewRequest(http.MethodPost, app.url("/api/v1/auth/login"), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", device)
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("login device: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login device status = %d body=%s", response.StatusCode, readAll(t, response.Body))
	}
}

type invitationView struct {
	ID    string `json:"id"`
	Token string `json:"token"`
}

type memberView struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type channelView struct {
	ID         string `json:"id"`
	CategoryID string `json:"category_id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Position   int    `json:"position"`
}

type directMessageView struct {
	ID          string     `json:"id"`
	Other       memberView `json:"other"`
	BlockedByMe bool       `json:"blocked_by_me"`
	BlockedMe   bool       `json:"blocked_me"`
}

type messageView struct {
	ID              string `json:"id"`
	Sequence        int64  `json:"sequence"`
	Body            string `json:"body"`
	EditedAt        string `json:"edited_at"`
	Deleted         bool   `json:"deleted"`
	AuthorAvatarURL string `json:"author_avatar_url"`
}

type attachmentView struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func uploadAttachment(t *testing.T, client *http.Client, app *runningInstance, name, contentType string, body []byte) attachmentView {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, app.url("/api/v1/attachments"), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("X-AllChat-Filename", name)
	addCSRFHeader(client, request)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var attachment attachmentView
	decodeResponse(t, response, http.StatusCreated, &attachment)
	return attachment
}

func requestJSON(t *testing.T, client *http.Client, method, target string, body any) *http.Response {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("encode request: %v", err)
	}
	request, err := http.NewRequest(method, target, bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("create %s %s: %v", method, target, err)
	}
	request.Header.Set("Content-Type", "application/json")
	addCSRFHeader(client, request)
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("%s %s: %v", method, target, err)
	}
	return response
}

func requestBytes(t *testing.T, client *http.Client, method, target, contentType string, body []byte) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, target, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", contentType)
	addCSRFHeader(client, request)
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("%s %s: %v", method, target, err)
	}
	return response
}

func decodeResponse(t *testing.T, response *http.Response, expectedStatus int, destination any) {
	t.Helper()
	defer response.Body.Close()
	if response.StatusCode != expectedStatus {
		t.Fatalf("response status = %d, want %d; body=%s", response.StatusCode, expectedStatus, readAll(t, response.Body))
	}
	if err := json.NewDecoder(response.Body).Decode(destination); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

func createInvitation(t *testing.T, client *http.Client, app *runningInstance, expiresMinutes, maxUses int) invitationView {
	t.Helper()
	response := requestJSON(t, client, http.MethodPost, app.url("/api/v1/invitations"), map[string]int{"expires_in_minutes": expiresMinutes, "max_uses": maxUses})
	var invitation invitationView
	decodeResponse(t, response, http.StatusCreated, &invitation)
	if invitation.ID == "" || invitation.Token == "" {
		t.Fatalf("Invitation is incomplete: %+v", invitation)
	}
	return invitation
}

func registerMember(t *testing.T, client *http.Client, app *runningInstance, token, username, password string) memberView {
	t.Helper()
	response := requestJSON(t, client, http.MethodPost, app.url("/api/v1/auth/register"), map[string]string{"token": token, "username": username, "password": password})
	var member memberView
	decodeResponse(t, response, http.StatusCreated, &member)
	if member.ID == "" {
		t.Fatal("registered Member has no ID")
	}
	return member
}

func sessionOwnerFlag(t *testing.T, client *http.Client, app *runningInstance) bool {
	t.Helper()
	response := getWithClient(t, client, app.url("/api/v1/session"))
	var member map[string]any
	decodeResponse(t, response, http.StatusOK, &member)
	owner, _ := member["owner"].(bool)
	return owner
}

func createChannel(t *testing.T, client *http.Client, app *runningInstance, categoryID, name, channelType string, position int) channelView {
	t.Helper()
	response := requestJSON(t, client, http.MethodPost, app.url("/api/v1/channels"), map[string]any{"category_id": categoryID, "name": name, "type": channelType, "position": position})
	var channel channelView
	decodeResponse(t, response, http.StatusCreated, &channel)
	return channel
}

func publishMessage(t *testing.T, client *http.Client, app *runningInstance, channelID, body string) messageView {
	t.Helper()
	response := requestJSON(t, client, http.MethodPost, app.url("/api/v1/channels/"+channelID+"/messages"), map[string]string{"body": body})
	var message messageView
	decodeResponse(t, response, http.StatusCreated, &message)
	return message
}

func listMessages(t *testing.T, client *http.Client, app *runningInstance, channelID string) []messageView {
	t.Helper()
	response := getWithClient(t, client, app.url("/api/v1/channels/"+channelID+"/messages"))
	var payload struct {
		Messages []messageView `json:"messages"`
	}
	decodeResponse(t, response, http.StatusOK, &payload)
	return payload.Messages
}

func fileMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return info.Mode()
}

func readAll(t *testing.T, source io.Reader) string {
	t.Helper()
	data, err := io.ReadAll(source)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	return string(data)
}
