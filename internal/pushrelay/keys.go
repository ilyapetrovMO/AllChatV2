package pushrelay

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"strings"
)

// ParsePublicKeys parses a comma-separated key-id=base64url-public-key list.
func ParsePublicKeys(value string) (map[string]ed25519.PublicKey, error) {
	keys := make(map[string]ed25519.PublicKey)
	for _, entry := range strings.Split(value, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		keyID, encoded, ok := strings.Cut(entry, "=")
		keyID = strings.TrimSpace(keyID)
		if !ok || keyID == "" || strings.ContainsAny(keyID, " \t\r\n") {
			return nil, fmt.Errorf("invalid public key entry")
		}
		decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(encoded))
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("invalid public key for %q", keyID)
		}
		if _, exists := keys[keyID]; exists {
			return nil, fmt.Errorf("duplicate public key id %q", keyID)
		}
		keys[keyID] = ed25519.PublicKey(decoded)
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("at least one public key is required")
	}
	return keys, nil
}
