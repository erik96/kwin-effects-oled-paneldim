// kwin-effects-oled-paneldim - KWin scripted effect (plugin id: paneldim)
//
// Dims Plasma panel (dock) windows on selected monitors by applying a
// persistent Effect.Brightness animation, and restores full brightness while
// the pointer is over a panel. Brightness is a multiplicative shader uniform,
// so black stays black; only luminous content loses intensity.
//
// State is one entry per dimmed window: { window, animId, hovered }.
//
// An animation keeps its window painted even when hidden, so the dim is
// dropped while an auto-hide panel is hidden and re-applied when shown.

"use strict";

const state = {
    level: 0.35,      // brightness while dimmed
    duration: 150,    // fade ms
    hover: true,      // un-dim while pointer is over the panel
    outputs: ["*"],   // include list, lowercased
    entries: [],
    watched: [],      // windows with windowHiddenChanged connected
    hiding: [],       // dim held during slide-out: { window, animId }
};

const SLIDE_OUT_MS = 200; // Sliding Popups default

// ---------------------------------------------------------------- logging
//
// print() goes to the kwin_scripting *debug* category, which is off by
// default. The QJSEngine console extension logs at info/warning level to the
// "js" category, which is on by default, so it shows up in the journal.

function log(msg) {
    if (typeof console !== "undefined" && console.info) {
        console.info("paneldim: " + msg);
    } else {
        print("paneldim: " + msg);
    }
}

function warn(msg) {
    if (typeof console !== "undefined" && console.warn) {
        console.warn("paneldim: " + msg);
    } else {
        print("paneldim: " + msg);
    }
}

// ---------------------------------------------------------------- config

function loadConfig() {
    state.level = clamp(Number(effect.readConfig("Brightness", 0.35)), 0.05, 1.0);
    state.duration = clamp(Number(effect.readConfig("Duration", 150)), 0, 2000);
    state.hover = Boolean(effect.readConfig("HoverUndim", true));
    state.outputs = String(effect.readConfig("Outputs", "*"))
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);
    if (state.outputs.length === 0) {
        state.outputs = ["*"];
    }
    log("config level=" + state.level + " duration=" + state.duration
        + " hover=" + state.hover + " outputs=" + JSON.stringify(state.outputs));
}

function clamp(v, lo, hi) {
    return isNaN(v) ? lo : Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------- matching

function outputKeys(screen) {
    const s = v => String(v || "").trim().toLowerCase();
    return [
        s(screen.name),                                   // DP-2
        s(screen.model),                                  // Odyssey G8
        s(screen.serialNumber),                           // H4ZX...
        (s(screen.manufacturer) + " " + s(screen.model)).trim(),
    ].filter(k => k.length > 0);
}

function outputMatches(screen) {
    if (!screen) {
        return false;
    }
    if (state.outputs.includes("*")) {
        return true;
    }
    const keys = outputKeys(screen);
    return state.outputs.some(o => keys.includes(o));
}

function isTarget(w) {
    return Boolean(w && w.dock && outputMatches(w.screen));
}

function logOutputs() {
    let screens = effects.screens;
    if (!screens || typeof screens.forEach !== "function") {
        // effects.screens not exposed as an array on this KWin;
        // derive the set of outputs from the dock windows instead.
        screens = [];
        effects.stackingOrder.forEach(w => {
            if (w.dock && w.screen && !screens.includes(w.screen)) {
                screens.push(w.screen);
            }
        });
    }
    screens.forEach(s => {
        if (s) {
            log("output name=\"" + s.name + "\" manufacturer=\"" + s.manufacturer
                + "\" model=\"" + s.model + "\" serial=\"" + s.serialNumber + "\""
                + (outputMatches(s) ? "  [dimmed]" : "  [ignored]"));
        }
    });
}

// ---------------------------------------------------------------- entries

function findIndex(w) {
    return state.entries.findIndex(e => e.window === w);
}

function dim(w, instant) {
    if (!isTarget(w)) {
        return;
    }
    watch(w);
    if (!w.visible || findIndex(w) >= 0) {
        return;
    }
    stopHiding(w);
    const hovered = state.hover && windowContains(w, effects.cursorPos);
    const target = hovered ? 1.0 : state.level;
    const animId = set({
        window: w,
        type: Effect.Brightness,
        from: instant ? target : 1.0,
        to: target,
        duration: instant ? 0 : state.duration,
        curve: QEasingCurve.InOutQuad,
    });
    state.entries.push({ window: w, animId: animId, hovered: hovered });
}

function watch(w) {
    if (state.watched.includes(w) || !w.windowHiddenChanged) {
        return;
    }
    state.watched.push(w);
    w.windowHiddenChanged.connect(onHiddenChanged);
}

function onHiddenChanged(w) {
    if (w.visible) {
        dim(w, true);
    } else {
        const i = findIndex(w);
        const wasDim = i >= 0 && !state.entries[i].hovered;
        undim(w);
        if (wasDim) {
            holdDimDuringSlideOut(w);
        }
    }
}

// Keeps the panel dimmed while it slides out, then releases the window.
function holdDimDuringSlideOut(w) {
    if (!effects.isEffectLoaded("slidingpopups") || effects.hasActiveFullScreenEffect) {
        return;
    }
    const animId = animate({
        window: w,
        type: Effect.Brightness,
        from: state.level,
        to: state.level,
        // End slightly early so the panel never flashes after the slide.
        duration: Math.round(animationTime(SLIDE_OUT_MS) * 0.85),
    });
    state.hiding.push({ window: w, animId: animId });
}

function stopHiding(w) {
    const i = state.hiding.findIndex(h => h.window === w);
    if (i >= 0) {
        cancel(state.hiding[i].animId);
        state.hiding.splice(i, 1);
    }
}

function forget(w) {
    undim(w);
    stopHiding(w);
    const i = state.watched.indexOf(w);
    if (i >= 0) {
        state.watched.splice(i, 1);
    }
}

function undim(w) {
    const i = findIndex(w);
    if (i < 0) {
        return;
    }
    cancel(state.entries[i].animId);
    state.entries.splice(i, 1);
}

function rescan() {
    // Drop windows that no longer qualify (config change), add ones that do.
    state.entries.slice().forEach(e => {
        if (!isTarget(e.window)) {
            undim(e.window);
        }
    });
    effects.stackingOrder.forEach(w => dim(w, false));
}

// ---------------------------------------------------------------- hover

// EffectWindow exposes the frame geometry to scripts as scalar x/y/width/height
// (the QRectF property is named "geometry", not "frameGeometry").
function windowContains(w, p) {
    return p.x >= w.x && p.x < w.x + w.width
        && p.y >= w.y && p.y < w.y + w.height;
}

function onMouseChanged(pos) {
    if (!state.hover || state.entries.length === 0) {
        return;
    }
    state.entries.forEach(e => {
        const w = e.window;
        const over = w.visible && windowContains(w, pos);
        if (over === e.hovered) {
            return;
        }
        e.hovered = over;
        retarget(e.animId, over ? 1.0 : state.level, state.duration);
    });
}

// ---------------------------------------------------------------- lifecycle

function reconfigure() {
    loadConfig();
    logOutputs();
    rescan();
    state.entries.forEach(e => {
        if (!state.hover) {
            e.hovered = false;
        }
        retarget(e.animId, e.hovered ? 1.0 : state.level, state.duration);
    });
}

loadConfig();
logOutputs();

effects.windowAdded.connect(w => dim(w, false));
effects.windowClosed.connect(forget);
effect.configChanged.connect(reconfigure);

// startMousePolling() no longer exists in Plasma 6; mouseChanged is always live
// on Wayland. Guard anyway so a missing signal degrades to "no hover" rather
// than a failed load.
if (effects.mouseChanged && typeof effects.mouseChanged.connect === "function") {
    effects.mouseChanged.connect(onMouseChanged);
} else {
    warn("effects.mouseChanged unavailable; hover un-dim disabled");
}

rescan();
