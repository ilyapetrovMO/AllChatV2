// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/challenge/http01"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/registration"
)

type acmeAccount struct {
	email        string
	registration *registration.Resource
	key          crypto.PrivateKey
}

func (a *acmeAccount) GetEmail() string                        { return a.email }
func (a *acmeAccount) GetRegistration() *registration.Resource { return a.registration }
func (a *acmeAccount) GetPrivateKey() crypto.PrivateKey        { return a.key }

type acmeCertificateManager struct {
	identifier  string
	email       string
	directory   string
	logger      *slog.Logger
	mu          sync.RWMutex
	certificate *tls.Certificate
}

func newACMECertificateManager(identifier, email, dataDir string, logger *slog.Logger) (*acmeCertificateManager, error) {
	m := &acmeCertificateManager{identifier: identifier, email: email, directory: filepath.Join(dataDir, "acme-cache"), logger: logger}
	if err := os.MkdirAll(m.directory, 0o700); err != nil {
		return nil, fmt.Errorf("create ACME cache: %w", err)
	}
	_ = m.loadCertificate() // Missing, stale, or incomplete cache entries are replaced below.
	if m.needsRenewal(time.Now()) {
		if err := m.obtain(); err != nil {
			return nil, fmt.Errorf("obtain ACME certificate for %s: %w", identifier, err)
		}
	}
	return m, nil
}

func (m *acmeCertificateManager) TLSConfig() *tls.Config {
	return &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
		m.mu.RLock()
		defer m.mu.RUnlock()
		if m.certificate == nil {
			return nil, fmt.Errorf("ACME certificate is unavailable")
		}
		return m.certificate, nil
	}}
}

func (m *acmeCertificateManager) Run(stop <-chan struct{}) {
	ticker := time.NewTicker(12 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case now := <-ticker.C:
			if m.needsRenewal(now) {
				if err := m.obtain(); err != nil {
					m.logger.Error("ACME certificate renewal failed", "identifier", m.identifier, "error", err)
				} else {
					m.logger.Info("ACME certificate renewed", "identifier", m.identifier)
				}
			}
		}
	}
}

func (m *acmeCertificateManager) needsRenewal(now time.Time) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.certificate == nil || len(m.certificate.Certificate) == 0 {
		return true
	}
	leaf, err := x509.ParseCertificate(m.certificate.Certificate[0])
	if err != nil {
		return true
	}
	window := 30 * 24 * time.Hour
	if net.ParseIP(m.identifier) != nil {
		window = 3 * 24 * time.Hour
	}
	return !now.Before(leaf.NotAfter.Add(-window))
}

func (m *acmeCertificateManager) obtain() error {
	accountKey, err := loadOrCreateACMEAccountKey(filepath.Join(m.directory, "account.key"))
	if err != nil {
		return err
	}
	account := &acmeAccount{email: m.email, key: accountKey}
	config := lego.NewConfig(account)
	client, err := lego.NewClient(config)
	if err != nil {
		return err
	}
	account.registration, err = client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
	if err != nil {
		return err
	}
	if err = client.Challenge.SetHTTP01Provider(http01.NewProviderServer("", "80")); err != nil {
		return err
	}
	profile := acmeProfile(m.identifier)
	resource, err := client.Certificate.Obtain(certificate.ObtainRequest{Domains: []string{m.identifier}, Bundle: true, Profile: profile})
	if err != nil {
		return err
	}
	certPath, keyPath := filepath.Join(m.directory, "certificate.pem"), filepath.Join(m.directory, "certificate.key")
	if err = writePrivateFile(certPath, resource.Certificate); err != nil {
		return err
	}
	if err = writePrivateFile(keyPath, resource.PrivateKey); err != nil {
		return err
	}
	return m.loadCertificate()
}

func (m *acmeCertificateManager) loadCertificate() error {
	certificate, err := tls.LoadX509KeyPair(filepath.Join(m.directory, "certificate.pem"), filepath.Join(m.directory, "certificate.key"))
	if err != nil {
		return err
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		return fmt.Errorf("parse cached ACME certificate: %w", err)
	}
	if err = leaf.VerifyHostname(m.identifier); err != nil {
		return fmt.Errorf("cached ACME certificate is for another identifier: %w", err)
	}
	m.mu.Lock()
	m.certificate = &certificate
	m.mu.Unlock()
	return nil
}

func acmeProfile(identifier string) string {
	if net.ParseIP(identifier) != nil {
		return "shortlived"
	}
	return ""
}

func loadOrCreateACMEAccountKey(path string) (crypto.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		block, _ := pem.Decode(data)
		if block == nil {
			return nil, fmt.Errorf("decode ACME account key")
		}
		return x509.ParseECPrivateKey(block.Bytes)
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	encoded, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, err
	}
	return key, writePrivateFile(path, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: encoded}))
}

func writePrivateFile(path string, data []byte) error {
	temporary := path + ".new"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}
