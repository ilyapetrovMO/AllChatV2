package instance

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"allchat/internal/community"
	"allchat/internal/identity"
	"allchat/internal/media"
	"github.com/coder/websocket"
	"github.com/pion/webrtc/v4"
)

func TestMediaTransportLossDoesNotReportAnotherDevice(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	ident, err := identity.New(db, directory)
	if err != nil {
		t.Fatal(err)
	}
	token, err := ident.BootstrapToken(ctx)
	if err != nil {
		t.Fatal(err)
	}
	owner, credentials, err := ident.Bootstrap(ctx, token, "owner-user", "owner password long enough", "test")
	if err != nil {
		t.Fatal(err)
	}
	service := community.New(db, directory)
	defer service.Close()
	if _, err = db.Exec(`INSERT INTO categories(id,name,position) VALUES('cat','General',0); INSERT INTO channels(id,category_id,name,type,position) VALUES('voice','cat','Voice','voice',0)`); err != nil {
		t.Fatal(err)
	}
	manager := media.NewManager(30 * time.Second)
	defer manager.Close()
	app := &Instance{identity: ident, community: service, media: manager}
	server := httptest.NewServer(http.HandlerFunc(app.mediaWebSocket))
	defer server.Close()
	peer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if _, err = peer.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio); err != nil {
		t.Fatal(err)
	}
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	connection, _, err := websocket.Dial(ctx, strings.Replace(server.URL, "http:", "ws:", 1), &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {sessionCookieName + "=" + credentials.Token}}})
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()
	if err = connection.Write(ctx, websocket.MessageText, mustJSON(mediaCommand{Version: 1, Type: "join", RoomID: "voice", SDP: offer})); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, readErr := connection.Read(ctx)
		if readErr != nil {
			t.Fatal(readErr)
		}
		var frame mediaFrame
		if err = json.Unmarshal(data, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type == "error" {
			t.Fatalf("join failed: %s", frame.Error)
		}
		if frame.Type == "answer" {
			break
		}
	}
	// The first peer's transport fails while its signaling socket remains open.
	if !manager.IsPeerLease(owner.ID, 1) {
		t.Fatalf("expected first lease for %q", owner.ID)
	}
	manager.DisconnectPeer(owner.ID, 1)
	if err = connection.Write(ctx, websocket.MessageText, mustJSON(map[string]any{"version": 1, "type": "heartbeat"})); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, readErr := connection.Read(ctx)
		if readErr != nil {
			t.Fatal(readErr)
		}
		var frame mediaFrame
		if err = json.Unmarshal(data, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type != "error" {
			continue
		}
		if frame.Code != "transport_closed" {
			t.Fatalf("transport loss reported %q: %s", frame.Code, frame.Error)
		}
		break
	}
}

func TestExplicitMediaEndAfterTransportLossImmediatelyReleasesBusySession(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	ident, err := identity.New(db, directory)
	if err != nil {
		t.Fatal(err)
	}
	token, err := ident.BootstrapToken(ctx)
	if err != nil {
		t.Fatal(err)
	}
	owner, credentials, err := ident.Bootstrap(ctx, token, "owner-user", "owner password long enough", "test")
	if err != nil {
		t.Fatal(err)
	}
	service := community.New(db, directory)
	defer service.Close()
	if _, err = db.Exec(`INSERT INTO categories(id,name,position) VALUES('cat','General',0); INSERT INTO channels(id,category_id,name,type,position) VALUES('voice','cat','Voice','voice',0)`); err != nil {
		t.Fatal(err)
	}
	manager := media.NewManager(30 * time.Second)
	defer manager.Close()
	app := &Instance{identity: ident, community: service, media: manager}
	server := httptest.NewServer(http.HandlerFunc(app.mediaWebSocket))
	defer server.Close()
	peer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if _, err = peer.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio); err != nil {
		t.Fatal(err)
	}
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	connection, _, err := websocket.Dial(ctx, strings.Replace(server.URL, "http:", "ws:", 1), &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {sessionCookieName + "=" + credentials.Token}}})
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()
	if err = connection.Write(ctx, websocket.MessageText, mustJSON(mediaCommand{Version: 1, Type: "join", RoomID: "voice", SDP: offer})); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, readErr := connection.Read(ctx)
		if readErr != nil {
			t.Fatal(readErr)
		}
		var frame mediaFrame
		if err = json.Unmarshal(data, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type == "error" {
			t.Fatalf("join failed: %s", frame.Error)
		}
		if frame.Type == "answer" {
			break
		}
	}
	// The first peer's transport fails while its signaling socket remains open.
	if !manager.IsPeerLease(owner.ID, 1) {
		t.Fatalf("expected first lease for %q", owner.ID)
	}
	manager.DisconnectPeer(owner.ID, 1)

	if _, err := manager.StartDirectCall("dm", owner.ID, "other"); !errors.Is(err, media.ErrBusy) {
		t.Fatalf("expected disconnected voice session to reserve member: %v", err)
	}
	request := httptest.NewRequest(http.MethodDelete, "/api/v1/media/rooms/voice/session", nil)
	request.SetPathValue("roomID", "voice")
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: credentials.Token})
	response := httptest.NewRecorder()
	app.endOwnMediaSessionAPI(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("end session status: %d", response.Code)
	}
	if participants := manager.Participants("voice"); len(participants) != 0 {
		t.Fatalf("member remained after explicit leave: %+v", participants)
	}
	if _, err := manager.StartDirectCall("dm", owner.ID, "other"); err != nil {
		t.Fatalf("could not immediately start direct call: %v", err)
	}
}
