//go:build !bootstrap_gui

package main

import "fmt"

func main() {
	fmt.Println("allchat-bootstrap is a native desktop application; rebuild with -tags bootstrap_gui")
}
