# Glass Windows

A GNOME Shell extension that gives your windows 45° cut corners with a thin glass frame, and adds Windows 11 style snapping: Snap Layouts, Snap Assist and `Super`+arrow quarters.

<!-- screenshot: wide desktop with two or three app windows showing the chamfered corners and thin lavender frame (focused window brighter), and the Snap Layouts picker open (Super+Z) under the focused window's top-right corner with one zone highlighted and the translucent preview showing where the window will land -->

Part of [himura-desktop](https://github.com/HIMURAw/himura-desktop), but it works on its own.

## What you get

- **Cut-corner windows.** Normal windows, dialogs and utility windows get 45° chamfered corners and a thin frame. The frame is brighter on the focused window. Maximized and fullscreen windows stay square.
- **Snap Layouts.** Press `Super+Z` to open a row of layouts under the focused window's top-right corner, then click a zone. Or drag a window to the top edge of the screen: a strip of layouts drops down, and you release the window on the zone you want. A preview shows where the window will land.
- **Snap Assist.** After you snap a window, the empty zones are offered to your other windows (same monitor and workspace, not minimized) as thumbnails. Click one to fill the zone; it continues until every zone is filled or you dismiss it.
- **Super+arrows** snap to halves and quarters the way Windows 11 does (table below).
- **Gaps.** Snapped windows get a small gap between them and the screen edge, which you can change.

The six layouts: two halves; two thirds and one third; three columns; one half with two stacked halves; four quarters; a narrow quarter, a wide half and a narrow quarter.

## Keyboard shortcuts

| Keys | What it does |
| --- | --- |
| `Super+Z` | Open Snap Layouts for the focused window (configurable, see Settings) |
| `Esc` or click outside | Close the layouts picker or Snap Assist |
| `Super+Left` | Left half. From the right half: restore the previous size. From a right quarter: the matching left quarter |
| `Super+Right` | Right half. From the left half: restore. From a left quarter: the matching right quarter |
| `Super+Up` | Maximize. From the left or right half: the top quarter on that side. From a bottom quarter: the half on that side |
| `Super+Down` | Restore if maximized, minimize otherwise. From a half: the bottom quarter on that side. From a top quarter: the half on that side |

`Super+arrow` takes over GNOME's built-in tiling shortcuts (tile left/right, maximize, unmaximize) while the extension is on.

## Requirements

- GNOME Shell 50 (the only version listed in `metadata.json`)
- `glib-compile-schemas` (from the GLib tools) when you install from source

## Install

After installing on Wayland, **log out and back in** once. GNOME only loads new extensions at login.

### 1. With the himura-desktop installer

```bash
curl -fsSL https://raw.githubusercontent.com/HIMURAw/himura-desktop/main/install.sh | bash -s -- windows
```

Run it again later to update. Other parts (`island`, `dock`, `widgets`, `files`, `theme`, `away-lock`) can be added the same way.

### 2. From source

Install git and the GLib tools for your distro:

| Distro | Command |
| --- | --- |
| Fedora | `sudo dnf install git glib2` |
| Ubuntu / Debian | `sudo apt install git libglib2.0-bin` |
| Arch | `sudo pacman -S git glib2` |

```bash
git clone https://github.com/HIMURAw/glass-windows
cd glass-windows
./install.sh
```

`install.sh` compiles the settings schema, links the folder into `~/.local/share/gnome-shell/extensions/glass-windows@himuraw` and adds it to your enabled extensions. Log out and back in afterwards. To update, `git pull` and log out and in again.

### Uninstall

```bash
gnome-extensions disable glass-windows@himuraw
rm ~/.local/share/gnome-shell/extensions/glass-windows@himuraw
```

If you used the himura-desktop installer, this does the same:

```bash
curl -fsSL https://raw.githubusercontent.com/HIMURAw/himura-desktop/main/uninstall.sh | bash -s -- windows
```

## Settings

There is no settings window; use `gsettings` (or dconf Editor).

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `corners` | boolean | `true` | Cut window corners at 45° and draw the frame |
| `chamfer` | integer, 0 to 24 | `7` | Size of the corner cut in pixels |
| `gap` | integer, 0 to 32 | `6` | Gap between snapped windows, and between them and the screen edge, in pixels |
| `snap-assist` | boolean | `true` | Offer other windows for the empty zones after snapping |
| `snap-layouts` | list of strings | `['<Super>z']` | Shortcut that shows Snap Layouts |

Examples, pointing `gsettings` at the schema folder of the installed extension:

```bash
SCHEMA=~/.local/share/gnome-shell/extensions/glass-windows@himuraw/schemas

gsettings --schemadir $SCHEMA set org.gnome.shell.extensions.glass-windows chamfer 12
gsettings --schemadir $SCHEMA set org.gnome.shell.extensions.glass-windows gap 0
gsettings --schemadir $SCHEMA set org.gnome.shell.extensions.glass-windows snap-assist false
gsettings --schemadir $SCHEMA set org.gnome.shell.extensions.glass-windows snap-layouts "['<Super>grave']"
gsettings --schemadir $SCHEMA reset-recursively org.gnome.shell.extensions.glass-windows
```

## Colour themes

On its own, Glass Windows is violet. With the Mor theme from [himura-desktop](https://github.com/HIMURAw/himura-desktop), the `tema-rengi` command recolours the frame, the layouts picker and Snap Assist live, with no restart. The extension reads `~/.config/tema/current.json` and watches it for changes. The themes it knows are `turkuaz` (turquoise), `yesil` (green), `mavi` (blue), `mor` (violet), `gri` (grey) and `cam` (glass).

```bash
tema-rengi mavi
```

The `cam` theme also changes the shape: windows get rounded corners (12 px, so `chamfer` is not used) with a faint white frame, and the panels get a rounded glass look.

## Troubleshooting

**Nothing changed after installing.** On Wayland you have to log out and back in. Check with `gnome-extensions list --enabled | grep glass-windows`.

**The extension will not load on my GNOME.** It only declares support for GNOME Shell 50.

**`Super+Z` does nothing.** Another extension or a GNOME setting may already use that shortcut. Pick another with the `snap-layouts` key.

**`Super+arrow` behaves differently than before.** The extension takes over GNOME's tiling shortcuts. Disable it to get the stock behaviour back.

**Some windows have square corners.** Maximized and fullscreen windows are always square, and only normal windows, dialogs and utility windows get the effect.

**Snap Assist did not appear.** It only shows when `snap-assist` is on and at least one other window is open, not minimized, on the same monitor and workspace.

**Errors or a crash.** Watch the shell log while you reproduce it:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

## Contributing

Issues and pull requests are welcome. The code is plain GJS: `snap.js` (layouts, assist, shortcuts), `corners.js` and `mask.js` (the corner shader), `theme.js` (colour themes). `./build.sh` recompiles the schema, and `./build.sh pack` builds a zip for extensions.gnome.org and GitHub releases.

## License

GPL-3.0. See [LICENSE](LICENSE).
