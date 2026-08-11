//go:build bootstrap_gui

// Command allchat-bootstrap installs an AllChat Instance on an existing VPS.
package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
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

const (
	authPassword  = "Password"
	authKey       = "SSH private key"
	releaseLatest = "Latest stable release (recommended)"
	releaseExact  = "Choose a specific version"
)

func main() {
	a := app.NewWithID("org.allchat.bootstrap")
	w := a.NewWindow("AllChat Instance Bootstrapper")
	w.Resize(fyne.NewSize(760, 680))

	user := widget.NewEntry()
	user.SetText("root")
	password := widget.NewPasswordEntry()
	authMode := widget.NewRadioGroup([]string{authPassword, authKey}, nil)
	authMode.Horizontal = true
	keyPath := widget.NewEntry()
	keyPath.SetPlaceHolder("Path to your private key")
	keyPassphrase := widget.NewPasswordEntry()
	sudoPassword := widget.NewPasswordEntry()
	sudoPassword.SetPlaceHolder("Only needed when sudo asks for a password")
	chooseKey := widget.NewButton("Choose key file…", func() {
		dialog.NewFileOpen(func(file fyne.URIReadCloser, err error) {
			if err != nil {
				dialog.ShowError(err, w)
				return
			}
			if file == nil {
				return
			}
			keyPath.SetText(file.URI().Path())
			_ = file.Close()
		}, w).Show()
	})
	passwordFields := container.NewVBox(widget.NewForm(widget.NewFormItem("SSH password", password)))
	keyFields := container.NewVBox(
		container.NewBorder(nil, nil, nil, chooseKey, keyPath),
		widget.NewForm(widget.NewFormItem("Key passphrase", keyPassphrase)),
		widget.NewLabel("Leave the passphrase empty if the key is not encrypted."),
	)
	authMode.OnChanged = func(value string) {
		if value == authKey {
			passwordFields.Hide()
			keyFields.Show()
		} else {
			keyFields.Hide()
			passwordFields.Show()
		}
	}
	authMode.SetSelected(authPassword)

	host := widget.NewEntry()
	host.SetPlaceHolder("203.0.113.10 or vps.example.com")
	port := widget.NewEntry()
	port.SetText("22")
	email := widget.NewEntry()
	email.SetPlaceHolder("Optional certificate expiry contact")

	releaseMode := widget.NewRadioGroup([]string{releaseLatest, releaseExact}, nil)
	release := widget.NewEntry()
	release.SetPlaceHolder("v1.2.3")
	releaseFields := container.NewVBox(widget.NewForm(widget.NewFormItem("Version tag", release)))
	releaseMode.OnChanged = func(value string) {
		if value == releaseExact {
			releaseFields.Show()
		} else {
			releaseFields.Hide()
		}
	}
	releaseMode.SetSelected(releaseLatest)

	stepHeading := widget.NewLabelWithStyle("", fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
	stepProgress := widget.NewLabel("")
	errorLabel := widget.NewLabel("")
	errorLabel.Wrapping = fyne.TextWrapWord
	status := widget.NewLabel("")
	status.Wrapping = fyne.TextWrapWord
	statusScroll := container.NewVScroll(status)
	statusScroll.SetMinSize(fyne.NewSize(0, 160))
	statusScroll.Hide()
	successMessage := widget.NewLabel("The server is healthy and ready. Community Owner setup has been opened in your browser.")
	successMessage.Wrapping = fyne.TextWrapWord
	successCard := widget.NewCard("✓ Installation complete", "AllChat is ready to use", successMessage)
	successCard.Hide()
	review := widget.NewLabel("")
	review.Wrapping = fyne.TextWrapWord

	page := func(title, description string, body ...fyne.CanvasObject) fyne.CanvasObject {
		detail := widget.NewLabel(description)
		detail.Wrapping = fyne.TextWrapWord
		items := []fyne.CanvasObject{widget.NewLabelWithStyle(title, fyne.TextAlignLeading, fyne.TextStyle{Bold: true}), detail, widget.NewSeparator()}
		return container.NewVBox(append(items, body...)...)
	}
	pages := []fyne.CanvasObject{
		page("How do you sign in to the VPS?", "Use the same account and authentication method you use when connecting to the server with SSH.",
			widget.NewForm(widget.NewFormItem("Username", user)), authMode, passwordFields, keyFields,
			widget.NewSeparator(), widget.NewLabel("Privilege escalation"), widget.NewForm(widget.NewFormItem("Sudo password", sudoPassword))),
		page("Which server should AllChat use?", "Enter the VPS address supplied by your hosting provider. AllChat will automatically resolve its public IP for voice traffic and firewall configuration.",
			widget.NewForm(widget.NewFormItem("Server address", host), widget.NewFormItem("SSH port", port), widget.NewFormItem("Certificate email", email)),
			widget.NewLabel("Supported servers: Debian 12+ and Ubuntu 22.04+. SSH, HTTP, HTTPS, and media ports must be reachable.")),
		page("Which AllChat version should be installed?", "The latest stable release is the best choice for most installations. Choose a tag only when you need a particular version.",
			releaseMode, releaseFields),
		page("Review and install", "Check the destination below. Credentials remain in this process and are never saved.", review, successCard, statusScroll),
	}
	stack := container.NewStack(pages...)
	for index := 1; index < len(pages); index++ {
		pages[index].Hide()
	}

	config := func() (bootstrap.Config, error) {
		sshPort, err := strconv.Atoi(strings.TrimSpace(port.Text))
		if err != nil {
			return bootstrap.Config{}, fmt.Errorf("SSH port must be a number")
		}
		serverAddress := strings.Trim(strings.TrimSpace(host.Text), "[]")
		tlsMode := bootstrap.TLSHostname
		if net.ParseIP(serverAddress) != nil {
			tlsMode = bootstrap.TLSDirectIP
		}
		releaseTag := ""
		if releaseMode.Selected == releaseExact {
			releaseTag = strings.TrimSpace(release.Text)
		}
		cfg := bootstrap.Config{
			SSHHost: serverAddress, SSHPort: sshPort, SSHUser: strings.TrimSpace(user.Text),
			SudoPassword: sudoPassword.Text, TLSMode: tlsMode,
			ACMEEmail: strings.TrimSpace(email.Text), Release: releaseTag,
		}
		if tlsMode == bootstrap.TLSHostname {
			cfg.Hostname = serverAddress
		}
		return cfg, nil
	}
	credentials := func() (bootstrap.SSHCredentials, error) {
		result := bootstrap.SSHCredentials{}
		if authMode.Selected == authPassword {
			if password.Text == "" {
				return result, fmt.Errorf("enter the SSH password")
			}
			result.Password = password.Text
			return result, nil
		}
		if strings.TrimSpace(keyPath.Text) == "" {
			return result, fmt.Errorf("choose an SSH private key file")
		}
		key, err := os.ReadFile(strings.TrimSpace(keyPath.Text))
		if err != nil {
			return result, fmt.Errorf("read private key: %w", err)
		}
		result.PrivateKeyPEM = key
		result.Passphrase = []byte(keyPassphrase.Text)
		return result, nil
	}

	current := 0
	back := widget.NewButton("Back", nil)
	next := widget.NewButton("Continue", nil)
	install := widget.NewButton("Install or safely upgrade", nil)
	install.Hide()
	showStep := func(index int) {
		pages[current].Hide()
		current = index
		pages[current].Show()
		stepProgress.SetText(fmt.Sprintf("Step %d of %d", current+1, len(pages)))
		stepHeading.SetText([]string{"VPS login", "Server", "Version", "Review"}[current])
		errorLabel.SetText("")
		if current == len(pages)-1 {
			cfg, _ := config()
			version := cfg.Release
			if version == "" {
				version = "Latest stable release"
			}
			publicURL := cfg.BaseURL()
			if cfg.TLSMode == bootstrap.TLSDirectIP {
				publicURL = "Derived from the server IP during installation"
			}
			review.SetText(fmt.Sprintf("Server: %s@%s:%d\nPublic URL: %s\nVersion: %s", cfg.SSHUser, cfg.SSHHost, cfg.SSHPort, publicURL, version))
			next.Hide()
			install.Show()
		} else {
			install.Hide()
			next.Show()
		}
		if current == 0 {
			back.Disable()
		} else {
			back.Enable()
		}
	}
	validateStep := func(index int) error {
		switch index {
		case 0:
			if strings.TrimSpace(user.Text) == "" {
				return fmt.Errorf("enter the SSH username")
			}
			_, err := credentials()
			return err
		case 1:
			if strings.TrimSpace(host.Text) == "" {
				return fmt.Errorf("enter the VPS address")
			}
			sshPort, err := strconv.Atoi(strings.TrimSpace(port.Text))
			if err != nil || sshPort < 1 || sshPort > 65535 {
				return fmt.Errorf("SSH port must be between 1 and 65535")
			}
		case 2:
			cfg, err := config()
			if err != nil {
				return err
			}
			return cfg.ValidateBeforePublicIP()
		}
		return nil
	}
	back.OnTapped = func() {
		if current > 0 {
			showStep(current - 1)
		}
	}
	next.OnTapped = func() {
		if err := validateStep(current); err != nil {
			errorLabel.SetText("Please fix this step: " + err.Error())
			return
		}
		showStep(current + 1)
	}

	statusText := ""
	appendStatus := func(line string) {
		fyne.Do(func() {
			statusText = strings.TrimSpace(statusText + "\n" + line)
			status.SetText(statusText)
			statusScroll.ScrollToBottom()
		})
	}
	install.OnTapped = func() {
		cfg, err := config()
		var creds bootstrap.SSHCredentials
		if err == nil {
			creds, err = credentials()
		}
		if err != nil {
			errorLabel.SetText("Cannot start: " + err.Error())
			return
		}
		install.Disable()
		back.Disable()
		successCard.Hide()
		statusText = ""
		status.SetText("")
		statusScroll.Show()
		go func() {
			completed := false
			defer fyne.Do(func() {
				back.Enable()
				if !completed {
					install.Enable()
				}
			})
			appendStatus("Resolving the VPS public IP…")
			cfg.PublicIP, err = bootstrap.ResolvePublicIP(context.Background(), cfg.SSHHost)
			if err == nil {
				err = cfg.Validate()
			}
			if err != nil {
				appendStatus("Error: " + err.Error())
				return
			}
			appendStatus("Using public IP " + cfg.PublicIP)
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
			remote, err := bootstrap.DialSSH(context.Background(), cfg, creds, filepath.Join(configDir, "AllChat", "known_hosts"), confirm)
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
			appendStatus("Finding and verifying the " + cfg.ReleaseRef() + " release…")
			asset, binary, err := bootstrap.DownloadInstanceVerified(context.Background(), nil, cfg.Release, platform.Architecture)
			if err != nil {
				appendStatus("Error: " + err.Error())
				return
			}
			appendStatus("Installing " + asset + "…")
			link, err := (bootstrap.Installer{Log: appendStatus}).Install(context.Background(), remote, bytes.NewReader(binary), cfg)
			if err != nil {
				appendStatus("Error: " + err.Error())
				return
			}
			appendStatus("Instance is ready. Opening Community Owner setup…")
			location, err := url.Parse(link)
			if err != nil {
				appendStatus("Error opening Community Owner setup: " + err.Error())
				return
			}
			completed = true
			fyne.Do(func() {
				successMessage.SetText("The server passed its health checks and is ready. Community Owner setup has been opened in your browser.\n\n" + link)
				successCard.Show()
				install.SetText("Installation complete")
				install.Disable()
				_ = a.OpenURL(location)
			})
		}()
	}

	showStep(0)
	version := widget.NewLabel("Bootstrapper " + buildinfo.String())
	footer := container.NewVBox(errorLabel, container.NewBorder(nil, nil, back, container.NewHBox(next, install)), version)
	w.SetContent(container.NewBorder(container.NewVBox(stepProgress, stepHeading, widget.NewSeparator()), footer, nil, nil, container.NewVScroll(stack)))
	w.ShowAndRun()
}
