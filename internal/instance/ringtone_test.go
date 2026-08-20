package instance

import (
	"bytes"
	"net/http/httptest"
	"testing"
)

func TestRingtoneResolutionPrefersMemberThenCommunityThenTone(t *testing.T) {
	db, err := openDatabase(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO members(id,username,username_key,password_hash,created_at) VALUES('member','member','member','hash','now'); INSERT INTO community(id,owner_member_id) VALUES(1,'member')`); err != nil {
		t.Fatal(err)
	}
	i := &Instance{db: db}
	if _, _, source, err := i.resolvedRingtone("member"); err != nil || source != "tone" {
		t.Fatalf("fallback source=%q err=%v", source, err)
	}
	if _, err = db.Exec("UPDATE community SET ringtone=?,ringtone_content_type='audio/ogg' WHERE id=1", []byte("community")); err != nil {
		t.Fatal(err)
	}
	data, _, source, err := i.resolvedRingtone("member")
	if err != nil || source != "community" || string(data) != "community" {
		t.Fatalf("Community result=%q source=%q err=%v", data, source, err)
	}
	if _, err = db.Exec(`INSERT INTO member_notification_settings(member_id,level,muted,sound_enabled,ringtone,ringtone_content_type) VALUES('member','all_messages',0,1,?,'audio/mpeg')`, []byte("member")); err != nil {
		t.Fatal(err)
	}
	data, _, source, err = i.resolvedRingtone("member")
	if err != nil || source != "member" || string(data) != "member" {
		t.Fatalf("Member result=%q source=%q err=%v", data, source, err)
	}
}

func TestRingtoneUploadValidation(t *testing.T) {
	request := httptest.NewRequest("PUT", "/api/v1/member-ringtone", bytes.NewReader([]byte("audio")))
	request.Header.Set("Content-Type", "audio/ogg")
	data, contentType, err := readRingtone(request)
	if err != nil || string(data) != "audio" || contentType != "audio/ogg" {
		t.Fatalf("data=%q type=%q err=%v", data, contentType, err)
	}
	request = httptest.NewRequest("PUT", "/api/v1/member-ringtone", bytes.NewReader([]byte("bad")))
	request.Header.Set("Content-Type", "text/plain")
	if _, _, err = readRingtone(request); err == nil {
		t.Fatal("text ringtone accepted")
	}
}
