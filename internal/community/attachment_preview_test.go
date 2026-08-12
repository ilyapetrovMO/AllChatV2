// AllChat is free software under the GNU Affero General Public License v3.0 or later.
package community

import (
	"image"
	"image/color"
	"testing"
)

func TestImageHasTransparency(t *testing.T) {
	opaque := image.NewRGBA(image.Rect(0, 0, 2, 2))
	opaque.SetRGBA(0, 0, color.RGBA{R: 1, A: 255})
	opaque.SetRGBA(1, 0, color.RGBA{A: 255})
	opaque.SetRGBA(0, 1, color.RGBA{A: 255})
	opaque.SetRGBA(1, 1, color.RGBA{A: 255})
	if imageHasTransparency(opaque) {
		t.Fatal("opaque image reported transparency")
	}
	opaque.SetRGBA(1, 1, color.RGBA{A: 100})
	if !imageHasTransparency(opaque) {
		t.Fatal("transparent image reported opaque")
	}
}

func TestPreviewDimensionsPreserveAspectRatio(t *testing.T) {
	width, height := previewDimensions(4000, 2000, 1280)
	if width != 1280 || height != 640 {
		t.Fatalf("previewDimensions = %dx%d", width, height)
	}
}
