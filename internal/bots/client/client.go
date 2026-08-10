// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"
)

type Member struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Owner       bool   `json:"owner"`
}
type Channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}
type Message struct {
	ID         string `json:"id"`
	ChannelID  string `json:"channel_id"`
	AuthorID   string `json:"author_id"`
	AuthorName string `json:"author_name"`
	Sequence   int64  `json:"sequence"`
	Body       string `json:"body"`
	Deleted    bool   `json:"deleted"`
}

type Client struct {
	Base   *url.URL
	HTTP   *http.Client
	Member Member
}

func New(raw string) (*Client, error) {
	base, err := url.Parse(raw)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("invalid Instance URL %q", raw)
	}
	jar, _ := cookiejar.New(nil)
	return &Client{Base: base, HTTP: &http.Client{Jar: jar, Timeout: 20 * time.Second}}, nil
}
func (c *Client) Authenticate(ctx context.Context, username, password, invite string) error {
	input := map[string]string{"username": username, "password": password}
	if err := c.JSON(ctx, http.MethodPost, "/api/v1/auth/login", input, &c.Member); err == nil {
		return nil
	}
	if invite == "" {
		return fmt.Errorf("login failed and no Invitation was provided")
	}
	input["token"] = invite
	if err := c.JSON(ctx, http.MethodPost, "/api/v1/auth/register", input, &c.Member); err != nil {
		return fmt.Errorf("authenticate music bot: %w", err)
	}
	return nil
}
func (c *Client) Channels(ctx context.Context) ([]Channel, error) {
	var value struct {
		Channels []Channel `json:"channels"`
	}
	err := c.JSON(ctx, http.MethodGet, "/api/v1/channels", nil, &value)
	return value.Channels, err
}
func (c *Client) Members(ctx context.Context) ([]Member, error) {
	var value struct {
		Members []Member `json:"members"`
	}
	err := c.JSON(ctx, http.MethodGet, "/api/v1/members", nil, &value)
	return value.Members, err
}
func (c *Client) RoomForMember(ctx context.Context, memberID string) (Channel, bool, error) {
	channels, err := c.Channels(ctx)
	if err != nil {
		return Channel{}, false, err
	}
	for _, channel := range channels {
		if channel.Type != "voice" {
			continue
		}
		var value struct {
			Participants []struct {
				MemberID  string `json:"member_id"`
				Connected bool   `json:"connected"`
			} `json:"participants"`
		}
		if err = c.JSON(ctx, http.MethodGet, "/api/v1/voice/"+url.PathEscape(channel.ID)+"/participants", nil, &value); err != nil {
			continue
		}
		for _, participant := range value.Participants {
			if participant.MemberID == memberID && participant.Connected {
				return channel, true, nil
			}
		}
	}
	return Channel{}, false, nil
}
func (c *Client) Publish(ctx context.Context, channelID, body, replyTo string) error {
	return c.JSON(ctx, http.MethodPost, "/api/v1/channels/"+url.PathEscape(channelID)+"/messages", map[string]any{"body": body, "reply_to": replyTo}, nil)
}
func (c *Client) JSON(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.Base.ResolveReference(&url.URL{Path: path}).String(), body)
	if err != nil {
		return err
	}
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
		for _, cookie := range c.HTTP.Jar.Cookies(c.Base) {
			if cookie.Name == "allchat_csrf" {
				request.Header.Set("X-CSRF-Token", cookie.Value)
			}
		}
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		return fmt.Errorf("%s %s: %s %s", method, path, response.Status, strings.TrimSpace(string(data)))
	}
	if output != nil {
		return json.NewDecoder(response.Body).Decode(output)
	}
	return nil
}

func (c *Client) StreamMessages(ctx context.Context, handle func(Message)) error {
	var cursor *int64
	delay := time.Duration(0)
	for ctx.Err() == nil {
		if delay > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
		}
		connection, err := c.dialRealtime(ctx, cursor)
		if err != nil {
			delay = minDelay(delay)
			continue
		}
		delay = 0
		heartbeat := time.NewTicker(10 * time.Second)
		closed := false
		for !closed {
			readCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			_, payload, readErr := connection.Read(readCtx)
			cancel()
			if readErr != nil {
				closed = true
				break
			}
			var frame struct {
				Type     string          `json:"type"`
				Cursor   int64           `json:"cursor"`
				Payload  json.RawMessage `json:"payload"`
				Snapshot *struct {
					Cursor int64 `json:"cursor"`
				} `json:"snapshot"`
				Events []struct {
					Type    string          `json:"type"`
					Cursor  int64           `json:"cursor"`
					Payload json.RawMessage `json:"payload"`
				} `json:"events"`
			}
			if json.Unmarshal(payload, &frame) != nil {
				continue
			}
			if frame.Cursor >= 0 {
				value := frame.Cursor
				cursor = &value
			}
			events := frame.Events
			if frame.Type != "events" {
				events = []struct {
					Type    string          `json:"type"`
					Cursor  int64           `json:"cursor"`
					Payload json.RawMessage `json:"payload"`
				}{{Type: frame.Type, Cursor: frame.Cursor, Payload: frame.Payload}}
			}
			for _, event := range events {
				if event.Type != "message.created" {
					continue
				}
				var message Message
				if json.Unmarshal(event.Payload, &message) == nil && message.AuthorID != c.Member.ID && !message.Deleted {
					handle(message)
				}
			}
			select {
			case <-heartbeat.C:
				writeCtx, stop := context.WithTimeout(ctx, 3*time.Second)
				_ = connection.Write(writeCtx, websocket.MessageText, []byte(`{"type":"heartbeat"}`))
				stop()
			default:
			}
		}
		heartbeat.Stop()
		connection.CloseNow()
		delay = minDelay(delay)
	}
	return ctx.Err()
}
func (c *Client) dialRealtime(ctx context.Context, cursor *int64) (*websocket.Conn, error) {
	target := *c.Base
	if target.Scheme == "https" {
		target.Scheme = "wss"
	} else {
		target.Scheme = "ws"
	}
	target.Path = "/api/v1/realtime"
	if cursor != nil {
		target.RawQuery = fmt.Sprintf("cursor=%d", *cursor)
	} else {
		target.RawQuery = ""
	}
	headers := http.Header{}
	for _, cookie := range c.HTTP.Jar.Cookies(c.Base) {
		headers.Add("Cookie", cookie.String())
	}
	connection, response, err := websocket.Dial(ctx, target.String(), &websocket.DialOptions{HTTPHeader: headers})
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	return connection, err
}
func minDelay(previous time.Duration) time.Duration {
	if previous == 0 {
		return 500 * time.Millisecond
	}
	previous *= 2
	if previous > 5*time.Second {
		return 5 * time.Second
	}
	return previous
}
