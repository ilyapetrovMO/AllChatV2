//go:build bootstrap_gui

package main

import (
	"image/color"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/theme"
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

func TestBootstrapThemeUsesCompactApplicationGeometry(t *testing.T) {
	bootstrap := bootstrapTheme{}
	if got := bootstrap.Size(theme.SizeNameInputRadius); got != 4 {
		t.Fatalf("input radius = %v, want 4", got)
	}
	if got := bootstrap.Size(theme.SizeNamePadding); got != 12 {
		t.Fatalf("padding = %v, want 12", got)
	}
}
