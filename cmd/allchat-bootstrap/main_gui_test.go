//go:build bootstrap_gui

package main

import (
	"image/color"
	"os"
	"path/filepath"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	fynetest "fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"
)

func TestBootstrapThemeUsesAllChatPalette(t *testing.T) {
	tests := []struct {
		name fyne.ThemeColorName
		want color.NRGBA
	}{
		{theme.ColorNameBackground, graphiteMain},
		{theme.ColorNameHeaderBackground, graphiteSidebar},
		{theme.ColorNameInputBackground, graphiteInput},
		{theme.ColorNameButton, graphiteActive},
		{theme.ColorNameHover, graphiteHover},
		{theme.ColorNameForeground, graphiteText},
		{theme.ColorNameDisabled, graphiteFaint},
		{theme.ColorNamePrimary, graphiteBrand},
	}

	bootstrap := bootstrapTheme{}
	for _, test := range tests {
		t.Run(string(test.name), func(t *testing.T) {
			got := color.NRGBAModel.Convert(bootstrap.Color(test.name, theme.VariantDark)).(color.NRGBA)
			if got != test.want {
				t.Fatalf("got %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestSearchableFilesFiltersByNameAndExtension(t *testing.T) {
	directory := t.TempDir()
	for _, name := range []string{"firebase-service.json", "notes.txt", "other.json"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte("test"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(directory, "firebase-archive"), 0o700); err != nil {
		t.Fatal(err)
	}
	entries, err := searchableFiles(directory, "FIREBASE", []string{".json"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || !entries[0].isDir || entries[1].name != "firebase-service.json" {
		t.Fatalf("filtered entries = %#v", entries)
	}
}

func TestFilePickerRowUpdateDoesNotDependOnContainerObjectOrder(t *testing.T) {
	row := newFilePickerRow()
	updateFilePickerRow(row, filePickerEntry{name: "service-account.json"})
	if row.(*filePickerRow).label.Text != "service-account.json" {
		t.Fatal("file picker row label was not updated")
	}
}

func TestFilePickerRowDoubleTapActivatesItem(t *testing.T) {
	row := newFilePickerRow().(*filePickerRow)
	activated := false
	row.onDoubleTapped = func() { activated = true }
	row.DoubleTapped(nil)
	if !activated {
		t.Fatal("double tap did not activate file picker row")
	}
}

func TestFilePickerFooterStaysSingleRow(t *testing.T) {
	normalizeBootstrapLocale()
	application := fynetest.NewApp()
	defer application.Quit()
	status := widget.NewLabel("4 item(s)")
	status.Truncation = fyne.TextTruncateEllipsis
	buttons := container.NewHBox(widget.NewButton("Cancel", nil), widget.NewButton("Open", nil))
	footer := container.NewBorder(nil, nil, status, buttons, widget.NewLabel(""))
	if height := footer.MinSize().Height; height > 50 {
		t.Fatalf("footer minimum height = %v, want a single row", height)
	}
}

func TestAutocompleteEntryAcceptsSuggestionWithTab(t *testing.T) {
	entry := newAutocompleteEntry()
	entry.SetText("fire")
	entry.suggestion = "firebase-service.json"
	if !entry.AcceptsTab() {
		t.Fatal("entry did not capture Tab while a suggestion was available")
	}
	entry.TypedKey(&fyne.KeyEvent{Name: fyne.KeyTab})
	if entry.Text != "firebase-service.json" {
		t.Fatalf("completed text = %q", entry.Text)
	}
	entry.suggestion = ""
	if entry.AcceptsTab() {
		t.Fatal("entry captured Tab without a suggestion")
	}
}

func TestNormalizeBootstrapLocaleReplacesBareCLocale(t *testing.T) {
	t.Setenv("LC_ALL", "C.UTF-8")
	normalizeBootstrapLocale()
	if got := os.Getenv("LC_ALL"); got != "en_US.UTF-8" {
		t.Fatalf("LC_ALL = %q", got)
	}
}

func TestBootstrapThemeUsesCompactApplicationGeometry(t *testing.T) {
	bootstrap := bootstrapTheme{}
	if got := bootstrap.Size(theme.SizeNameInputRadius); got != 4 {
		t.Fatalf("input radius = %v, want 4", got)
	}
	if got := bootstrap.Size(theme.SizeNamePadding); got != 6 {
		t.Fatalf("padding = %v, want 6", got)
	}
	if got := bootstrap.Size(theme.SizeNameInnerPadding); got != 6 {
		t.Fatalf("inner padding = %v, want 6", got)
	}
}
