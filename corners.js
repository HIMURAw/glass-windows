import Meta from 'gi://Meta';

import {ChamferEffect} from './mask.js';
import {recolor} from './theme.js';

// Lavender like the island's frame (in the chosen colour theme); brighter on the focused window.
function frameColor(alpha) {
    const [r, g, b] = recolor(168, 132, 255);
    return [r / 255, g / 255, b / 255, alpha];
}

const TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
]);

// Puts the chamfer shader on every ordinary window. Maximized and fullscreen windows
// fill the screen edge to edge, so they keep square corners.
export class Corners {
    constructor(settings) {
        this._settings = settings;
        this._tracked = new Map();
        this._pending = new Map(); // window -> 'shown' handler, until it has an actor
        this._ids = [
            global.display.connect('window-created', (_d, win) => this._watch(win)),
            global.display.connect('notify::focus-window', () => this.refreshAll()),
        ];
        this._settingIds = [
            settings.connect('changed::chamfer', () => this.refreshAll()),
        ];
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window);
    }

    _watch(win) {
        if (!win || this._tracked.has(win))
            return;
        // The actor can come a moment after the window.
        const actor = win.get_compositor_private();
        if (!actor) {
            // Tracked so destroy() can drop it: a window first shown after disable() must not
            // get an effect from a dead instance.
            if (!this._pending.has(win)) {
                const id = win.connect('shown', () => {
                    this._pending.delete(win);
                    win.disconnect(id);
                    this._watch(win);
                });
                this._pending.set(win, id);
            }
            return;
        }
        const entry = {actor, effect: null, ids: []};
        this._tracked.set(win, entry);
        const refresh = () => this._refresh(win);
        entry.ids.push(
            [win, win.connect('size-changed', refresh)],
            [win, win.connect('notify::maximized-horizontally', refresh)],
            [win, win.connect('notify::maximized-vertically', refresh)],
            [win, win.connect('notify::fullscreen', refresh)],
            [win, win.connect('unmanaged', () => this._forget(win))],
            [actor, actor.connect('notify::size', refresh)],
            // At logout the actor can go before the window is unmanaged.
            [actor, actor.connect('destroy', () => this._forget(win))],
        );
        refresh();
    }

    _wants(win) {
        return TYPES.has(win.get_window_type()) &&
            !win.is_fullscreen() &&
            !(win.maximized_horizontally && win.maximized_vertically) &&
            !win.is_skip_taskbar?.();
    }

    _refresh(win) {
        const entry = this._tracked.get(win);
        if (!entry)
            return;
        const {actor} = entry;
        if (!this._wants(win)) {
            if (entry.effect) {
                actor.remove_effect(entry.effect);
                entry.effect = null;
            }
            return;
        }
        if (!entry.effect) {
            entry.effect = new ChamferEffect();
            actor.add_effect_with_name('glass-windows-corners', entry.effect);
        }
        // Where the window's frame sits inside the actor (the rest is client shadow).
        const frame = win.get_frame_rect();
        const buffer = win.get_buffer_rect();
        const [w, h] = actor.get_size();
        entry.effect.setShape(w, h, frame.x - buffer.x, frame.y - buffer.y,
            frame.width, frame.height, this._settings.get_int('chamfer'));
        entry.effect.setFrame(frameColor(win.has_focus() ? 0.55 : 0.16), 1);
    }

    refreshAll() {
        for (const win of this._tracked.keys())
            this._refresh(win);
    }

    _forget(win) {
        const entry = this._tracked.get(win);
        if (!entry)
            return;
        this._tracked.delete(win);
        // Either end may already be disposed (logout, a closing window): each step on its own.
        for (const [obj, id] of entry.ids) {
            try {
                obj.disconnect(id);
            } catch {
                // disposed
            }
        }
        if (entry.effect) {
            try {
                entry.actor.remove_effect(entry.effect);
            } catch {
                // disposed
            }
        }
    }

    destroy() {
        for (const [win, id] of this._pending) {
            try {
                win.disconnect(id);
            } catch {
                // disposed
            }
        }
        this._pending.clear();
        for (const win of [...this._tracked.keys()])
            this._forget(win);
        this._ids.forEach(id => global.display.disconnect(id));
        this._settingIds.forEach(id => this._settings.disconnect(id));
    }
}
