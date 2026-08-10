package instance

import (
	"context"
	"testing"
	"time"

	"allchat/internal/community"
	"allchat/internal/identity"
)

func TestModerationActionsEnforceAndAuditWithoutMessageContent(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
		INSERT INTO members(id,username,username_key,password_hash,created_at) VALUES
		 ('owner','Owner','owner','hash','now'),('member','Member','member','hash','now');
		INSERT INTO community(id,owner_member_id) VALUES(1,'owner');
		INSERT INTO member_roles(member_id,role_id) VALUES('owner','owner'),('member','member');
		INSERT INTO categories(id,name,position) VALUES('category','General',0);
		INSERT INTO channels(id,category_id,name,type,position) VALUES('channel','category','chat','text',0);
		INSERT INTO channel_sequences(channel_id,next_sequence) VALUES('channel',2);
		INSERT INTO messages(id,channel_id,author_id,sequence,body,rendered_html,created_at) VALUES('message','channel','member',1,'secret deleted content','secret deleted content','now');
		INSERT INTO message_search(message_id,channel_id,body) VALUES('message','channel','secret deleted content');
		INSERT INTO sessions(token_hash,member_id,created_at,last_seen_at,expires_at,session_id,user_agent,csrf_token_hash) VALUES(X'01','member','now','now','9999','session','test',X'02');
	`)
	if err != nil {
		t.Fatal(err)
	}
	service := community.New(db, directory)
	defer service.Close()
	owner := identity.Member{ID: "owner", Username: "Owner", Owner: true}
	ctx := context.Background()
	record, err := service.ApplyModeration(ctx, owner, community.ModerationAction{Action: "timeout", TargetMemberID: "member", Reason: "Repeated flooding", DurationMinutes: 10})
	if err != nil {
		t.Fatal(err)
	}
	if record.Action != "timeout" {
		t.Fatalf("record = %+v", record)
	}
	var timeout string
	if err = db.QueryRow(`SELECT timed_out_until FROM members WHERE id='member'`).Scan(&timeout); err != nil {
		t.Fatal(err)
	}
	if timeout <= time.Now().UTC().Format(time.RFC3339Nano) {
		t.Fatalf("timeout not in future: %s", timeout)
	}
	if _, err = service.ApplyModeration(ctx, owner, community.ModerationAction{Action: "kick", TargetMemberID: "member", Reason: "Cool down"}); err != nil {
		t.Fatal(err)
	}
	var revoked bool
	if err = db.QueryRow(`SELECT revoked_at IS NOT NULL FROM sessions WHERE session_id='session'`).Scan(&revoked); err != nil || !revoked {
		t.Fatalf("session revoked=%v err=%v", revoked, err)
	}
	if _, err = service.ApplyModeration(ctx, owner, community.ModerationAction{Action: "delete_message", TargetMessageID: "message", Reason: "Removed abusive post"}); err != nil {
		t.Fatal(err)
	}
	var body *string
	if err = db.QueryRow(`SELECT body FROM messages WHERE id='message'`).Scan(&body); err != nil {
		t.Fatal(err)
	}
	if body != nil {
		t.Fatalf("body retained: %q", *body)
	}
	var leaked int
	if err = db.QueryRow(`SELECT COUNT(*) FROM moderation_records WHERE reason LIKE '%secret deleted content%' OR outcome LIKE '%secret deleted content%'`).Scan(&leaked); err != nil {
		t.Fatal(err)
	}
	if leaked != 0 {
		t.Fatal("deleted body leaked into audit")
	}
	records, err := service.ListModerationRecords(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 3 {
		t.Fatalf("records=%d", len(records))
	}
}

func TestOnlyOwnerCanPurgeModerationRecordsAndPurgeIsRecorded(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO members(id,username,username_key,password_hash,created_at) VALUES('owner','Owner','owner','hash','now'),('member','Member','member','hash','now'); INSERT INTO community(id,owner_member_id) VALUES(1,'owner'); INSERT INTO member_roles(member_id,role_id) VALUES('owner','owner'),('member','member'); INSERT INTO moderation_records(actor_id,action,reason,outcome,created_at) VALUES('owner','warn','old','applied','2000-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	service := community.New(db, directory)
	defer service.Close()
	ctx := context.Background()
	if _, err = service.PurgeModerationRecords(ctx, identity.Member{ID: "member"}, "2020-01-01T00:00:00Z"); err != community.ErrForbidden {
		t.Fatalf("non-owner purge = %v", err)
	}
	record, err := service.PurgeModerationRecords(ctx, identity.Member{ID: "owner", Owner: true}, "2020-01-01T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if record.Action != "purge_records" {
		t.Fatalf("record=%+v", record)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM moderation_records`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("records after purge=%d", count)
	}
}

func TestBatchedMessageIsImmediatelyVisibleToRealtimeReaders(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO members(id,username,username_key,password_hash,created_at)VALUES('owner','Owner','owner','hash','now');INSERT INTO community(id,owner_member_id)VALUES(1,'owner');INSERT INTO member_roles(member_id,role_id)VALUES('owner','owner');INSERT INTO categories(id,name,position)VALUES('cat','General',0);INSERT INTO channels(id,category_id,name,type,position)VALUES('channel','cat','chat','text',0)`)
	if err != nil {
		t.Fatal(err)
	}
	service := community.New(db, directory)
	defer service.Close()
	owner := identity.Member{ID: "owner", Username: "Owner", Owner: true}
	message, err := service.PublishMessage(context.Background(), owner, "channel", "incoming")
	if err != nil {
		t.Fatal(err)
	}
	events, cursor, snapshot, err := service.RealtimeEventsAfter(context.Background(), owner, 0, 128)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot || cursor < 1 || len(events) != 1 || events[0].Type != "message.created" || events[0].Cursor < 1 {
		t.Fatalf("message=%+v events=%+v cursor=%d snapshot=%v", message, events, cursor, snapshot)
	}
}
