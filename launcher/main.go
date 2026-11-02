// Crumb.exe — single-file launcher.
// On first run it unpacks the app to %LOCALAPPDATA%\Crumb\<version> (a few seconds),
// then starts it. Later runs start instantly.
package main

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

//go:embed payload.zip
var payload []byte

var version = "dev" // set with -ldflags "-X main.version=..."

func msg(text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString("Crumb")
	box.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x10)
}

func extract(dir string) error {
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return err
	}
	for _, f := range zr.File {
		p := filepath.Join(dir, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(p, filepath.Clean(dir)+string(os.PathSeparator)) {
			continue
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(p, 0o755)
			continue
		}
		os.MkdirAll(filepath.Dir(p), 0o755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(p)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		out.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func main() {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	root := filepath.Join(base, "Crumb")
	dir := filepath.Join(root, version)
	marker := filepath.Join(dir, ".installed")

	if _, err := os.Stat(marker); err != nil {
		// clean up older versions, then unpack this one
		if entries, e := os.ReadDir(root); e == nil {
			for _, en := range entries {
				if en.Name() != version {
					os.RemoveAll(filepath.Join(root, en.Name()))
				}
			}
		}
		os.RemoveAll(dir)
		if err := extract(dir); err != nil {
			msg("Crumb could not unpack itself:\n" + err.Error())
			return
		}
		os.WriteFile(marker, []byte(version), 0o644)
	}

	cmd := exec.Command(filepath.Join(dir, "Crumb.exe"), os.Args[1:]...)
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		msg("Crumb could not start:\n" + err.Error())
	}
}
