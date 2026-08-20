package instance

import (
	"context"
	"testing"

	"allchat/internal/community"
	"allchat/internal/identity"
)

func TestAccountDeletionAnonymizesMemberRevokesAccessAndPreservesMessages(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	ident, err := identity.New(db, directory)
	if err != nil {
		t.Fatal(err)
	}
	token, err := ident.BootstrapToken(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	owner, _, err := ident.Bootstrap(context.Background(), token, "owner-user", "owner password long enough", "test")
	if err != nil {
		t.Fatal(err)
	}
	communityService := community.New(db, directory)
	defer communityService.Close()
	invite, err := communityService.CreateInvitation(context.Background(), owner, community.InvitationInput{ExpiresInMinutes: 60, MaxUses: 1})
	if err != nil {
		t.Fatal(err)
	}
	member, credentials, err := ident.Register(context.Background(), invite.Token, "member-user", "member password long enough", "test")
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO categories(id,name,position)VALUES('cat','General',0);INSERT INTO channels(id,category_id,name,type,position)VALUES('channel','cat','chat','text',0);INSERT INTO channel_sequences(channel_id,next_sequence)VALUES('channel',2);INSERT INTO messages(id,channel_id,author_id,sequence,body,rendered_html,created_at)VALUES('message','channel',?,1,'retained words','retained words','now')`, member.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = ident.AnonymizeMember(context.Background(), member, "member password long enough", "DELETE MY ACCOUNT"); err != nil {
		t.Fatal(err)
	}
	if _, err = ident.MemberForSession(context.Background(), credentials.Token); err != identity.ErrInvalidCredentials {
		t.Fatalf("deleted Session error=%v", err)
	}
	if _, _, err = ident.Authenticate(context.Background(), "member-user", "member password long enough", "test", "test"); err != identity.ErrInvalidCredentials {
		t.Fatalf("deleted login error=%v", err)
	}
	var username, body string
	if err = db.QueryRow(`SELECT m.username,msg.body FROM members m JOIN messages msg ON msg.author_id=m.id WHERE msg.id='message'`).Scan(&username, &body); err != nil {
		t.Fatal(err)
	}
	if username == "member-user" || body != "retained words" {
		t.Fatalf("username=%q body=%q", username, body)
	}
	if err = ident.AnonymizeMember(context.Background(), owner, "owner password long enough", "DELETE MY ACCOUNT"); err == nil {
		t.Fatal("Owner deletion succeeded")
	}
}

func TestOwnerCanDisableRestoreAndPermanentlyDeleteMember(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	ident, err := identity.New(db, directory)
	if err != nil {
		t.Fatal(err)
	}
	token, _ := ident.BootstrapToken(context.Background())
	owner, _, err := ident.Bootstrap(context.Background(), token, "owner-user", "owner password long enough", "test")
	if err != nil {
		t.Fatal(err)
	}
	communityService := community.New(db, directory)
	defer communityService.Close()
	invite, err := communityService.CreateInvitation(context.Background(), owner, community.InvitationInput{ExpiresInMinutes: 60, MaxUses: 1})
	if err != nil {
		t.Fatal(err)
	}
	member, credentials, err := ident.Register(context.Background(), invite.Token, "member-user", "member password long enough", "test")
	if err != nil {
		t.Fatal(err)
	}
	if err = ident.SetMemberDisabled(context.Background(), owner, member, true); err != nil {
		t.Fatal(err)
	}
	if _, err = ident.MemberForSession(context.Background(), credentials.Token); err != identity.ErrInvalidCredentials {
		t.Fatalf("disabled Session error=%v", err)
	}
	if _, _, err = ident.Authenticate(context.Background(), member.Username, "member password long enough", "test", "test"); err != identity.ErrInvalidCredentials {
		t.Fatalf("disabled login error=%v", err)
	}
	if err = ident.SetMemberDisabled(context.Background(), owner, member, false); err != nil {
		t.Fatal(err)
	}
	if _, _, err = ident.Authenticate(context.Background(), member.Username, "member password long enough", "test", "test"); err != nil {
		t.Fatalf("restored login: %v", err)
	}
	if err = ident.DeleteMember(context.Background(), owner, member); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM members WHERE id=?", member.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("deleted Member count=%d error=%v", count, err)
	}
	if err = ident.DeleteMember(context.Background(), owner, owner); err != identity.ErrForbidden {
		t.Fatalf("Owner deletion error=%v", err)
	}
}

func TestMemberExportExcludesAuthoredMessagesInHiddenChannels(t *testing.T) {
	directory := t.TempDir()
	db, err := openDatabase(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = initializeSchema(db); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO members(id,username,username_key,password_hash,created_at)VALUES('member','Member','member','hash','now');INSERT INTO member_roles(member_id,role_id)VALUES('member','member');INSERT INTO categories(id,name,position)VALUES('cat','General',0);INSERT INTO channels(id,category_id,name,type,position)VALUES('visible','cat','visible','text',0),('hidden','cat','hidden','text',1);INSERT INTO channel_permission_overrides(channel_id,role_id,permission,effect)VALUES('hidden','member','view_channels','deny');INSERT INTO channel_sequences(channel_id,next_sequence)VALUES('visible',2),('hidden',2);INSERT INTO messages(id,channel_id,author_id,sequence,body,rendered_html,created_at)VALUES('shown','visible','member',1,'shown','shown','now'),('secret','hidden','member',1,'secret','secret','now')`)
	if err != nil {
		t.Fatal(err)
	}
	service := community.New(db, directory)
	defer service.Close()
	export, err := service.ExportMemberData(context.Background(), identity.Member{ID: "member", Username: "Member"})
	if err != nil {
		t.Fatal(err)
	}
	if len(export.AuthoredMessages) != 1 || export.AuthoredMessages[0].Body != "shown" {
		t.Fatalf("export=%+v", export.AuthoredMessages)
	}
}
