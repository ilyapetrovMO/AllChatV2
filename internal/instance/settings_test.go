package instance

import (
	"context"
	"testing"

	"allchat/internal/community"
	"allchat/internal/identity"
)

func TestAttachmentLimitUpdatesImmediatelyAndPersists(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	owner := identity.Member{ID: "owner", Owner: true}
	service := community.New(db, directory)
	if err = service.UpdateMaxAttachmentBytes(context.Background(), owner, 20<<20); err != nil {
		t.Fatal(err)
	}
	if service.MaxAttachmentBytes() != 20<<20 {
		t.Fatalf("live limit = %d", service.MaxAttachmentBytes())
	}
	service.Close()
	reopened := community.New(db, directory)
	defer reopened.Close()
	if reopened.MaxAttachmentBytes() != 20<<20 {
		t.Fatalf("persisted limit = %d", reopened.MaxAttachmentBytes())
	}
}

func TestOnlyOwnerCanUpdateAttachmentLimit(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	service := community.New(db, directory)
	defer service.Close()
	if err = service.UpdateMaxAttachmentBytes(context.Background(), identity.Member{ID: "member"}, 20<<20); err != community.ErrForbidden {
		t.Fatalf("member update error = %v", err)
	}
	if err = service.UpdateMaxAttachmentBytes(context.Background(), identity.Member{ID: "owner", Owner: true}, 26<<20); err == nil {
		t.Fatal("limit above hard ceiling succeeded")
	}
}
