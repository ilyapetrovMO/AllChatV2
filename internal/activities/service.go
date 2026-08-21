// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package activities

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const SketchboardID = "allchat.sketchboard"

var (
	ErrNotFound  = errors.New("Activity resource not found")
	ErrForbidden = errors.New("Activity action forbidden")
	ErrDisabled  = errors.New("Activity is disabled")
	ErrInvalid   = errors.New("Activity request is invalid")
)

type Manifest struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Developer       string   `json:"developer"`
	Version         string   `json:"version"`
	HostAPIVersions []int    `json:"host_api_versions"`
	Capabilities    []string `json:"capabilities"`
	Bundled         bool     `json:"bundled"`
	EntryPoint      string   `json:"entry_point"`
	Integrity       string   `json:"integrity,omitempty"`
}

var SketchboardManifest = Manifest{ID: SketchboardID, Name: "Sketchboard", Description: "Draw together on shared Community sketchboards.", Developer: "AllChat", Version: "1.0.0", HostAPIVersions: []int{1}, Capabilities: []string{"community.identity", "resource.storage", "resource.realtime"}, Bundled: true, EntryPoint: "index.html"}

type Installation struct {
	Manifest  Manifest `json:"manifest"`
	Enabled   bool     `json:"enabled"`
	Installed string   `json:"installed_at"`
}

type Participant struct {
	MemberID string `json:"member_id"`
	Name     string `json:"name"`
}

type Board struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	OwnerID      string        `json:"owner_id"`
	OwnerName    string        `json:"owner_name"`
	CreatedAt    string        `json:"created_at"`
	UpdatedAt    string        `json:"updated_at"`
	CanDelete    bool          `json:"can_delete"`
	Participants []Participant `json:"participants"`
}

type Operation struct {
	Sequence int64           `json:"sequence"`
	MemberID string          `json:"member_id"`
	Kind     string          `json:"kind"`
	Payload  json.RawMessage `json:"payload"`
	Created  string          `json:"created_at"`
}

type BoardState struct {
	Board      Board           `json:"board"`
	Snapshot   json.RawMessage `json:"snapshot"`
	Sequence   int64           `json:"sequence"`
	Operations []Operation     `json:"operations"`
}

type Session struct {
	ID         string
	ActivityID string
	MemberID   string
	MemberName string
	ResourceID string
	ExpiresAt  time.Time
}

type presenceLease struct {
	participant Participant
	expiresAt   time.Time
}

// Service is the deep Activities module. Authentication, ownership, durable
// resources, ordered operations, and ephemeral participant leases live behind
// this interface so HTTP and future native adapters do not reproduce them.
type Service struct {
	db       *sql.DB
	dataDir  string
	now      func() time.Time
	mu       sync.Mutex
	presence map[string]map[string]presenceLease
}

func New(db *sql.DB, dataDir ...string) *Service {
	root := ""
	if len(dataDir) > 0 {
		root = dataDir[0]
	}
	return &Service{db: db, dataDir: root, now: time.Now, presence: map[string]map[string]presenceLease{}}
}

func (s *Service) Installations(ctx context.Context) ([]Installation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT activity_id,manifest,enabled,installed_at FROM activity_installations ORDER BY activity_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Installation{}
	for rows.Next() {
		var id, installed string
		var encoded []byte
		var enabled bool
		if err := rows.Scan(&id, &encoded, &enabled, &installed); err != nil {
			return nil, err
		}
		var manifest Manifest
		if id == SketchboardID {
			manifest = SketchboardManifest
		} else if json.Unmarshal(encoded, &manifest) != nil {
			continue
		}
		items = append(items, Installation{Manifest: manifest, Enabled: enabled, Installed: installed})
	}
	return items, rows.Err()
}

var activityIDPattern = regexp.MustCompile(`^[a-z0-9]+(?:[.-][a-z0-9]+)+$`)

// InstallBundle installs a declarative, static Activity package. Packages never
// execute server-side code: they are zip files containing a manifest.json and
// browser assets that run in the sandboxed Activity frame.
func (s *Service) InstallBundle(ctx context.Context, bundle []byte) (Installation, error) {
	if s.dataDir == "" || len(bundle) == 0 || len(bundle) > 10<<20 {
		return Installation{}, ErrInvalid
	}
	archive, err := zip.NewReader(bytes.NewReader(bundle), int64(len(bundle)))
	if err != nil || len(archive.File) == 0 || len(archive.File) > 100 {
		return Installation{}, ErrInvalid
	}
	var manifest Manifest
	var total uint64
	for _, file := range archive.File {
		name, valid := safeBundlePath(file.Name)
		if !valid || file.UncompressedSize64 > 5<<20 {
			return Installation{}, ErrInvalid
		}
		total += file.UncompressedSize64
		if total > 25<<20 {
			return Installation{}, ErrInvalid
		}
		if name == "manifest.json" {
			reader, openErr := file.Open()
			if openErr != nil {
				return Installation{}, ErrInvalid
			}
			decodeErr := json.NewDecoder(io.LimitReader(reader, 64<<10)).Decode(&manifest)
			_ = reader.Close()
			if decodeErr != nil {
				return Installation{}, ErrInvalid
			}
		}
	}
	entry, valid := safeBundlePath(manifest.EntryPoint)
	if !valid || !activityIDPattern.MatchString(manifest.ID) || manifest.ID == SketchboardID || strings.TrimSpace(manifest.Name) == "" || strings.TrimSpace(manifest.Developer) == "" || strings.TrimSpace(manifest.Version) == "" || !supportsHostAPI(manifest.HostAPIVersions) {
		return Installation{}, ErrInvalid
	}
	manifest.EntryPoint = entry
	manifest.Bundled = false
	digest := sha256.Sum256(bundle)
	manifest.Integrity = fmt.Sprintf("sha256-%x", digest[:])
	destination := filepath.Join(s.dataDir, "activities", manifest.ID, manifest.Version)
	if _, err := os.Stat(destination); err == nil {
		return Installation{}, ErrInvalid
	}
	activitiesRoot := filepath.Join(s.dataDir, "activities")
	if err := os.MkdirAll(activitiesRoot, 0o750); err != nil {
		return Installation{}, err
	}
	staging, err := os.MkdirTemp(activitiesRoot, ".install-")
	if err != nil {
		return Installation{}, err
	}
	defer os.RemoveAll(staging)
	foundEntry := false
	for _, file := range archive.File {
		name, _ := safeBundlePath(file.Name)
		if name == "manifest.json" || file.FileInfo().IsDir() {
			continue
		}
		if name == entry {
			foundEntry = true
		}
		target := filepath.Join(staging, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return Installation{}, err
		}
		reader, err := file.Open()
		if err != nil {
			return Installation{}, err
		}
		contents, readErr := io.ReadAll(io.LimitReader(reader, 5<<20+1))
		_ = reader.Close()
		if readErr != nil || len(contents) > 5<<20 {
			return Installation{}, ErrInvalid
		}
		if err := os.WriteFile(target, contents, 0o640); err != nil {
			return Installation{}, err
		}
	}
	if !foundEntry {
		return Installation{}, ErrInvalid
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o750); err != nil {
		return Installation{}, err
	}
	if err := os.Rename(staging, destination); err != nil {
		return Installation{}, err
	}
	encoded, _ := json.Marshal(manifest)
	now := s.now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO activity_installations(activity_id,version,manifest,enabled,installed_at,updated_at) VALUES(?,?,?,0,?,?) ON CONFLICT(activity_id) DO UPDATE SET version=excluded.version,manifest=excluded.manifest,enabled=0,installed_at=excluded.installed_at,updated_at=excluded.updated_at`, manifest.ID, manifest.Version, encoded, now, now)
	if err != nil {
		return Installation{}, err
	}
	return Installation{Manifest: manifest, Enabled: false, Installed: now}, nil
}

func (s *Service) RuntimeFile(ctx context.Context, activityID, name string) ([]byte, string, error) {
	var version string
	var encoded []byte
	var enabled bool
	if err := s.db.QueryRowContext(ctx, `SELECT version,manifest,enabled FROM activity_installations WHERE activity_id=?`, activityID).Scan(&version, &encoded, &enabled); errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	} else if err != nil {
		return nil, "", err
	}
	if !enabled {
		return nil, "", ErrDisabled
	}
	var manifest Manifest
	if json.Unmarshal(encoded, &manifest) != nil || manifest.Bundled {
		return nil, "", ErrNotFound
	}
	if name == "" {
		name = manifest.EntryPoint
	}
	clean, valid := safeBundlePath(name)
	if !valid {
		return nil, "", ErrInvalid
	}
	contents, err := os.ReadFile(filepath.Join(s.dataDir, "activities", activityID, version, filepath.FromSlash(clean)))
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", ErrNotFound
	}
	return contents, clean, err
}

func safeBundlePath(name string) (string, bool) {
	name = filepath.ToSlash(strings.TrimSpace(name))
	clean := filepath.ToSlash(filepath.Clean(name))
	if name == "" || clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || strings.Contains(name, `\`) {
		return "", false
	}
	return clean, true
}

func supportsHostAPI(versions []int) bool {
	for _, version := range versions {
		if version == 1 {
			return true
		}
	}
	return false
}

func (s *Service) SetEnabled(ctx context.Context, activityID string, enabled bool) error {
	result, err := s.db.ExecContext(ctx, `UPDATE activity_installations SET enabled=?,updated_at=? WHERE activity_id=?`, enabled, s.now().UTC().Format(time.RFC3339Nano), activityID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	if !enabled {
		_, err = s.db.ExecContext(ctx, `DELETE FROM activity_sessions WHERE activity_id=?`, activityID)
	}
	return err
}

func (s *Service) Launch(ctx context.Context, activityID, memberID, memberName, resourceID string) (string, Session, error) {
	var enabled bool
	if err := s.db.QueryRowContext(ctx, `SELECT enabled FROM activity_installations WHERE activity_id=?`, activityID).Scan(&enabled); errors.Is(err, sql.ErrNoRows) {
		return "", Session{}, ErrNotFound
	} else if err != nil {
		return "", Session{}, err
	}
	if !enabled {
		return "", Session{}, ErrDisabled
	}
	if resourceID != "" {
		var exists bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sketchboards WHERE id=? AND deleted_at IS NULL)`, resourceID).Scan(&exists); err != nil {
			return "", Session{}, err
		}
		if !exists {
			return "", Session{}, ErrNotFound
		}
	}
	token, err := randomToken()
	if err != nil {
		return "", Session{}, err
	}
	id, err := randomToken()
	if err != nil {
		return "", Session{}, err
	}
	expires := s.now().UTC().Add(15 * time.Minute)
	_, err = s.db.ExecContext(ctx, `INSERT INTO activity_sessions(id,token_hash,activity_id,member_id,resource_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?)`, id, tokenHash(token), activityID, memberID, nullable(resourceID), s.now().UTC().Format(time.RFC3339Nano), expires.Format(time.RFC3339Nano))
	return token, Session{ID: id, ActivityID: activityID, MemberID: memberID, MemberName: memberName, ResourceID: resourceID, ExpiresAt: expires}, err
}

func (s *Service) Authenticate(ctx context.Context, token string) (Session, error) {
	var session Session
	var resource sql.NullString
	var expires string
	err := s.db.QueryRowContext(ctx, `SELECT activity_sessions.id,activity_sessions.activity_id,activity_sessions.member_id,COALESCE(members.display_name,members.username),activity_sessions.resource_id,activity_sessions.expires_at FROM activity_sessions JOIN activity_installations ON activity_installations.activity_id=activity_sessions.activity_id AND activity_installations.enabled=1 JOIN members ON members.id=activity_sessions.member_id WHERE activity_sessions.token_hash=?`, tokenHash(token)).Scan(&session.ID, &session.ActivityID, &session.MemberID, &session.MemberName, &resource, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrForbidden
	}
	if err != nil {
		return Session{}, err
	}
	session.ResourceID = resource.String
	session.ExpiresAt, err = time.Parse(time.RFC3339Nano, expires)
	if err != nil || !session.ExpiresAt.After(s.now().UTC()) {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM activity_sessions WHERE id=?`, session.ID)
		return Session{}, ErrForbidden
	}
	return session, nil
}

func (s *Service) Boards(ctx context.Context, actorID string) ([]Board, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT sketchboards.id,sketchboards.name,sketchboards.owner_id,COALESCE(members.display_name,members.username),sketchboards.created_at,sketchboards.updated_at FROM sketchboards JOIN members ON members.id=sketchboards.owner_id WHERE sketchboards.deleted_at IS NULL ORDER BY sketchboards.updated_at DESC,sketchboards.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	boards := []Board{}
	for rows.Next() {
		var board Board
		if err := rows.Scan(&board.ID, &board.Name, &board.OwnerID, &board.OwnerName, &board.CreatedAt, &board.UpdatedAt); err != nil {
			return nil, err
		}
		board.CanDelete = board.OwnerID == actorID
		board.Participants = s.Participants(board.ID)
		boards = append(boards, board)
	}
	return boards, rows.Err()
}

func (s *Service) CreateBoard(ctx context.Context, ownerID, name string) (Board, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 80 {
		return Board{}, ErrInvalid
	}
	id, err := randomToken()
	if err != nil {
		return Board{}, err
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `INSERT INTO sketchboards(id,name,owner_id,created_at,updated_at,snapshot,next_sequence) VALUES(?,?,?,?,?,'[]',1)`, id, name, ownerID, now, now)
	if err != nil {
		return Board{}, err
	}
	var owner string
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(display_name,username) FROM members WHERE id=?`, ownerID).Scan(&owner); err != nil {
		return Board{}, err
	}
	return Board{ID: id, Name: name, OwnerID: ownerID, OwnerName: owner, CreatedAt: now, UpdatedAt: now, CanDelete: true, Participants: []Participant{}}, nil
}

func (s *Service) DeleteBoard(ctx context.Context, actorID, boardID string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE sketchboards SET deleted_at=?,updated_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL`, s.now().UTC().Format(time.RFC3339Nano), s.now().UTC().Format(time.RFC3339Nano), boardID, actorID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		var exists bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sketchboards WHERE id=? AND deleted_at IS NULL)`, boardID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrForbidden
		}
		return ErrNotFound
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM activity_sessions WHERE resource_id=?`, boardID)
	s.mu.Lock()
	delete(s.presence, boardID)
	s.mu.Unlock()
	return nil
}

func (s *Service) BoardState(ctx context.Context, actorID, boardID string, after int64) (BoardState, error) {
	boards, err := s.Boards(ctx, actorID)
	if err != nil {
		return BoardState{}, err
	}
	var board *Board
	for index := range boards {
		if boards[index].ID == boardID {
			board = &boards[index]
			break
		}
	}
	if board == nil {
		return BoardState{}, ErrNotFound
	}
	var snapshot []byte
	var sequence int64
	if err := s.db.QueryRowContext(ctx, `SELECT snapshot,next_sequence-1 FROM sketchboards WHERE id=? AND deleted_at IS NULL`, boardID).Scan(&snapshot, &sequence); err != nil {
		return BoardState{}, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT sequence,member_id,kind,payload,created_at FROM sketchboard_operations WHERE board_id=? AND sequence>? ORDER BY sequence LIMIT 1000`, boardID, after)
	if err != nil {
		return BoardState{}, err
	}
	defer rows.Close()
	operations := []Operation{}
	for rows.Next() {
		var op Operation
		var payload []byte
		if err := rows.Scan(&op.Sequence, &op.MemberID, &op.Kind, &payload, &op.Created); err != nil {
			return BoardState{}, err
		}
		op.Payload = json.RawMessage(payload)
		operations = append(operations, op)
	}
	return BoardState{Board: *board, Snapshot: json.RawMessage(snapshot), Sequence: sequence, Operations: operations}, rows.Err()
}

func (s *Service) AppendOperation(ctx context.Context, actorID, boardID, kind string, payload json.RawMessage) (Operation, error) {
	if kind != "stroke" && kind != "clear" {
		return Operation{}, ErrInvalid
	}
	if len(payload) == 0 || len(payload) > 64<<10 || !json.Valid(payload) {
		return Operation{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Operation{}, err
	}
	defer tx.Rollback()
	var sequence int64
	if err := tx.QueryRowContext(ctx, `UPDATE sketchboards SET next_sequence=next_sequence+1,updated_at=? WHERE id=? AND deleted_at IS NULL RETURNING next_sequence-1`, s.now().UTC().Format(time.RFC3339Nano), boardID).Scan(&sequence); errors.Is(err, sql.ErrNoRows) {
		return Operation{}, ErrNotFound
	} else if err != nil {
		return Operation{}, err
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `INSERT INTO sketchboard_operations(board_id,sequence,member_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)`, boardID, sequence, actorID, kind, []byte(payload), now); err != nil {
		return Operation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Operation{}, err
	}
	return Operation{Sequence: sequence, MemberID: actorID, Kind: kind, Payload: payload, Created: now}, nil
}

func (s *Service) Touch(boardID string, participant Participant) {
	s.mu.Lock()
	defer s.mu.Unlock()
	leases := s.presence[boardID]
	if leases == nil {
		leases = map[string]presenceLease{}
		s.presence[boardID] = leases
	}
	leases[participant.MemberID] = presenceLease{participant: participant, expiresAt: s.now().Add(15 * time.Second)}
}

func (s *Service) Leave(boardID, memberID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.presence[boardID], memberID)
}

func (s *Service) Participants(boardID string) []Participant {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	leases := s.presence[boardID]
	participants := []Participant{}
	for id, lease := range leases {
		if !lease.expiresAt.After(now) {
			delete(leases, id)
			continue
		}
		participants = append(participants, lease.participant)
	}
	return participants
}

func randomToken() (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
func tokenHash(token string) []byte { digest := sha256.Sum256([]byte(token)); return digest[:] }
func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
