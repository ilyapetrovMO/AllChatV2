//go:build bootstrap_gui

// Command allchat-bootstrap installs an AllChat Instance on an existing VPS.
package main

import (
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"image/color"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"allchat/internal/bootstrap"
	"allchat/internal/buildinfo"
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"
)

const (
	authPassword  = "Password"
	authKey       = "SSH private key"
	releaseLatest = "Latest stable release (recommended)"
	releaseExact  = "Choose a specific version"
)

type bootstrapTheme struct{ fyne.Theme }

type filePickerEntry struct {
	name  string
	path  string
	isDir bool
}

type filePickerRow struct {
	widget.BaseWidget
	icon           *widget.Icon
	label          *canvas.Text
	onTapped       func()
	onDoubleTapped func()
}

type autocompleteEntry struct {
	widget.Entry
	suggestion string
}

func newAutocompleteEntry() *autocompleteEntry {
	entry := &autocompleteEntry{}
	entry.Wrapping = fyne.TextWrap(fyne.TextTruncateClip)
	entry.ExtendBaseWidget(entry)
	return entry
}

func (entry *autocompleteEntry) TypedKey(key *fyne.KeyEvent) {
	if key.Name == fyne.KeyTab && entry.suggestion != "" {
		entry.SetText(entry.suggestion)
		entry.CursorColumn = len([]rune(entry.Text))
		return
	}
	entry.Entry.TypedKey(key)
}

func (entry *autocompleteEntry) AcceptsTab() bool {
	return entry.suggestion != ""
}

func (row *filePickerRow) CreateRenderer() fyne.WidgetRenderer {
	return widget.NewSimpleRenderer(container.NewBorder(nil, nil, row.icon, nil, row.label))
}

func (row *filePickerRow) Tapped(*fyne.PointEvent) {
	if row.onTapped != nil {
		row.onTapped()
	}
}

func (row *filePickerRow) DoubleTapped(*fyne.PointEvent) {
	if row.onDoubleTapped != nil {
		row.onDoubleTapped()
	}
}

//go:embed assets/icon.png
var bootstrapIcon []byte

var (
	graphiteSidebar = color.NRGBA{R: 43, G: 45, B: 49, A: 255} // #2b2d31
	graphiteMain    = color.NRGBA{R: 49, G: 51, B: 56, A: 255} // #313338
	graphiteCard    = color.NRGBA{R: 29, G: 30, B: 36, A: 255} // #1d1e24
	graphiteInput   = color.NRGBA{R: 30, G: 31, B: 34, A: 255} // #1e1f22
	graphiteHover   = color.NRGBA{R: 53, G: 55, B: 60, A: 255} // #35373c
	graphiteActive  = color.NRGBA{R: 64, G: 66, B: 73, A: 255} // #404249
	graphiteText    = color.NRGBA{R: 242, G: 243, B: 245, A: 255}
	graphiteMuted   = color.NRGBA{R: 181, G: 186, B: 193, A: 255}
	graphiteFaint   = color.NRGBA{R: 148, G: 155, B: 164, A: 255}
	graphiteBrand   = color.NRGBA{R: 88, G: 101, B: 242, A: 255}
)

func (bootstrapTheme) Color(name fyne.ThemeColorName, variant fyne.ThemeVariant) color.Color {
	colors := map[fyne.ThemeColorName]color.Color{
		theme.ColorNameBackground:          graphiteMain,
		theme.ColorNameButton:              graphiteActive,
		theme.ColorNameDisabledButton:      graphiteSidebar,
		theme.ColorNameInputBackground:     graphiteInput,
		theme.ColorNameInputBorder:         color.NRGBA{R: 30, G: 31, B: 34, A: 255},
		theme.ColorNameForeground:          graphiteText,
		theme.ColorNameDisabled:            graphiteFaint,
		theme.ColorNamePlaceHolder:         graphiteFaint,
		theme.ColorNamePrimary:             graphiteBrand,
		theme.ColorNameHyperlink:           graphiteBrand,
		theme.ColorNameHover:               graphiteHover,
		theme.ColorNamePressed:             color.NRGBA{R: 0, G: 0, B: 0, A: 45},
		theme.ColorNameFocus:               graphiteBrand,
		theme.ColorNameSelection:           color.NRGBA{R: 88, G: 101, B: 242, A: 110},
		theme.ColorNameSeparator:           color.NRGBA{R: 255, G: 255, B: 255, A: 20},
		theme.ColorNameHeaderBackground:    graphiteSidebar,
		theme.ColorNameMenuBackground:      graphiteCard,
		theme.ColorNameOverlayBackground:   graphiteCard,
		theme.ColorNameScrollBar:           graphiteFaint,
		theme.ColorNameScrollBarBackground: color.Transparent,
		theme.ColorNameShadow:              color.NRGBA{A: 90},
		theme.ColorNameSuccess:             color.NRGBA{R: 35, G: 165, B: 89, A: 255},
		theme.ColorNameWarning:             color.NRGBA{R: 240, G: 178, B: 50, A: 255},
		theme.ColorNameError:               color.NRGBA{R: 242, G: 63, B: 66, A: 255},
		theme.ColorNameForegroundOnPrimary: graphiteText,
		theme.ColorNameForegroundOnSuccess: graphiteText,
		theme.ColorNameForegroundOnError:   graphiteText,
		theme.ColorNameForegroundOnWarning: graphiteCard,
	}
	if value, ok := colors[name]; ok {
		return value
	}
	return theme.DefaultTheme().Color(name, theme.VariantDark)
}
func (bootstrapTheme) Font(style fyne.TextStyle) fyne.Resource {
	return theme.DefaultTheme().Font(style)
}
func (bootstrapTheme) Icon(name fyne.ThemeIconName) fyne.Resource {
	return theme.DefaultTheme().Icon(name)
}
func (bootstrapTheme) Size(name fyne.ThemeSizeName) float32 {
	if name == theme.SizeNameText {
		return 14
	}
	if name == theme.SizeNamePadding {
		return 6
	}
	if name == theme.SizeNameInnerPadding {
		return 6
	}
	if name == theme.SizeNameInputRadius {
		return 4
	}
	if name == theme.SizeNameHeadingText {
		return 22
	}
	if name == theme.SizeNameSubHeadingText {
		return 16
	}
	return theme.DefaultTheme().Size(name)
}

func surface(object fyne.CanvasObject, background color.Color) fyne.CanvasObject {
	panel := canvas.NewRectangle(background)
	panel.CornerRadius = 8
	return container.NewStack(panel, container.NewPadded(object))
}

func featureRow(text string) fyne.CanvasObject {
	icon := widget.NewIcon(theme.NewColoredResource(theme.ConfirmIcon(), theme.ColorNameSuccess))
	return container.NewHBox(icon, widget.NewLabel(text))
}

func searchableFiles(directory, query string, extensions []string) ([]filePickerEntry, error) {
	items, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	allowed := func(name string) bool {
		if len(extensions) == 0 {
			return true
		}
		extension := strings.ToLower(filepath.Ext(name))
		for _, candidate := range extensions {
			if extension == strings.ToLower(candidate) {
				return true
			}
		}
		return false
	}
	entries := make([]filePickerEntry, 0, len(items))
	for _, item := range items {
		if query != "" && !strings.Contains(strings.ToLower(item.Name()), query) {
			continue
		}
		if !item.IsDir() && !allowed(item.Name()) {
			continue
		}
		entries = append(entries, filePickerEntry{name: item.Name(), path: filepath.Join(directory, item.Name()), isDir: item.IsDir()})
	}
	sort.Slice(entries, func(left, right int) bool {
		if entries[left].isDir != entries[right].isDir {
			return entries[left].isDir
		}
		return strings.ToLower(entries[left].name) < strings.ToLower(entries[right].name)
	})
	return entries, nil
}

func newFilePickerRow() fyne.CanvasObject {
	row := &filePickerRow{icon: widget.NewIcon(theme.FileIcon()), label: canvas.NewText("filename", graphiteText)}
	row.label.TextSize = theme.Size(theme.SizeNameText)
	row.ExtendBaseWidget(row)
	return row
}

func updateFilePickerRow(object fyne.CanvasObject, entry filePickerEntry) {
	row := object.(*filePickerRow)
	if entry.isDir {
		row.icon.SetResource(theme.FolderIcon())
	} else {
		row.icon.SetResource(theme.FileIcon())
	}
	row.label.Text = entry.name
	row.label.Refresh()
}

func normalizeBootstrapLocale() {
	for _, name := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		value := strings.ToUpper(strings.TrimSpace(os.Getenv(name)))
		base := strings.SplitN(value, ".", 2)[0]
		if base == "C" || base == "POSIX" {
			_ = os.Setenv(name, "en_US.UTF-8")
		}
		if value != "" {
			return
		}
	}
}

func showSearchableFilePicker(application fyne.App, parent fyne.Window, title string, extensions []string, selected func(string)) {
	picker := application.NewWindow(title)
	picker.Resize(fyne.NewSize(820, 560))
	picker.CenterOnScreen()

	directory, err := os.UserHomeDir()
	if err != nil || directory == "" {
		directory, _ = os.Getwd()
	}
	pathEntry := widget.NewEntry()
	pathEntry.SetText(directory)
	search := newAutocompleteEntry()
	search.SetPlaceHolder("Search files in this folder…")
	completion := canvas.NewText(" ", graphiteFaint)
	completion.TextSize = 12
	status := widget.NewLabel("")
	status.Truncation = fyne.TextTruncateEllipsis
	open := widget.NewButton("Open", nil)
	open.Disable()
	var entries []filePickerEntry
	selectedIndex := -1
	var activate func(widget.ListItemID)

	var list *widget.List
	list = widget.NewList(
		func() int { return len(entries) },
		newFilePickerRow,
		func(id widget.ListItemID, object fyne.CanvasObject) {
			updateFilePickerRow(object, entries[id])
			row := object.(*filePickerRow)
			row.onTapped = func() { list.Select(id) }
			row.onDoubleTapped = func() {
				list.Select(id)
				if activate != nil {
					activate(id)
				}
			}
		},
	)
	refresh := func() {
		selectedIndex = -1
		open.Disable()
		value, readErr := searchableFiles(directory, search.Text, extensions)
		if readErr != nil {
			entries = nil
			status.SetText(readErr.Error())
		} else {
			entries = value
			status.SetText(fmt.Sprintf("%d item(s)", len(entries)))
		}
		search.suggestion = ""
		completion.Text = " "
		if query := strings.TrimSpace(search.Text); query != "" {
			for _, entry := range entries {
				if !strings.EqualFold(entry.name, query) {
					search.suggestion = entry.name
					completion.Text = "Tab to complete: " + entry.name
					break
				}
			}
		}
		completion.Refresh()
		list.UnselectAll()
		list.Refresh()
	}
	navigate := func(target string) {
		target = filepath.Clean(strings.TrimSpace(target))
		info, statErr := os.Stat(target)
		if statErr != nil || !info.IsDir() {
			status.SetText("Choose an existing folder.")
			return
		}
		directory = target
		pathEntry.SetText(directory)
		refresh()
	}
	list.OnSelected = func(id widget.ListItemID) {
		selectedIndex = id
		open.Enable()
	}
	activate = func(id widget.ListItemID) {
		if id < 0 || id >= len(entries) {
			return
		}
		entry := entries[id]
		if entry.isDir {
			navigate(entry.path)
			return
		}
		selected(entry.path)
		picker.Close()
		parent.RequestFocus()
	}
	open.OnTapped = func() { activate(selectedIndex) }
	search.OnChanged = func(string) { refresh() }
	pathEntry.OnSubmitted = navigate
	goButton := widget.NewButton("Go", func() { navigate(pathEntry.Text) })
	upButton := widget.NewButtonWithIcon("Up", theme.NavigateBackIcon(), func() { navigate(filepath.Dir(directory)) })
	homeButton := widget.NewButtonWithIcon("Home", theme.HomeIcon(), func() {
		home, homeErr := os.UserHomeDir()
		if homeErr == nil {
			navigate(home)
		}
	})
	cancel := widget.NewButton("Cancel", func() { picker.Close(); parent.RequestFocus() })
	buttons := container.NewHBox(cancel, open)
	footer := container.NewBorder(nil, nil, status, buttons, widget.NewLabel(""))
	picker.SetContent(container.NewBorder(
		container.NewVBox(
			container.NewBorder(nil, nil, container.NewHBox(homeButton, upButton), goButton, pathEntry),
			search,
			completion,
		),
		footer,
		nil,
		nil,
		list,
	))
	refresh()
	picker.Show()
	picker.Canvas().Focus(search)
}

func main() {
	normalizeBootstrapLocale()
	a := app.NewWithID("org.allchat.bootstrap")
	a.SetIcon(fyne.NewStaticResource("allchat.png", bootstrapIcon))
	a.Settings().SetTheme(bootstrapTheme{})
	w := a.NewWindow("AllChat Setup")
	w.Resize(fyne.NewSize(980, 680))

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
		showSearchableFilePicker(a, w, "Choose SSH private key", nil, keyPath.SetText)
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
	pushRelay := widget.NewEntry()
	pushRelay.SetText(bootstrap.DefaultPushRelayURL)
	deployRelay := widget.NewCheck("Deploy a private Android push relay on this VPS", nil)
	firebasePath := widget.NewEntry()
	firebasePath.SetPlaceHolder("Firebase service-account JSON")
	chooseFirebase := widget.NewButton("Choose JSON…", func() {
		showSearchableFilePicker(a, w, "Choose Firebase service-account JSON", []string{".json"}, firebasePath.SetText)
	})
	firebaseFields := container.NewVBox(container.NewBorder(nil, nil, nil, chooseFirebase, firebasePath), widget.NewLabel("The service account must match the Firebase project compiled into your APK."))
	firebaseFields.Hide()
	deployRelay.OnChanged = func(enabled bool) {
		if enabled {
			firebaseFields.Show()
			pushRelay.Disable()
		} else {
			firebaseFields.Hide()
			pushRelay.Enable()
		}
	}

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
	stepHeading.SizeName = theme.SizeNameHeadingText
	stepProgress := widget.NewLabel("")
	stepProgress.Importance = widget.LowImportance
	errorLabel := widget.NewLabel("")
	errorLabel.Wrapping = fyne.TextWrapWord
	errorLabel.Importance = widget.DangerImportance
	status := widget.NewLabel("")
	status.Wrapping = fyne.TextWrapWord
	status.Selectable = true
	statusScroll := container.NewVScroll(status)
	statusScroll.SetMinSize(fyne.NewSize(0, 160))
	statusScroll.Hide()
	installProgress := widget.NewProgressBarInfinite()
	installProgress.Hide()
	successMessage := widget.NewLabel("The server is healthy and ready. Community Owner setup has been opened in your browser.")
	successMessage.Wrapping = fyne.TextWrapWord
	successCard := widget.NewCard("✓  Installation successful", "Your server is set up and ready to use", successMessage)
	successCard.Hide()
	review := widget.NewLabel("")
	review.Wrapping = fyne.TextWrapWord
	review.Selectable = true

	page := func(title, description string, body ...fyne.CanvasObject) fyne.CanvasObject {
		detail := widget.NewLabel(description)
		detail.Wrapping = fyne.TextWrapWord
		detail.Importance = widget.LowImportance
		heading := widget.NewLabelWithStyle(title, fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
		heading.SizeName = theme.SizeNameHeadingText
		items := []fyne.CanvasObject{heading, detail, widget.NewSeparator()}
		return surface(container.NewVBox(append(items, body...)...), graphiteMain)
	}
	pages := []fyne.CanvasObject{
		page("Welcome to the AllChat setup wizard", "This wizard installs or safely upgrades AllChat on your VPS. You will need an SSH account and either a password or private key.",
			featureRow("Secure SSH connection"), featureRow("Automatic server configuration"), featureRow("Firewall, TLS, and voice setup"), featureRow("Ready in minutes")),
		page("How do you sign in to the VPS?", "Use the same account and authentication method you use when connecting to the server with SSH.",
			widget.NewForm(widget.NewFormItem("Username", user)), authMode, passwordFields, keyFields,
			widget.NewSeparator(), widget.NewLabel("Privilege escalation"), widget.NewForm(widget.NewFormItem("Sudo password", sudoPassword))),
		page("Which server should AllChat use?", "Enter the VPS address supplied by your hosting provider. AllChat will automatically resolve its public IP for voice traffic and firewall configuration.",
			widget.NewForm(widget.NewFormItem("Server address", host), widget.NewFormItem("SSH port", port), widget.NewFormItem("Certificate email", email), widget.NewFormItem("Mobile push relay", pushRelay)), deployRelay, firebaseFields,
			widget.NewLabel("Supported servers: Debian 12+ and Ubuntu 22.04+. SSH, HTTP, HTTPS, and media ports must be reachable.")),
		page("Which AllChat version should be installed?", "The latest stable release is the best choice for most installations. Choose a tag only when you need a particular version.",
			releaseMode, releaseFields),
		page("Review and install", "Check the destination below. Credentials remain in this process and are never saved.", surface(review, graphiteCard), installProgress, successCard, statusScroll),
	}
	stack := container.NewStack(pages...)
	for index := 1; index < len(pages); index++ {
		pages[index].Hide()
	}
	stepNames := []string{"Welcome", "SSH / Password", "Hostname", "Server Version", "Review & Install"}
	stepRows := make([]*widget.Label, len(stepNames))
	stepObjects := make([]fyne.CanvasObject, 0, len(stepNames)+2)
	brand := widget.NewLabelWithStyle("ALLCHAT  SETUP", fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
	stepObjects = append(stepObjects, brand, widget.NewSeparator())
	for index, name := range stepNames {
		label := widget.NewLabel(fmt.Sprintf("  %d   %s", index+1, name))
		stepRows[index] = label
		stepObjects = append(stepObjects, label)
	}
	sidebar := surface(container.NewVBox(stepObjects...), graphiteSidebar)

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
			ACMEEmail: strings.TrimSpace(email.Text), Release: releaseTag, PushRelayURL: strings.TrimSpace(pushRelay.Text),
		}
		if tlsMode == bootstrap.TLSHostname {
			cfg.Hostname = serverAddress
		}
		if deployRelay.Checked {
			cfg.DeployRelay = true
			cfg.PushRelayURL = cfg.BaseURL()
			content, readErr := os.ReadFile(strings.TrimSpace(firebasePath.Text))
			if readErr != nil {
				return bootstrap.Config{}, fmt.Errorf("read Firebase service account: %w", readErr)
			}
			if configureErr := cfg.ConfigureFirebaseServiceAccount(content); configureErr != nil {
				return bootstrap.Config{}, configureErr
			}
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
	back.Importance = widget.LowImportance
	next.Importance = widget.HighImportance
	install.Importance = widget.HighImportance
	install.Hide()
	showStep := func(index int) {
		pages[current].Hide()
		current = index
		pages[current].Show()
		stepProgress.SetText(fmt.Sprintf("Step %d of %d", current+1, len(pages)))
		stepHeading.SetText([]string{"Welcome", "SSH access", "Server details", "Server version", "Review and install"}[current])
		errorLabel.SetText("")
		for step, label := range stepRows {
			if step == current {
				label.SetText(fmt.Sprintf("●  %d   %s", step+1, stepNames[step]))
				label.TextStyle = fyne.TextStyle{Bold: true}
			} else if step < current {
				label.SetText(fmt.Sprintf("✓  %d   %s", step+1, stepNames[step]))
				label.TextStyle = fyne.TextStyle{}
			} else {
				label.SetText(fmt.Sprintf("○  %d   %s", step+1, stepNames[step]))
				label.TextStyle = fyne.TextStyle{}
			}
			label.Refresh()
		}
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
			pushMode := cfg.PushRelayURL
			if cfg.DeployRelay {
				pushMode = "Private relay on this VPS"
			}
			review.SetText(fmt.Sprintf("Server: %s@%s:%d\nPublic URL: %s\nVersion: %s\nMobile push: %s", cfg.SSHUser, cfg.SSHHost, cfg.SSHPort, publicURL, version, pushMode))
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
		case 1:
			if strings.TrimSpace(user.Text) == "" {
				return fmt.Errorf("enter the SSH username")
			}
			_, err := credentials()
			return err
		case 2:
			if strings.TrimSpace(host.Text) == "" {
				return fmt.Errorf("enter the VPS address")
			}
			sshPort, err := strconv.Atoi(strings.TrimSpace(port.Text))
			if err != nil || sshPort < 1 || sshPort > 65535 {
				return fmt.Errorf("SSH port must be between 1 and 65535")
			}
		case 3:
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
		installProgress.Show()
		stepHeading.SetText("Installing AllChat")
		statusText = ""
		status.SetText("")
		statusScroll.Show()
		go func() {
			completed := false
			defer fyne.Do(func() {
				back.Enable()
				if !completed {
					install.Enable()
					installProgress.Hide()
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
			var relayBinary []byte
			if cfg.DeployRelay {
				relayAsset, downloaded, downloadErr := bootstrap.DownloadRelayVerified(context.Background(), nil, cfg.Release, platform.Architecture)
				if downloadErr != nil {
					appendStatus("Error: " + downloadErr.Error())
					return
				}
				relayBinary = downloaded
				appendStatus("Verified " + relayAsset)
			}
			appendStatus("Installing " + asset + "…")
			link, err := (bootstrap.Installer{Log: appendStatus}).InstallBundle(context.Background(), remote, bytes.NewReader(binary), bytes.NewReader(relayBinary), cfg)
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
				installProgress.Hide()
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
	version.Alignment = fyne.TextAlignTrailing
	version.Importance = widget.LowImportance
	footer := container.NewVBox(errorLabel, container.NewBorder(nil, nil, back, container.NewHBox(next, install)), version)
	header := container.NewVBox(stepProgress, stepHeading, widget.NewSeparator())
	content := container.NewBorder(header, footer, nil, nil, container.NewVScroll(stack))
	sidebarBox := container.NewGridWrap(fyne.NewSize(232, 640), sidebar)
	w.SetContent(container.NewPadded(container.NewBorder(nil, nil, sidebarBox, nil, content)))
	w.ShowAndRun()
}
