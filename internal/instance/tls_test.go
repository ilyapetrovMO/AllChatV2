package instance

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSuppliedTLSLoadsMatchingCurrentCertificateAndRejectsExpired(t *testing.T) {
	for _, test := range []struct {
		name                string
		notBefore, notAfter time.Time
		wantErr             bool
	}{{"current", time.Now().Add(-time.Hour), time.Now().Add(time.Hour), false}, {"expired", time.Now().Add(-2 * time.Hour), time.Now().Add(-time.Hour), true}} {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			cert, key := writeTestCertificate(t, directory, test.notBefore, test.notAfter)
			config, err := NewConfig(directory, "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			if err = config.ConfigureTLS(cert, key, "", ""); err != nil {
				t.Fatal(err)
			}
			app, err := Open(config, slog.New(slog.NewTextHandler(io.Discard, nil)))
			if test.wantErr {
				if err == nil {
					app.Close()
					t.Fatal("expired certificate accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer app.Close()
			if app.tlsConfig == nil || app.tlsConfig.MinVersion == 0 {
				t.Fatal("TLS config not installed")
			}
		})
	}
}

func TestSuppliedTLSServesHTTPSWithSecureSessionPolicy(t *testing.T) {
	directory := t.TempDir()
	cert, key := writeTestCertificate(t, directory, time.Now().Add(-time.Hour), time.Now().Add(time.Hour))
	config, _ := NewConfig(directory, "127.0.0.1:0")
	if err := config.ConfigureTLS(cert, key, "", ""); err != nil {
		t.Fatal(err)
	}
	app, err := Open(config, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	defer app.Close()
	server := httptest.NewUnstartedServer(app.routes())
	server.TLS = app.tlsConfig.Clone()
	server.StartTLS()
	defer server.Close()
	server.Client().Transport.(*http.Transport).TLSClientConfig = &tls.Config{RootCAs: x509.NewCertPool(), MinVersion: tls.VersionTLS12, InsecureSkipVerify: true} // test-only certificate
	response, err := server.Client().Get(server.URL + "/api/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.TLS == nil || response.TLS.Version < tls.VersionTLS12 {
		t.Fatalf("HTTPS health response = %d TLS=%+v", response.StatusCode, response.TLS)
	}
}
func TestTLSModesRejectAmbiguousOrInvalidConfiguration(t *testing.T) {
	config, err := NewConfig(t.TempDir(), "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if config.ConfigureTLS("cert.pem", "", "", "") == nil {
		t.Fatal("certificate without key accepted")
	}
	if config.ConfigureTLS("cert.pem", "key.pem", "example.com", "") == nil {
		t.Fatal("supplied and ACME modes combined")
	}
	if config.ConfigureTLS("", "", "127.0.0.1", "") == nil {
		t.Fatal("IP accepted as ACME hostname")
	}
}

func TestExternalTURNModeValidation(t *testing.T) {
	config, err := NewConfig(t.TempDir(), "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if config.ConfigureExternalTURN("https://turn.example.test", strings.Repeat("s", 32)) == nil {
		t.Fatal("non-TURN external URL accepted")
	}
	if err = config.ConfigureExternalTURN("turn:turn.example.test:3478?transport=udp,turns:turn.example.test:5349", strings.Repeat("s", 32)); err != nil {
		t.Fatal(err)
	}
	if len(config.ExternalTURNURLs) != 2 {
		t.Fatalf("external URLs = %v", config.ExternalTURNURLs)
	}
}
func writeTestCertificate(t *testing.T, directory string, notBefore, notAfter time.Time) (string, string) {
	t.Helper()
	private, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"}, DNSNames: []string{"localhost"}, NotBefore: notBefore, NotAfter: notAfter, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &private.PublicKey, private)
	if err != nil {
		t.Fatal(err)
	}
	certPath, keyPath := filepath.Join(directory, "cert.pem"), filepath.Join(directory, "key.pem")
	if err = os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(private)}), 0o600); err != nil {
		t.Fatal(err)
	}
	return certPath, keyPath
}
