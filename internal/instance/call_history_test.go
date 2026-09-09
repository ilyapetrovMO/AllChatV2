package instance

import (
	"context"
	"testing"
	"time"

	"allchat/internal/community"
	"allchat/internal/identity"
	"allchat/internal/media"
)

func TestDurableCallHistoryUsesDMSequenceAndCannotBeEdited(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	db, err := openDatabase(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"caller", "recipient", "stranger"} {
		if _, err = db.Exec(`INSERT INTO members(id,username,username_key,password_hash,created_at) VALUES(?,?,?,'hash',?)`, id, id, id, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			t.Fatal(err)
		}
	}
	service := community.New(db, dir)
	defer service.Close()
	caller := identity.Member{ID: "caller", Username: "caller"}
	recipient := identity.Member{ID: "recipient", Username: "recipient"}
	dm, err := service.OpenDirectMessage(ctx, caller, recipient.ID)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	call := media.DirectCall{ID: "call1", DirectMessageID: dm.ID, CallerID: caller.ID, RecipientID: recipient.ID, State: "ringing", CreatedAt: now.Format(time.RFC3339Nano)}
	record := func() {
		t.Helper()
		if err := service.RecordCallEvent(ctx, call); err != nil {
			t.Fatal(err)
		}
	}
	record()
	record()
	call.State = "accepted"
	call.AcceptedAt = now.Add(time.Second).Format(time.RFC3339Nano)
	record()
	call.State = "ended"
	call.FinishedAt = now.Add(755 * time.Second).Format(time.RFC3339Nano)
	record()
	for _, viewer := range []identity.Member{caller, recipient} {
		messages, err := service.ListMessages(ctx, viewer, dm.ID, 0, 50)
		if err != nil {
			t.Fatal(err)
		}
		if len(messages) != 3 {
			t.Fatalf("messages=%+v", messages)
		}
		for index, message := range messages {
			if message.CallEvent == nil || message.Sequence != int64(index+1) {
				t.Fatalf("message=%+v", message)
			}
		}
		if err := service.DeleteMessage(ctx, viewer, messages[0].ID); err == nil {
			t.Fatal("call event deleted")
		}
		if _, err := service.EditMessage(ctx, viewer, messages[0].ID, "changed"); err == nil {
			t.Fatal("call event edited")
		}
	}
	if _, err := service.ListMessages(ctx, identity.Member{ID: "stranger"}, dm.ID, 0, 50); err == nil {
		t.Fatal("stranger read DM call history")
	}
	page, err := service.ListMessagesAfter(ctx, recipient, dm.ID, 1, 1)
	if err != nil || len(page) != 1 || page[0].CallEvent.State != "accepted" {
		t.Fatalf("page=%+v %v", page, err)
	}
	var count int
	if err = db.QueryRow(`SELECT count(*) FROM realtime_events WHERE channel_id=? AND event_type='message.created'`, dm.ID).Scan(&count); err != nil || count != 3 {
		t.Fatalf("realtime count=%d %v", count, err)
	}
	// Simulate a process restart while a second call was accepted.
	call.ID = "call2"
	call.State = "accepted"
	call.FinishedAt = ""
	record()
	service.Close()
	service = community.New(db, dir)
	defer service.Close()
	if err = service.RecoverCallHistory(ctx); err != nil {
		t.Fatal(err)
	}
	if err = service.RecoverCallHistory(ctx); err != nil {
		t.Fatal(err)
	}
	messages, err := service.ListMessages(ctx, recipient, dm.ID, 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 5 || messages[4].CallEvent.State != "ended" {
		t.Fatalf("recovered history=%+v", messages)
	}
}
