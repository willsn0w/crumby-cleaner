# Crumby desktop helper (Windows).
# Long-lived process: reads commands from stdin, one per line.
#   scan     -> "VS<TAB>x<TAB>y" (virtual-screen origin), then one line per desktop icon:
#               IT, index, posX, posY, icon rect (l t r b), full item rect (l t r b), name   (physical px)
#   hide     -> hides the desktop icon layer
#   show     -> shows it again
#   move<TAB>name<TAB>x<TAB>y -> moves that real desktop icon to position x,y
#   mouse    -> 1 if the left mouse button is down, else 0
#   minall   -> minimizes all windows (so the desktop is in view)
#   undomin  -> restores them
# Every reply ends with a line "<<END>>".
# When stdin closes (app quit OR crashed) the icons are ALWAYS shown again.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class CrumbyDesk {
  [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string w);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr p, IntPtr addr, UIntPtr size, uint type, uint prot);
  [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr p, IntPtr addr, UIntPtr size, uint type);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr p, IntPtr addr, byte[] buf, UIntPtr size, out UIntPtr n);
  [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr p, IntPtr addr, byte[] buf, UIntPtr size, out UIntPtr n);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  public static bool LeftButtonDown() {
    int key = GetSystemMetrics(23) != 0 ? 0x02 : 0x01; // swapped buttons
    return (GetAsyncKeyState(key) & 0x8000) != 0;
  }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);

  static IntPtr found = IntPtr.Zero;

  public static IntPtr ListView() {
    IntPtr progman = FindWindow("Progman", null);
    IntPtr dv = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (dv == IntPtr.Zero) {
      found = IntPtr.Zero;
      EnumWindows(delegate (IntPtr h, IntPtr l) {
        IntPtr d = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (d != IntPtr.Zero) { found = d; return false; }
        return true;
      }, IntPtr.Zero);
      dv = found;
    }
    if (dv == IntPtr.Zero) return IntPtr.Zero;
    return FindWindowEx(dv, IntPtr.Zero, "SysListView32", null);
  }

  public static void Show(bool show) {
    IntPtr lv = ListView();
    if (lv != IntPtr.Zero) ShowWindow(lv, show ? 5 : 0);
  }

  public static string Scan() {
    IntPtr lv = ListView();
    if (lv == IntPtr.Zero) return "";
    int count = (int)SendMessage(lv, 0x1004, IntPtr.Zero, IntPtr.Zero); // LVM_GETITEMCOUNT
    uint pid; GetWindowThreadProcessId(lv, out pid);
    IntPtr hp = OpenProcess(0x0008 | 0x0010 | 0x0020 | 0x0400, false, pid);
    if (hp == IntPtr.Zero) return "";
    IntPtr mem = VirtualAllocEx(hp, IntPtr.Zero, (UIntPtr)4096, 0x3000, 0x04);
    StringBuilder sb = new StringBuilder();
    sb.Append("VS\t").Append(GetSystemMetrics(76)).Append('\t').Append(GetSystemMetrics(77)).Append('\n');
    UIntPtr n;
    try {
      for (int i = 0; i < count; i++) {
        // item position (LVM_GETITEMPOSITION)
        byte[] pt = new byte[8];
        SendMessage(lv, 0x1010, (IntPtr)i, mem);
        ReadProcessMemory(hp, mem, pt, (UIntPtr)8, out n);
        int px = BitConverter.ToInt32(pt, 0), py = BitConverter.ToInt32(pt, 4);

        // icon rectangle (LVM_GETITEMRECT, LVIR_ICON) and whole item incl. label (LVIR_BOUNDS)
        int[] ic = ItemRect(lv, hp, mem, i, 1);
        int[] bd = ItemRect(lv, hp, mem, i, 0);

        // item text (LVM_GETITEMTEXTW) - 64-bit LVITEMW
        IntPtr textAddr = (IntPtr)((long)mem + 1024);
        byte[] item = new byte[88];
        BitConverter.GetBytes((uint)1).CopyTo(item, 0);   // mask = LVIF_TEXT
        BitConverter.GetBytes(i).CopyTo(item, 4);         // iItem
        BitConverter.GetBytes((long)textAddr).CopyTo(item, 24); // pszText
        BitConverter.GetBytes(260).CopyTo(item, 32);      // cchTextMax
        WriteProcessMemory(hp, mem, item, (UIntPtr)88, out n);
        int len = (int)SendMessage(lv, 0x1073, (IntPtr)i, mem);
        byte[] tb = new byte[520];
        ReadProcessMemory(hp, textAddr, tb, (UIntPtr)520, out n);
        len = Math.Max(0, Math.Min(len, 260));
        string name = Encoding.Unicode.GetString(tb, 0, len * 2);
        sb.Append("IT\t").Append(i).Append('\t').Append(px).Append('\t').Append(py);
        foreach (int v in ic) sb.Append('\t').Append(v);
        foreach (int v in bd) sb.Append('\t').Append(v);
        sb.Append('\t').Append(name).Append('\n');
      }
    } finally {
      VirtualFreeEx(hp, mem, UIntPtr.Zero, 0x8000);
      CloseHandle(hp);
    }
    return sb.ToString();
  }

  static int[] ItemRect(IntPtr lv, IntPtr hp, IntPtr mem, int i, int code) {
    UIntPtr n;
    byte[] rc = new byte[16];
    BitConverter.GetBytes(code).CopyTo(rc, 0);
    WriteProcessMemory(hp, mem, rc, (UIntPtr)16, out n);
    SendMessage(lv, 0x100E, (IntPtr)i, mem);
    ReadProcessMemory(hp, mem, rc, (UIntPtr)16, out n);
    return new int[] { BitConverter.ToInt32(rc, 0), BitConverter.ToInt32(rc, 4), BitConverter.ToInt32(rc, 8), BitConverter.ToInt32(rc, 12) };
  }

  // move a real desktop icon (found by its label) to x,y (LVM_SETITEMPOSITION)
  public static bool Move(string name, int x, int y) {
    IntPtr lv = ListView();
    if (lv == IntPtr.Zero) return false;
    string scan = Scan();
    foreach (string line in scan.Split('\n')) {
      string[] p = line.Split('\t');
      if (p.Length < 13 || p[0] != "IT") continue;
      string nm = string.Join("\t", p, 12, p.Length - 12);
      if (nm != name) continue;
      int idx = int.Parse(p[1]);
      long lp = ((long)(y & 0xFFFF) << 16) | (long)(x & 0xFFFF);
      SendMessage(lv, 0x100F, (IntPtr)idx, (IntPtr)lp);
      return true;
    }
    return false;
  }
}
"@

$minimized = $false
$shellApp = $null
try {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null) { break }
    $parts = $line.TrimEnd("`r").Split("`t")
    try {
      switch ($parts[0].Trim()) {
        'scan' { [Console]::Out.Write([CrumbyDesk]::Scan()) }
        'hide' { [CrumbyDesk]::Show($false) }
        'show' { [CrumbyDesk]::Show($true) }
        'mouse' { if ([CrumbyDesk]::LeftButtonDown()) { [Console]::Out.WriteLine('1') } else { [Console]::Out.WriteLine('0') } }
        'move' { if ($parts.Length -ge 4) { [void][CrumbyDesk]::Move($parts[1], [int]$parts[2], [int]$parts[3]) } }
        'minall' {
          if ($shellApp -eq $null) { $shellApp = New-Object -ComObject Shell.Application }
          $shellApp.MinimizeAll(); $minimized = $true
        }
        'undomin' {
          if ($minimized -and $shellApp -ne $null) { $shellApp.UndoMinimizeALL() }
          $minimized = $false
        }
        'exit' { break }
      }
    } catch { [Console]::Out.WriteLine("ERR`t" + $_.Exception.Message) }
    [Console]::Out.WriteLine('<<END>>')
    [Console]::Out.Flush()
    if ($line.Trim() -eq 'exit') { break }
  }
} finally {
  [CrumbyDesk]::Show($true)
  if ($minimized -and $shellApp -ne $null) { try { $shellApp.UndoMinimizeALL() } catch {} }
}
