// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/pion/turn/v5"
)

func (i *Instance) turnCredentialsAPI(w http.ResponseWriter, r *http.Request) {
	member, _, ok := i.authenticated(w, r)
	if !ok {
		return
	}
	if i.relay == nil && len(i.turnURLs) == 0 {
		writeJSON(w, 200, map[string]any{"ice_servers": []any{}})
		return
	}
	if !i.allowTURNCredentialIssue(member.ID, time.Now()) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "TURN credential issuance rate exceeded"})
		return
	}
	var urls []string
	var username, credential string
	var err error
	if i.relay != nil {
		urls, username, credential, err = i.relay.Credentials(member.ID)
	} else {
		urls = append([]string(nil), i.turnURLs...)
		username, credential, err = turn.GenerateLongTermTURNRESTCredentials(i.turnSecret, member.ID, 10*time.Minute)
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "TURN credentials unavailable"})
		return
	}
	writeJSON(w, 200, map[string]any{"ice_servers": []any{map[string]any{"urls": urls, "username": username, "credential": credential}}})
}

func (i *Instance) allowTURNCredentialIssue(memberID string, now time.Time) bool {
	i.turnMu.Lock()
	defer i.turnMu.Unlock()
	cutoff := now.Add(-time.Minute)
	issued := i.turnIssued[memberID][:0]
	for _, item := range i.turnIssued[memberID] {
		if item.After(cutoff) {
			issued = append(issued, item)
		}
	}
	if len(issued) >= 20 {
		i.turnIssued[memberID] = issued
		return false
	}
	i.turnIssued[memberID] = append(issued, now)
	return true
}
func loadOrCreateSecret(path string) (string, error) {
	if value, err := os.ReadFile(path); err == nil && len(value) >= 32 {
		return string(value), nil
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	value := base64.RawURLEncoding.EncodeToString(raw)
	if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
		return "", fmt.Errorf("persist TURN secret: %w", err)
	}
	return value, nil
}
