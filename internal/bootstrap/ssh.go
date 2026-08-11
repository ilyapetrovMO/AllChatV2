package bootstrap

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type SSHCredentials struct {
	Password      string
	PrivateKeyPEM []byte
	Passphrase    []byte
}

type HostKeyConfirmation func(host, fingerprint string) bool

type SSHRemote struct{ client *ssh.Client }

func DialSSH(ctx context.Context, cfg Config, credentials SSHCredentials, knownHostsPath string, confirm HostKeyConfirmation) (*SSHRemote, error) {
	var auth []ssh.AuthMethod
	if credentials.Password != "" {
		auth = append(auth, ssh.Password(credentials.Password))
	}
	if len(credentials.PrivateKeyPEM) != 0 {
		var signer ssh.Signer
		var err error
		if len(credentials.Passphrase) != 0 {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(credentials.PrivateKeyPEM, credentials.Passphrase)
		} else {
			signer, err = ssh.ParsePrivateKey(credentials.PrivateKeyPEM)
		}
		if err != nil {
			return nil, fmt.Errorf("parse SSH private key: %w", err)
		}
		auth = append(auth, ssh.PublicKeys(signer))
	}
	if len(auth) == 0 {
		return nil, fmt.Errorf("SSH password or private key is required")
	}
	if err := os.MkdirAll(filepath.Dir(knownHostsPath), 0700); err != nil {
		return nil, err
	}
	knownHostsFile, err := os.OpenFile(knownHostsPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	if err = knownHostsFile.Close(); err != nil {
		return nil, err
	}
	strict, err := knownhosts.New(knownHostsPath)
	if err != nil {
		return nil, fmt.Errorf("load known SSH hosts: %w", err)
	}
	hostKey := func(host string, remote net.Addr, key ssh.PublicKey) error {
		err := strict(host, remote, key)
		if err == nil {
			return nil
		}
		var keyErr *knownhosts.KeyError
		if !os.IsNotExist(err) && (!AsKeyError(err, &keyErr) || len(keyErr.Want) != 0) {
			return fmt.Errorf("SSH host key changed or is invalid: %w", err)
		}
		fingerprint := ssh.FingerprintSHA256(key)
		if confirm == nil || !confirm(host, fingerprint) {
			return fmt.Errorf("untrusted SSH host key %s", fingerprint)
		}
		line := knownhosts.Line([]string{knownhosts.Normalize(host)}, key) + "\n"
		file, openErr := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_WRONLY, 0600)
		if openErr != nil {
			return openErr
		}
		_, writeErr := file.WriteString(line)
		closeErr := file.Close()
		if writeErr != nil {
			return writeErr
		}
		return closeErr
	}
	address := net.JoinHostPort(cfg.SSHHost, fmt.Sprint(cfg.SSHPort))
	dialer := net.Dialer{Timeout: 15 * time.Second}
	connection, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, fmt.Errorf("connect SSH: %w", err)
	}
	clientConnection, channels, requests, err := ssh.NewClientConn(connection, address, &ssh.ClientConfig{User: cfg.SSHUser, Auth: auth, HostKeyCallback: hostKey, Timeout: 15 * time.Second})
	if err != nil {
		connection.Close()
		return nil, fmt.Errorf("authenticate SSH: %w", err)
	}
	return &SSHRemote{client: ssh.NewClient(clientConnection, channels, requests)}, nil
}

func AsKeyError(err error, target **knownhosts.KeyError) bool {
	keyErr, ok := err.(*knownhosts.KeyError)
	if ok {
		*target = keyErr
	}
	return ok
}

func (r *SSHRemote) Close() error { return r.client.Close() }

func (r *SSHRemote) Run(ctx context.Context, command string, input io.Reader) (string, error) {
	session, err := r.client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	if input != nil {
		session.Stdin = input
	}
	var output, stderr bytes.Buffer
	session.Stdout, session.Stderr = &output, &stderr
	done := make(chan error, 1)
	go func() { done <- session.Run(command) }()
	select {
	case <-ctx.Done():
		_ = session.Signal(ssh.SIGTERM)
		return "", ctx.Err()
	case err = <-done:
		if err != nil {
			return output.String(), fmt.Errorf("%w: %s", err, stderr.String())
		}
		return output.String(), nil
	}
}

func (r *SSHRemote) Upload(ctx context.Context, destination string, source io.Reader, mode uint32) error {
	command := fmt.Sprintf("umask 077; dd of=%s status=none; chmod %04o %s", shellQuote(destination), mode, shellQuote(destination))
	_, err := r.Run(ctx, command, source)
	return err
}
