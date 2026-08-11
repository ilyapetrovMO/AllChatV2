package instance

import (
	"net"
	"net/url"
	"strings"
	"testing"
)

func TestParseLinkPreviewUsesOpenGraphMetadata(t *testing.T) {
	page, _ := url.Parse("https://news.example.test/posts/42")
	preview, err := parseLinkPreview(strings.NewReader(`<html><head>
<meta property="og:site_name" content="Example News">
<meta property="og:title" content="A useful &amp; safe title">
<meta property="og:description" content="A short description of the linked page.">
<meta property="og:image" content="/images/card.png">
</head><body></body></html>`), page)
	if err != nil {
		t.Fatal(err)
	}
	if preview.SiteName != "Example News" || preview.Title != "A useful & safe title" || preview.Description != "A short description of the linked page." || preview.ImageURL != "https://news.example.test/images/card.png" {
		t.Fatalf("preview=%+v", preview)
	}
}

func TestParseLinkPreviewFallsBackToDocumentTitle(t *testing.T) {
	page, _ := url.Parse("https://docs.example.test/guide")
	preview, err := parseLinkPreview(strings.NewReader(`<html><head><title>Example guide</title></head><body></body></html>`), page)
	if err != nil || preview.Title != "Example guide" || preview.SiteName != "docs.example.test" {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
}

func TestLinkPreviewRejectsPrivateAndCredentialedTargets(t *testing.T) {
	for _, raw := range []string{"file:///etc/example", "http://user:password@public.example.test/"} {
		if _, err := parsePreviewURL(raw); err == nil {
			t.Fatalf("accepted %q", raw)
		}
	}
	for _, raw := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "::1"} {
		if publicPreviewIP(net.ParseIP(raw)) {
			t.Fatalf("accepted private address %q", raw)
		}
	}
	if !publicPreviewIP(net.ParseIP("192.0.2.10")) {
		t.Fatal("rejected documentation-range public address")
	}
}
