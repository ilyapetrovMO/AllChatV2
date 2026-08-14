package instance

import (
	"bytes"
	"crypto"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SyncCaddyCertificate copies Caddy's current certificate into stable files
// readable by AllChat. It returns true only when the deployed pair changed.
func SyncCaddyCertificate(storageDir, identifier, certDestination, keyDestination string) (bool, error) {
	var bestCert, bestKey []byte
	var bestExpiry time.Time
	err := filepath.WalkDir(storageDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() || !strings.HasSuffix(entry.Name(), ".crt") {
			return walkErr
		}
		certificatePEM, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		block, _ := pem.Decode(certificatePEM)
		if block == nil {
			return nil
		}
		certificate, parseErr := x509.ParseCertificate(block.Bytes)
		if parseErr != nil || certificate.VerifyHostname(identifier) != nil || time.Now().Before(certificate.NotBefore) || time.Now().After(certificate.NotAfter) || !certificate.NotAfter.After(bestExpiry) {
			return nil
		}
		keyPath := strings.TrimSuffix(path, ".crt") + ".key"
		keyPEM, keyErr := os.ReadFile(keyPath)
		if keyErr != nil || !certificateKeyMatches(certificate, keyPEM) {
			return nil
		}
		bestCert, bestKey, bestExpiry = certificatePEM, keyPEM, certificate.NotAfter
		return nil
	})
	if err != nil {
		return false, err
	}
	if len(bestCert) == 0 {
		return false, fmt.Errorf("no valid Caddy certificate found for %s", identifier)
	}
	currentCert, _ := os.ReadFile(certDestination)
	currentKey, _ := os.ReadFile(keyDestination)
	if bytes.Equal(currentCert, bestCert) && bytes.Equal(currentKey, bestKey) {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(certDestination), 0o750); err != nil {
		return false, err
	}
	if err := writeAtomic(certDestination, bestCert, 0o640); err != nil {
		return false, err
	}
	if err := writeAtomic(keyDestination, bestKey, 0o640); err != nil {
		return false, err
	}
	return true, nil
}

func certificateKeyMatches(certificate *x509.Certificate, keyPEM []byte) bool {
	block, _ := pem.Decode(keyPEM)
	if block == nil {
		return false
	}
	var key any
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		if rsaKey, rsaErr := x509.ParsePKCS1PrivateKey(block.Bytes); rsaErr == nil {
			key = rsaKey
		} else if ecKey, ecErr := x509.ParseECPrivateKey(block.Bytes); ecErr == nil {
			key = ecKey
		} else {
			return false
		}
	}
	signer, ok := key.(crypto.Signer)
	if !ok {
		return false
	}
	want, err := x509.MarshalPKIXPublicKey(certificate.PublicKey)
	if err != nil {
		return false
	}
	got, err := x509.MarshalPKIXPublicKey(signer.Public())
	return err == nil && bytes.Equal(got, want)
}

func writeAtomic(path string, data []byte, mode fs.FileMode) error {
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, mode); err != nil {
		return err
	}
	if err := os.Chmod(temporary, mode); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return os.Rename(temporary, path)
}
