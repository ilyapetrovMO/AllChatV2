//go:build bootstrap_gui

// Command allchat-bootstrap installs an AllChat Instance on an existing VPS.
package main

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"allchat/internal/bootstrap"
	"allchat/internal/buildinfo"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/widget"
)

func main() {
	a := app.NewWithID("org.allchat.bootstrap")
	w := a.NewWindow("AllChat Instance Bootstrapper")
	w.Resize(fyne.NewSize(720, 720))

	host := widget.NewEntry()
	host.SetPlaceHolder("vps.example.test or public IP")
	port := widget.NewEntry()
	port.SetText("22")
	user := widget.NewEntry()
	user.SetText("root")
	password := widget.NewPasswordEntry()
	sudoPassword := widget.NewPasswordEntry()
	keyPath := widget.NewEntry()
	keyPath.SetPlaceHolder("Optional private-key file")
	keyPassphrase := widget.NewPasswordEntry()
	publicIP := widget.NewEntry()
	publicIP.SetPlaceHolder("Public routable IP")
	mode := widget.NewSelect([]string{string(bootstrap.TLSDirectIP), string(bootstrap.TLSHostname), string(bootstrap.TLSDuckDNS)}, nil)
	mode.SetSelected(string(bootstrap.TLSDirectIP))
	hostname := widget.NewEntry()
	hostname.SetPlaceHolder("chat.example.test")
	email := widget.NewEntry()
	email.SetPlaceHolder("ACME contact email (optional)")
	duckSubdomain := widget.NewEntry()
	duckSubdomain.SetPlaceHolder("DuckDNS subdomain")
	duckToken := widget.NewPasswordEntry()
	release := widget.NewEntry()
	release.SetPlaceHolder("v1.2.3")
	status := widget.NewMultiLineEntry()
	status.Disable()
	status.SetMinRowsVisible(7)
	install := widget.NewButton("Install or safely upgrade", nil)

	form := widget.NewForm(
		widget.NewFormItem("SSH host", host), widget.NewFormItem("SSH port", port), widget.NewFormItem("SSH user", user),
		widget.NewFormItem("SSH password", password), widget.NewFormItem("Private key", keyPath), widget.NewFormItem("Key passphrase", keyPassphrase),
		widget.NewFormItem("Sudo password", sudoPassword), widget.NewFormItem("Public IP", publicIP), widget.NewFormItem("TLS mode", mode),
		widget.NewFormItem("Hostname", hostname), widget.NewFormItem("ACME email", email), widget.NewFormItem("DuckDNS subdomain", duckSubdomain),
		widget.NewFormItem("DuckDNS token", duckToken), widget.NewFormItem("Release tag", release),
	)
	appendStatus := func(line string) { fyne.Do(func() { status.SetText(strings.TrimSpace(status.Text + "\n" + line)) }) }
	install.OnTapped = func() {
		install.Disable()
		status.SetText("")
		go func() {
			defer fyne.Do(install.Enable)
			sshPort, err := strconv.Atoi(port.Text)
			if err != nil {
				appendStatus("Error: invalid SSH port")
				return
			}
			cfg := bootstrap.Config{SSHHost: strings.TrimSpace(host.Text), SSHPort: sshPort, SSHUser: strings.TrimSpace(user.Text), SudoPassword: sudoPassword.Text, PublicIP: strings.TrimSpace(publicIP.Text), TLSMode: bootstrap.TLSMode(mode.Selected), Hostname: strings.TrimSpace(hostname.Text), ACMEEmail: strings.TrimSpace(email.Text), DuckSubdomain: strings.TrimSpace(duckSubdomain.Text), DuckToken: duckToken.Text, Release: strings.TrimSpace(release.Text)}
			if err = cfg.Validate(); err != nil {
				appendStatus("Error: " + err.Error())
				return
			}
			credentials := bootstrap.SSHCredentials{Password: password.Text, Passphrase: []byte(keyPassphrase.Text)}
			if keyPath.Text != "" {
				credentials.PrivateKeyPEM, err = os.ReadFile(keyPath.Text)
				if err != nil {
					appendStatus("Error reading private key: " + err.Error())
					return
				}
			}
			configDir, err := os.UserConfigDir()
			if err != nil {
				appendStatus("Error locating configuration directory: " + err.Error())
				return
			}
			confirm := func(remoteHost, fingerprint string) bool {
				answer := make(chan bool, 1)
				fyne.Do(func() {
					dialog.ShowConfirm("Trust SSH host key?", fmt.Sprintf("First connection to %s. Verify this SHA256 fingerprint with your provider:\n\n%s", remoteHost, fingerprint), func(ok bool) { answer <- ok }, w)
				})
				return <-answer
			}
			appendStatus("Connecting over SSH…")
			remote, err := bootstrap.DialSSH(context.Background(), cfg, credentials, filepath.Join(configDir, "AllChat", "known_hosts"), confirm)
			if err != nil {
				appendStatus("Error: " + err.Error())
				return
			}
			defer remote.Close()
			platform, err := bootstrap.InspectPlatform(context.Background(), remote)
			if err != nil {
				appendStatus("Error: " + err.Error())
				return
			}
			asset := bootstrap.InstanceAsset(cfg.Release, platform.Architecture)
			appendStatus("Downloading and verifying " + asset + "…")
			binary, err := bootstrap.DownloadVerified(context.Background(), nil, cfg.Release, asset)
			if err != nil {
				appendStatus("Error: " + err.Error())
				return
			}
			link, err := (bootstrap.Installer{Log: appendStatus}).Install(context.Background(), remote, bytes.NewReader(binary), cfg)
			if err != nil {
				appendStatus("Error: " + err.Error())
				return
			}
			appendStatus("Instance is ready. Opening Community Owner setup…")
			location, err := url.Parse(link)
			if err == nil {
				fyne.Do(func() { _ = a.OpenURL(location) })
			}
		}()
	}

	intro := widget.NewLabel("Configure an existing Debian 12+ or Ubuntu 22.04+ VPS. The host must have a public IP and reachable SSH, HTTP, HTTPS, and media ports. Credentials stay in this process and are never saved.")
	intro.Wrapping = fyne.TextWrapWord
	version := widget.NewLabel("Bootstrapper " + buildinfo.String())
	w.SetContent(container.NewBorder(container.NewVBox(widget.NewLabelWithStyle("AllChat Instance Bootstrapper", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}), intro), container.NewVBox(install, status, version), nil, nil, container.NewVScroll(form)))
	w.ShowAndRun()
}
