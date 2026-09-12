# kwin-effects-oled-paneldim

KWin scripted effect for KDE Plasma 6 (Wayland and X11) that dims Plasma panels
on selected monitors to reduce OLED burn-in, and restores full brightness while
the pointer is over a panel - the same behaviour as Samsung Display Manager's
"Taskbar Brightness", but done in the compositor.

Only windows of type *dock* (Plasma panels) are affected. Games, fullscreen
video and everything else are untouched.

## Install

    kpackagetool6 -t KWin/Effect -i kwin-effects-oled-paneldim/
    qdbus org.kde.KWin /Effects loadEffect paneldim   # or enable it in
                                                      # System Settings > Desktop Effects

Upgrade an existing install with `-u`, remove with `-r paneldim`.

## Configure

System Settings > Window Management > Desktop Effects > search "OLED Panel Dim" >
configure icon on the right of the entry. Tick the checkbox to enable it
persistently across sessions.

| Setting | Default | Meaning |
|---|---|---|
| Dimmed brightness | 0.35 | Multiplier applied to the panel (1.0 = off) |
| Fade duration | 150 ms | Transition time for dim / un-dim |
| Restore on hover | on | Full brightness while the pointer is over the panel |
| Monitors to dim | `*` | Include list, comma-separated |

Each monitor entry matches, case-insensitively, the connector name (`DP-2`),
the EDID model (`Odyssey G8`), the serial number, or `Manufacturer Model`.
Prefer model or serial over connector name: connectors are re-enumerated on
GPU or driver changes, EDID identity is not. `*` matches every monitor.

To see what your monitors report, load the effect and run:

    journalctl --user -b -g paneldim

Settings live in `~/.config/kwinrc` under `[Effect-paneldim]` and are applied
live when you press Apply.

## How it works

KWin lets scripted effects attach a persistent `Effect.Brightness` animation to
a window. Brightness is a per-window uniform in the compositor's fragment
shader, so the panel's pixels are scaled at composition time - black stays
black, nothing is overlaid, nothing is rendered twice. Pointer position comes
from `effects.mouseChanged`; entering a panel's frame rectangle retargets the
animation to 1.0, leaving it retargets back to the configured level.

No compiled code, so nothing to rebuild when KWin updates.

## License

MIT, see [LICENSE](LICENSE).
