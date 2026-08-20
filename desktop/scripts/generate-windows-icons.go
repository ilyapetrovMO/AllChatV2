//go:build ignore

// generate-windows-icons removes transparent source padding and writes a
// multi-resolution ICO used by the executable, taskbar, and tray.
//
// Run from the repository root:
//
//	go run desktop/scripts/generate-windows-icons.go assets/branding/allchat-icon.png desktop/installer/allchat.ico
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/png"
	"os"

	"golang.org/x/image/draw"
)

var sizes = []int{16, 20, 24, 32, 40, 48, 64, 128, 256}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: generate-windows-icons <input.png> <output.ico>")
		os.Exit(2)
	}
	sourceFile, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer sourceFile.Close()
	source, err := png.Decode(sourceFile)
	if err != nil {
		panic(err)
	}
	bounds := opaqueBounds(source)
	if bounds.Empty() {
		panic("source icon is fully transparent")
	}

	frames := make([][]byte, 0, len(sizes))
	for _, size := range sizes {
		frame := render(source, bounds, size)
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, frame); err != nil {
			panic(err)
		}
		frames = append(frames, encoded.Bytes())
	}
	if err := os.WriteFile(os.Args[2], encodeICO(frames), 0o644); err != nil {
		panic(err)
	}
}

func opaqueBounds(source image.Image) image.Rectangle {
	bounds := source.Bounds()
	result := image.Rect(bounds.Max.X, bounds.Max.Y, bounds.Min.X, bounds.Min.Y)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			_, _, _, alpha := source.At(x, y).RGBA()
			if alpha == 0 {
				continue
			}
			if x < result.Min.X {
				result.Min.X = x
			}
			if y < result.Min.Y {
				result.Min.Y = y
			}
			if x >= result.Max.X {
				result.Max.X = x + 1
			}
			if y >= result.Max.Y {
				result.Max.Y = y + 1
			}
		}
	}
	return result
}

func render(source image.Image, crop image.Rectangle, size int) *image.NRGBA {
	margin := max(1, size/64)
	available := size - 2*margin
	scale := min(float64(available)/float64(crop.Dx()), float64(available)/float64(crop.Dy()))
	width, height := max(1, int(float64(crop.Dx())*scale+0.5)), max(1, int(float64(crop.Dy())*scale+0.5))
	destination := image.NewNRGBA(image.Rect(0, 0, size, size))
	target := image.Rect((size-width)/2, (size-height)/2, (size+width)/2, (size+height)/2)
	draw.CatmullRom.Scale(destination, target, source, crop, draw.Over, nil)
	return destination
}

func encodeICO(frames [][]byte) []byte {
	const headerSize, entrySize = 6, 16
	offset := headerSize + entrySize*len(frames)
	output := make([]byte, offset)
	binary.LittleEndian.PutUint16(output[2:4], 1)
	binary.LittleEndian.PutUint16(output[4:6], uint16(len(frames)))
	for index, frame := range frames {
		entry := output[headerSize+index*entrySize:]
		size := sizes[index]
		if size < 256 {
			entry[0], entry[1] = byte(size), byte(size)
		}
		binary.LittleEndian.PutUint16(entry[4:6], 1)
		binary.LittleEndian.PutUint16(entry[6:8], 32)
		binary.LittleEndian.PutUint32(entry[8:12], uint32(len(frame)))
		binary.LittleEndian.PutUint32(entry[12:16], uint32(offset))
		output = append(output, frame...)
		offset += len(frame)
	}
	return output
}
