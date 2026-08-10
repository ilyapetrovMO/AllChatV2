package relay

import (
	"allchat/internal/media"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/pion/logging"
	"github.com/pion/turn/v5"
	"github.com/pion/webrtc/v4"
)

func TestSafePeerRejectsInternalAndSpecialNetworks(t *testing.T) {
	denied := []string{"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "224.0.0.1", "::1", "fe80::1"}
	for _, raw := range denied {
		if safePeer(nil, net.ParseIP(raw)) {
			t.Errorf("safePeer admitted %s", raw)
		}
	}
	if !safePeer(nil, net.ParseIP("203.0.113.20")) {
		t.Fatal("safePeer rejected public address")
	}
}

func TestForcedRelayWebRTCPeerConnectsThroughTURN(t *testing.T) {
	server, err := Start(Config{ListenAddress: "127.0.0.1:0", PublicIP: net.ParseIP("127.0.0.1"), RelayMinPort: 52200, RelayMaxPort: 52220, Realm: "allchat", SharedSecret: "forced-relay-test-secret-long-enough", allowPrivatePeers: true})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	urls, username, password, err := server.Credentials("member")
	if err != nil {
		t.Fatal(err)
	}
	client, err := webrtc.NewPeerConnection(webrtc.Configuration{ICEServers: []webrtc.ICEServer{{URLs: urls[:1], Username: username, Credential: password}}, ICETransportPolicy: webrtc.ICETransportPolicyRelay})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	track, _ := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2}, "microphone", "test")
	if _, err = client.AddTrack(track); err != nil {
		t.Fatal(err)
	}
	offer, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(client)
	if err = client.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-gathered:
	case <-time.After(10 * time.Second):
		t.Fatal("forced-relay ICE gathering timed out")
	}
	if !strings.Contains(client.LocalDescription().SDP, " typ relay") {
		t.Fatalf("offer contains no relay candidate: %s", client.LocalDescription().SDP)
	}
	manager := media.NewManager(5 * time.Second)
	defer manager.Close()
	answer, _, _, err := manager.AcceptOffer("member", "room", *client.LocalDescription(), func(media.Signal) {})
	if err != nil {
		t.Fatal(err)
	}
	connected := make(chan struct{}, 1)
	client.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateConnected {
			connected <- struct{}{}
		}
	})
	if err = client.SetRemoteDescription(answer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-connected:
	case <-time.After(10 * time.Second):
		t.Fatalf("forced-relay peer state = %s", client.ConnectionState())
	}
}
func TestRelayIssuesMemberBoundTemporaryCredentials(t *testing.T) {
	relay, err := Start(Config{ListenAddress: "127.0.0.1:0", PublicIP: net.ParseIP("203.0.113.10"), RelayMinPort: 52000, RelayMaxPort: 52020, Realm: "allchat", SharedSecret: "test-secret-long-enough"})
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	urls, username, password, err := relay.Credentials("member-one")
	if err != nil {
		t.Fatal(err)
	}
	if len(urls) != 2 || !strings.Contains(urls[0], "203.0.113.10") || !strings.HasSuffix(username, ":member-one") || password == "" {
		t.Fatalf("credentials = %q %q %q", urls, username, password)
	}
}

func TestRealTURNAllocationAndExpiredCredentialRejection(t *testing.T) {
	server, err := Start(Config{ListenAddress: "127.0.0.1:0", PublicIP: net.ParseIP("127.0.0.1"), RelayMinPort: 52100, RelayMaxPort: 52120, Realm: "allchat", SharedSecret: "allocation-test-secret"})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	username, password, err := turn.GenerateLongTermTURNRESTCredentials("allocation-test-secret", "member", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	allocate := func(user, pass string) error {
		conn, err := net.ListenPacket("udp4", "127.0.0.1:0")
		if err != nil {
			return err
		}
		client, err := turn.NewClient(&turn.ClientConfig{STUNServerAddr: server.conn.LocalAddr().String(), TURNServerAddr: server.conn.LocalAddr().String(), Username: user, Password: pass, Realm: "allchat", Conn: conn, LoggerFactory: logging.NewDefaultLoggerFactory()})
		if err != nil {
			conn.Close()
			return err
		}
		defer client.Close()
		if err = client.Listen(); err != nil {
			return err
		}
		relayConn, err := client.Allocate()
		if err == nil {
			relayConn.Close()
		}
		return err
	}
	if err = allocate(username, password); err != nil {
		t.Fatalf("valid allocation: %v", err)
	}
	expiredUser, expiredPassword, err := turn.GenerateLongTermTURNRESTCredentials("allocation-test-secret", "member", -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if err = allocate(expiredUser, expiredPassword); err == nil {
		t.Fatal("expired TURN credential allocated relay")
	}
}
