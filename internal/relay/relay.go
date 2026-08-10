// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package relay

import (
	"crypto/tls"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/pion/logging"
	"github.com/pion/turn/v5"
)

type Config struct {
	ListenAddress              string
	PublicIP                   net.IP
	RelayMinPort, RelayMaxPort uint16
	Realm, SharedSecret        string
	TLSListenAddress           string
	TLSConfig                  *tls.Config
	allowPrivatePeers          bool // tests only; production always uses safePeer
}
type Relay struct {
	server *turn.Server
	conn   net.PacketConn
	urls   []string
	secret string
}

func Start(config Config) (*Relay, error) {
	if config.PublicIP == nil || config.PublicIP.IsUnspecified() {
		return nil, fmt.Errorf("TURN public IP is required")
	}
	if config.RelayMinPort == 0 || config.RelayMaxPort < config.RelayMinPort {
		return nil, fmt.Errorf("invalid TURN relay port range")
	}
	conn, err := net.ListenPacket("udp", config.ListenAddress)
	if err != nil {
		return nil, err
	}
	factory := logging.NewDefaultLoggerFactory()
	tcpAddress := config.ListenAddress
	if host, configuredPort, splitErr := net.SplitHostPort(config.ListenAddress); splitErr == nil && configuredPort == "0" {
		tcpAddress = net.JoinHostPort(host, fmt.Sprint(conn.LocalAddr().(*net.UDPAddr).Port))
	}
	tcpListener, err := net.Listen("tcp", tcpAddress)
	if err != nil {
		conn.Close()
		return nil, err
	}
	var quotaMu sync.Mutex
	allocations := map[string]int{}
	userID := func(value string) string {
		if index := strings.IndexByte(value, ':'); index >= 0 {
			return value[index+1:]
		}
		return value
	}
	events := turn.EventHandler{OnAllocationCreated: func(_, _ net.Addr, _, user, _ string, _ net.Addr, _ int) {
		quotaMu.Lock()
		allocations[userID(user)]++
		quotaMu.Unlock()
	}, OnAllocationDeleted: func(_, _ net.Addr, _, user, _ string) {
		quotaMu.Lock()
		id := userID(user)
		if allocations[id] <= 1 {
			delete(allocations, id)
		} else {
			allocations[id]--
		}
		quotaMu.Unlock()
	}}
	generator := func() turn.RelayAddressGenerator {
		return &turn.RelayAddressGeneratorPortRange{RelayAddress: config.PublicIP, Address: "0.0.0.0", MinPort: config.RelayMinPort, MaxPort: config.RelayMaxPort, MaxRetries: 32}
	}
	permissionHandler := safePeer
	if config.allowPrivatePeers {
		permissionHandler = func(net.Addr, net.IP) bool { return true }
	}
	listeners := []turn.ListenerConfig{{Listener: tcpListener, RelayAddressGenerator: generator(), PermissionHandler: permissionHandler}}
	port := conn.LocalAddr().(*net.UDPAddr).Port
	hostPort := net.JoinHostPort(config.PublicIP.String(), fmt.Sprint(port))
	urls := []string{"turn:" + hostPort + "?transport=udp", "turn:" + hostPort + "?transport=tcp"}
	if config.TLSConfig != nil && config.TLSListenAddress != "" {
		plainTLS, tlsErr := net.Listen("tcp", config.TLSListenAddress)
		if tlsErr != nil {
			conn.Close()
			tcpListener.Close()
			return nil, tlsErr
		}
		listeners = append(listeners, turn.ListenerConfig{Listener: tls.NewListener(plainTLS, config.TLSConfig.Clone()), RelayAddressGenerator: generator(), PermissionHandler: permissionHandler})
		tlsPort := plainTLS.Addr().(*net.TCPAddr).Port
		urls = append(urls, "turns:"+net.JoinHostPort(config.PublicIP.String(), fmt.Sprint(tlsPort))+"?transport=tcp")
	}
	server, err := turn.NewServer(turn.ServerConfig{Realm: config.Realm, AuthHandler: turn.LongTermTURNRESTAuthHandler(config.SharedSecret, factory.NewLogger("turn-auth")), QuotaHandler: func(username, _ string, _ net.Addr) bool {
		quotaMu.Lock()
		defer quotaMu.Unlock()
		return allocations[userID(username)] < 2
	}, EventHandler: events, LoggerFactory: factory, AllocationLifetime: 10 * time.Minute, PacketConnConfigs: []turn.PacketConnConfig{{PacketConn: conn, RelayAddressGenerator: generator(), PermissionHandler: permissionHandler}}, ListenerConfigs: listeners})
	if err != nil {
		conn.Close()
		tcpListener.Close()
		return nil, err
	}
	return &Relay{server: server, conn: conn, urls: urls, secret: config.SharedSecret}, nil
}
func safePeer(_ net.Addr, ip net.IP) bool {
	return ip != nil && !ip.IsUnspecified() && !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsMulticast()
}
func (r *Relay) Credentials(memberID string) ([]string, string, string, error) {
	username, password, err := turn.GenerateLongTermTURNRESTCredentials(r.secret, memberID, 10*time.Minute)
	return append([]string(nil), r.urls...), username, password, err
}
func (r *Relay) AllocationCount() int { return r.server.AllocationCount() }
func (r *Relay) Close() error         { return r.server.Close() }
