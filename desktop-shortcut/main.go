// Crumby.exe (small) — opens the newest Crumby installed in %LOCALAPPDATA%\Crumby.
package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"syscall"
	"unsafe"
)

func msg(text string) {
	box := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString("Crumby")
	box.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x40)
}

func main() {
	root := filepath.Join(os.Getenv("LOCALAPPDATA"), "Crumby")
	entries, _ := os.ReadDir(root)
	type cand struct{ path string; t int64 }
	var list []cand
	for _, e := range entries {
		exe := filepath.Join(root, e.Name(), "Crumby.exe")
		if st, err := os.Stat(exe); err == nil {
			list = append(list, cand{exe, st.ModTime().UnixNano()})
		}
	}
	if len(list) == 0 {
		msg("O Crumby ainda não está instalado. Baixe o Crumby.exe completo no GitHub (willsn0w/crumby-cleaner) e abra uma vez.")
		return
	}
	sort.Slice(list, func(i, j int) bool { return list[i].t > list[j].t })
	cmd := exec.Command(list[0].path, os.Args[1:]...)
	cmd.Dir = filepath.Dir(list[0].path)
	if err := cmd.Start(); err != nil {
		msg("Não consegui abrir o Crumby:\n" + err.Error())
	}
}
