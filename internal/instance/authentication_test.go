// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package instance

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthenticationFromRequestPrefersExplicitBearerToken(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/v1/session", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "cookie-token"})
	request.Header.Set("Authorization", "Bearer native-token")

	authentication, err := authenticationFromRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	if authentication.token != "native-token" || !authentication.bearer {
		t.Fatalf("authentication = %+v", authentication)
	}
}

func TestAuthenticationFromRequestRejectsMalformedAuthorization(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/v1/session", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "cookie-token"})
	request.Header.Set("Authorization", "Basic native-token")

	if _, err := authenticationFromRequest(request); err == nil {
		t.Fatal("malformed Authorization header unexpectedly fell back to cookie authentication")
	}
}

func TestAuthenticationFromRequestAcceptsCookieSession(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/v1/session", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "cookie-token"})

	authentication, err := authenticationFromRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	if authentication.token != "cookie-token" || authentication.bearer {
		t.Fatalf("authentication = %+v", authentication)
	}
}
