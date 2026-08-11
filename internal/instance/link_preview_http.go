package instance

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
)

const maxLinkPreviewHTML = 1 << 20
const maxLinkPreviewImage = 5 << 20

type linkPreview struct {
	URL         string `json:"url"`
	SiteName    string `json:"site_name,omitempty"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	ImageURL    string `json:"image_url,omitempty"`
}

func (i *Instance) linkPreviewAPI(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := i.authenticated(w, r); !ok {
		return
	}
	target, err := parsePreviewURL(r.URL.Query().Get("url"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid public link"})
		return
	}
	response, err := linkPreviewClient().Get(target.String())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "link preview unavailable"})
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 || !strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/html") {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "link has no HTML preview"})
		return
	}
	preview, err := parseLinkPreview(io.LimitReader(response.Body, maxLinkPreviewHTML+1), response.Request.URL)
	if err != nil || (preview.Title == "" && preview.Description == "") {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "link has no preview metadata"})
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

func (i *Instance) linkPreviewImageAPI(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := i.authenticated(w, r); !ok {
		return
	}
	target, err := parsePreviewURL(r.URL.Query().Get("url"))
	if err != nil {
		http.Error(w, "invalid public image", http.StatusBadRequest)
		return
	}
	response, err := linkPreviewClient().Get(target.String())
	if err != nil {
		http.Error(w, "preview image unavailable", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	allowedImageTypes := map[string]bool{"image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true, "image/avif": true}
	if response.StatusCode < 200 || response.StatusCode >= 300 || !allowedImageTypes[contentType] {
		http.Error(w, "preview resource is not an image", http.StatusUnprocessableEntity)
		return
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxLinkPreviewImage+1))
	if err != nil || len(content) > maxLinkPreviewImage {
		http.Error(w, "preview image is too large", http.StatusUnprocessableEntity)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(content)
}

func parsePreviewURL(raw string) (*url.URL, error) {
	if len(raw) == 0 || len(raw) > 2048 {
		return nil, fmt.Errorf("invalid URL length")
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return nil, fmt.Errorf("invalid URL")
	}
	return parsed, nil
}

func linkPreviewClient() *http.Client {
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, ResponseHeaderTimeout: 4 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		for _, candidate := range addresses {
			if publicPreviewIP(candidate.IP) {
				return (&net.Dialer{Timeout: 4 * time.Second}).DialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
			}
		}
		return nil, fmt.Errorf("link resolves to a non-public address")
	}
	return &http.Client{Transport: transport, Timeout: 6 * time.Second, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return fmt.Errorf("too many redirects")
		}
		_, err := parsePreviewURL(request.URL.String())
		return err
	}}
}

func publicPreviewIP(ip net.IP) bool {
	return ip != nil && ip.IsGlobalUnicast() && !ip.IsPrivate()
}

func parseLinkPreview(reader io.Reader, pageURL *url.URL) (linkPreview, error) {
	preview := linkPreview{URL: pageURL.String(), SiteName: pageURL.Hostname()}
	tokenizer := html.NewTokenizer(reader)
	for {
		switch tokenizer.Next() {
		case html.ErrorToken:
			if err := tokenizer.Err(); err != io.EOF {
				return preview, err
			}
			preview.Title = truncatePreviewText(preview.Title, 160)
			preview.Description = truncatePreviewText(preview.Description, 300)
			return preview, nil
		case html.StartTagToken, html.SelfClosingTagToken:
			token := tokenizer.Token()
			if token.Data == "meta" {
				attributes := map[string]string{}
				for _, attribute := range token.Attr {
					attributes[strings.ToLower(attribute.Key)] = strings.TrimSpace(attribute.Val)
				}
				key := strings.ToLower(attributes["property"])
				if key == "" {
					key = strings.ToLower(attributes["name"])
				}
				switch key {
				case "og:title", "twitter:title":
					if preview.Title == "" {
						preview.Title = attributes["content"]
					}
				case "og:description", "twitter:description", "description":
					if preview.Description == "" {
						preview.Description = attributes["content"]
					}
				case "og:site_name":
					if attributes["content"] != "" {
						preview.SiteName = attributes["content"]
					}
				case "og:image", "twitter:image":
					if preview.ImageURL == "" {
						preview.ImageURL = resolvePreviewReference(pageURL, attributes["content"])
					}
				}
			} else if token.Data == "title" && preview.Title == "" && tokenizer.Next() == html.TextToken {
				preview.Title = strings.TrimSpace(html.UnescapeString(string(tokenizer.Text())))
			} else if token.Data == "body" {
				preview.Title = truncatePreviewText(preview.Title, 160)
				preview.Description = truncatePreviewText(preview.Description, 300)
				return preview, nil
			}
		}
	}
}

func resolvePreviewReference(base *url.URL, raw string) string {
	reference, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(reference)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}
	return resolved.String()
}

func truncatePreviewText(value string, limit int) string {
	value = strings.Join(strings.Fields(html.UnescapeString(value)), " ")
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit-1]) + "…"
	}
	return value
}
