//go:build ignore

// generate-macos-icon wraps a square 1024px PNG in the modern ICNS ic10 slot.
// Run from the repository root when the canonical application artwork changes:
//
//   go run desktop/scripts/generate-macos-icon.go <input.png> <output.icns>
package main

import (
	"encoding/binary"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: generate-macos-icon <input.png> <output.icns>")
		os.Exit(2)
	}
	png, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	const headerSize = 8
	data := make([]byte, headerSize+headerSize+len(png))
	copy(data[0:4], "icns")
	binary.BigEndian.PutUint32(data[4:8], uint32(len(data)))
	copy(data[8:12], "ic10")
	binary.BigEndian.PutUint32(data[12:16], uint32(headerSize+len(png)))
	copy(data[16:], png)
	if err := os.WriteFile(os.Args[2], data, 0o644); err != nil {
		panic(err)
	}
}
