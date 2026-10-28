import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {chamferWidget} from './mask.js';

// Zones as fractions of the work area: [x, y, width, height].
const LAYOUTS = [
    [[0, 0, 1 / 2, 1], [1 / 2, 0, 1 / 2, 1]],
    [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
    [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
    [[0, 0, 1 / 2, 1], [1 / 2, 0, 1 / 2, 1 / 2], [1 / 2, 1 / 2, 1 / 2, 1 / 2]],
    [[0, 0, 1 / 2, 1 / 2], [1 / 2, 0, 1 / 2, 1 / 2], [0, 1 / 2, 1 / 2, 1 / 2], [1 / 2, 1 / 2, 1 / 2, 1 / 2]],
    [[0, 0, 1 / 4, 1], [1 / 4, 0, 1 / 2, 1], [3 / 4, 0, 1 / 4, 1]],
];

// Super+arrow targets.
const TILES = {
    left: [0, 0, 1 / 2, 1], right: [1 / 2, 0, 1 / 2, 1],
    tl: [0, 0, 1 / 2, 1 / 2], tr: [1 / 2, 0, 1 / 2, 1 / 2],
    bl: [0, 1 / 2, 1 / 2, 1 / 2], br: [1 / 2, 1 / 2, 1 / 2, 1 / 2],
};
// What Super+arrow does from each state, as in Windows 11. null = not snapped.
const MOVES = {
    left: {right: 'restore', tr: 'tl', br: 'bl', tl: 'tl', bl: 'bl', _: 'left'},
    right: {left: 'restore', tl: 'tr', bl: 'br', tr: 'tr', br: 'br', _: 'right'},
    up: {left: 'tl', right: 'tr', bl: 'left', br: 'right', tl: 'tl', tr: 'tr', _: 'maximize'},
    down: {left: 'bl', right: 'br', tl: 'left', tr: 'right', bl: 'bl', br: 'br', _: 'minimize'},
};

const CARD_W = 92;
const CUT = 7;
// Round themes (cam): panels 22px, the preview 14px, as the Cam Panel's cards and rows.
const PANEL_RADIUS = 22;
const PREVIEW_RADIUS = 14;
// The drop strip opens when a dragged window's pointer comes this close to the top.
const TOP_BAND = 14;

function zoneRect(area, zone, gap) {
    const [fx, fy, fw, fh] = zone;
    const eps = 1e-3;
    const left = fx < eps ? gap : gap / 2;
    const top = fy < eps ? gap : gap / 2;
    const right = fx + fw > 1 - eps ? gap : gap / 2;
    const bottom = fy + fh > 1 - eps ? gap : gap / 2;
    const x = Math.round(area.x + fx * area.width + left);
    const y = Math.round(area.y + fy * area.height + top);
    return {
        x, y,
        width: Math.round(area.x + (fx + fw) * area.width - right) - x,
        height: Math.round(area.y + (fy + fh) * area.height - bottom) - y,
    };
}

function workArea(monitor) {
    return Main.layoutManager.getWorkAreaForMonitor(monitor);
}

function inside(actor, x, y) {
    const [ax, ay] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return x >= ax && x < ax + w && y >= ay && y < ay + h;
}

// The row of layout cards; each zone is a button.
class Picker {
    constructor(monitor, onPick, onHover) {
        const area = workArea(monitor);
        const cardH = Math.round(CARD_W * area.height / area.width);
        this.actor = new St.BoxLayout({style_class: 'gw-picker', reactive: true});
        this.zones = [];
        LAYOUTS.forEach((layout, li) => {
            const card = new St.Widget({
                style_class: 'gw-card',
                layout_manager: new Clutter.FixedLayout(),
                width: CARD_W, height: cardH,
            });
            layout.forEach((zone, zi) => {
                const r = zoneRect({x: 0, y: 0, width: CARD_W, height: cardH}, zone, 4);
                const button = new St.Button({style_class: 'gw-zone', x: r.x, y: r.y, width: r.width, height: r.height});
                button.connect('clicked', () => onPick(li, zi));
                button.connect('notify::hover', () => onHover(button.hover ? [li, zi] : null));
                card.add_child(button);
                this.zones.push({button, li, zi});
            });
            this.actor.add_child(card);
        });
        chamferWidget(this.actor, CUT, PANEL_RADIUS);
    }

    // For drags, where the pointer is grabbed and hover never fires.
    zoneAt(x, y) {
        let found = null;
        for (const z of this.zones) {
            const hit = inside(z.button, x, y);
            if (hit)
                found = z;
            if (hit)
                z.button.add_style_pseudo_class('hover');
            else
                z.button.remove_style_pseudo_class('hover');
        }
        return found;
    }

    destroy() {
        this.actor.destroy();
    }
}

export class Snap {
    constructor(settings) {
        this._settings = settings;
        // Window -> {state, restore}: which tile it is in and its size before snapping.
        this._tiles = new WeakMap();

        this._preview = new St.Widget({style_class: 'gw-preview', visible: false, opacity: 0});
        chamferWidget(this._preview, CUT, PREVIEW_RADIUS);
        Main.layoutManager.uiGroup.add_child(this._preview);

        Main.wm.addKeybinding('snap-layouts', settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._showForFocus());

        const keys = {
            'toggle-tiled-left': 'left', 'toggle-tiled-right': 'right',
            'maximize': 'up', 'unmaximize': 'down',
        };
        this._keys = Object.keys(keys);
        for (const [name, dir] of Object.entries(keys)) {
            Meta.keybindings_set_custom_handler(name, (display, win) =>
                this._arrow(win ?? display.focus_window, dir));
        }

        this._ids = [
            global.display.connect('grab-op-begin', (_d, win, op) => this._dragBegin(win, op)),
            global.display.connect('grab-op-end', (_d, win, op) => this._dragEnd(win, op)),
        ];
    }

    // ---------- Placing ----------

    _place(win, zone, state = 'zone') {
        if (win.is_fullscreen())
            win.unmake_fullscreen();
        const tile = this._tiles.get(win);
        if (win.is_maximized())
            win.unmaximize();
        const restore = tile?.restore ?? win.get_frame_rect();
        const r = zoneRect(workArea(win.get_monitor()), zone, this._settings.get_int('gap'));
        win.move_resize_frame(true, r.x, r.y, r.width, r.height);
        this._tiles.set(win, {state, restore, rect: r});
    }

    _restore(win) {
        const tile = this._tiles.get(win);
        this._tiles.delete(win);
        if (win.is_maximized()) {
            win.unmaximize();
            return;
        }
        if (tile?.restore) {
            const r = tile.restore;
            win.move_resize_frame(true, r.x, r.y, r.width, r.height);
        }
    }

    _arrow(win, dir) {
        if (!win || win.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        let state = this._tiles.get(win)?.state ?? null;
        if (state === 'zone')
            state = null;
        if (win.is_maximized())
            state = 'maximized';
        let move;
        if (state === 'maximized')
            move = dir === 'down' ? 'restore' : dir === 'up' ? 'maximize' : MOVES[dir]._;
        else
            move = MOVES[dir][state] ?? MOVES[dir]._;

        if (move === 'restore')
            this._restore(win);
        else if (move === 'maximize')
            win.maximize();
        else if (move === 'minimize')
            win.minimize();
        else
            this._place(win, TILES[move], move);
    }

    // ---------- Snap layouts from the keyboard ----------

    _showForFocus() {
        const win = global.display.focus_window;
        if (!win || win.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        this._closePicker();
        const monitor = win.get_monitor();
        const geo = Main.layoutManager.monitors[monitor];

        this._backdrop = new St.Widget({reactive: true, x: geo.x, y: geo.y, width: geo.width, height: geo.height});
        this._backdrop.connect('button-press-event', () => {
            this._closePicker();
            return Clutter.EVENT_STOP;
        });
        this._backdrop.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                this._closePicker();
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.uiGroup.add_child(this._backdrop);

        this._picker = new Picker(monitor,
            (li, zi) => {
                this._closePicker();
                this._snapInto(win, li, zi);
            },
            hovered => this._showPreview(hovered && zoneRect(workArea(monitor),
                LAYOUTS[hovered[0]][hovered[1]], this._settings.get_int('gap'))));
        this._backdrop.add_child(this._picker.actor);

        // Under the window's top-right corner, where Windows shows it from the maximize button.
        const frame = win.get_frame_rect();
        const [, natW] = this._picker.actor.get_preferred_width(-1);
        const [, natH] = this._picker.actor.get_preferred_height(natW);
        const x = Math.max(geo.x + 8, Math.min(frame.x + frame.width - natW - 24, geo.x + geo.width - natW - 8));
        const y = Math.max(geo.y + 8, Math.min(frame.y + 48, geo.y + geo.height - natH - 8));
        this._picker.actor.set_position(x - geo.x, y - geo.y);
        this._appear(this._picker.actor);

        this._grab = Main.pushModal(this._backdrop);
        this._backdrop.grab_key_focus();
    }

    _closePicker() {
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._picker?.destroy();
        this._picker = null;
        this._backdrop?.destroy();
        this._backdrop = null;
        this._showPreview(null);
    }

    _appear(actor) {
        actor.opacity = 0;
        actor.translation_y = -8;
        actor.ease({opacity: 255, translation_y: 0, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _showPreview(rect) {
        const p = this._preview;
        if (!rect) {
            p.ease({opacity: 0, duration: 120, onComplete: () => (p.visible = false)});
            return;
        }
        Main.layoutManager.uiGroup.set_child_below_sibling(p, this._backdrop ?? this._strip?.actor ?? null);
        if (!p.visible) {
            p.set_position(rect.x, rect.y);
            p.set_size(rect.width, rect.height);
            p.visible = true;
        }
        p.ease({
            x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: 255,
            duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // ---------- Snap layouts by dragging to the top ----------

    _dragBegin(win, op) {
        if (op !== Meta.GrabOp.MOVING && op !== Meta.GrabOp.MOVING_UNCONSTRAINED)
            return;
        if (!win || win.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        // Dragged out of a tile: it is a free window again.
        if (this._tiles.get(win)?.state)
            this._tiles.delete(win);
        this._dragWin = win;
        this._dragZone = null;
        this._dragTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            this._dragTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _dragTick() {
        const [x, y] = global.get_pointer();
        const monitor = global.display.get_current_monitor();
        const geo = Main.layoutManager.monitors[monitor];
        if (!this._strip && y - geo.y < TOP_BAND) {
            this._strip = new Picker(monitor, () => {}, () => {});
            this._strip.monitor = monitor;
            Main.layoutManager.uiGroup.add_child(this._strip.actor);
            const [, natW] = this._strip.actor.get_preferred_width(-1);
            this._strip.actor.set_position(Math.round(geo.x + (geo.width - natW) / 2), geo.y + TOP_BAND + 6);
            this._appear(this._strip.actor);
        }
        if (!this._strip)
            return;
        const [, sy] = this._strip.actor.get_transformed_position();
        const [, sh] = this._strip.actor.get_transformed_size();
        if (y > sy + sh + 80) {
            this._closeStrip();
            return;
        }
        const zone = this._strip.zoneAt(x, y);
        const key = zone ? `${zone.li}:${zone.zi}` : null;
        if (key === this._dragZoneKey)
            return;
        this._dragZoneKey = key;
        this._dragZone = zone;
        this._showPreview(zone && zoneRect(workArea(this._strip.monitor),
            LAYOUTS[zone.li][zone.zi], this._settings.get_int('gap')));
    }

    _closeStrip() {
        this._strip?.destroy();
        this._strip = null;
        this._dragZone = null;
        this._dragZoneKey = null;
        this._showPreview(null);
    }

    _dragEnd(win, _op) {
        if (!this._dragTimer)
            return;
        GLib.source_remove(this._dragTimer);
        this._dragTimer = null;
        const zone = this._dragZone;
        const target = this._dragWin;
        this._dragWin = null;
        this._closeStrip();
        if (!zone || target !== win)
            return;
        // Mutter may have maximized it at the top edge first; snap after that settles.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._snapInto(win, zone.li, zone.zi);
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---------- Snap assist ----------

    _snapInto(win, li, zi) {
        this._place(win, LAYOUTS[li][zi]);
        if (!this._settings.get_boolean('snap-assist'))
            return;
        const empty = LAYOUTS[li].map((_z, i) => i).filter(i => i !== zi);
        this._assist(win.get_monitor(), LAYOUTS[li], empty, [win]);
    }

    _candidates(monitor, placed) {
        const ws = global.workspace_manager.get_active_workspace();
        return global.display.get_tab_list(Meta.TabList.NORMAL, ws)
            .filter(w => !placed.includes(w) && w.get_monitor() === monitor && !w.minimized);
    }

    _assist(monitor, layout, empty, placed) {
        this._closeAssist();
        const candidates = this._candidates(monitor, placed);
        if (!empty.length || !candidates.length)
            return;
        const geo = Main.layoutManager.monitors[monitor];
        const gap = this._settings.get_int('gap');
        const r = zoneRect(workArea(monitor), layout[empty[0]], gap);

        this._assistBox = new St.Widget({
            style_class: 'gw-assist', reactive: true,
            x: geo.x, y: geo.y, width: geo.width, height: geo.height,
        });
        const close = () => this._closeAssist();
        this._assistBox.connect('button-press-event', () => {
            close();
            return Clutter.EVENT_STOP;
        });
        this._assistBox.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                close();
            return Clutter.EVENT_STOP;
        });

        const panel = new St.Widget({
            style_class: 'gw-assist-zone', reactive: true,
            x: r.x - geo.x, y: r.y - geo.y, width: r.width, height: r.height,
            layout_manager: new Clutter.BinLayout(),
        });
        panel.connect('button-press-event', () => Clutter.EVENT_STOP);
        chamferWidget(panel, CUT, PANEL_RADIUS);
        const scroll = new St.ScrollView({x_expand: true, y_expand: true});
        const flow = new St.Widget({
            layout_manager: new Clutter.FlowLayout({column_spacing: 10, row_spacing: 10, homogeneous: true}),
            x_expand: true,
        });
        const viewport = new St.Viewport({layout_manager: new Clutter.BinLayout()});
        viewport.add_child(flow);
        scroll.set_child(viewport);
        panel.add_child(scroll);

        const thumbW = Math.min(240, Math.max(140, (r.width - 60) / 2));
        for (const w of candidates)
            flow.add_child(this._thumb(w, thumbW, () => {
                this._place(w, layout[empty[0]]);
                this._assist(monitor, layout, empty.slice(1), [...placed, w]);
            }));

        this._assistBox.add_child(panel);
        Main.layoutManager.uiGroup.add_child(this._assistBox);
        this._appear(panel);
        this._assistGrab = Main.pushModal(this._assistBox);
        this._assistBox.grab_key_focus();
    }

    _thumb(win, width, onPick) {
        const button = new St.Button({style_class: 'gw-thumb', can_focus: true});
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gw-thumb-box'});
        const actor = win.get_compositor_private();
        const frame = win.get_frame_rect();
        const height = Math.round(width * 0.62);
        const scale = Math.min(width / frame.width, height / frame.height);
        const holder = new St.Widget({width, height, layout_manager: new Clutter.BinLayout()});
        if (actor) {
            const buffer = win.get_buffer_rect();
            const clone = new Clutter.Clone({source: actor, x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER});
            clone.set_size(buffer.width * scale, buffer.height * scale);
            holder.add_child(clone);
        }
        box.add_child(holder);
        box.add_child(new St.Label({text: win.get_title() ?? '', style_class: 'gw-thumb-title'}));
        button.set_child(box);
        button.connect('clicked', onPick);
        return button;
    }

    _closeAssist() {
        if (this._assistGrab) {
            Main.popModal(this._assistGrab);
            this._assistGrab = null;
        }
        this._assistBox?.destroy();
        this._assistBox = null;
    }

    destroy() {
        if (this._dragTimer)
            GLib.source_remove(this._dragTimer);
        this._closeStrip();
        this._closePicker();
        this._closeAssist();
        this._ids.forEach(id => global.display.disconnect(id));
        Main.wm.removeKeybinding('snap-layouts');
        for (const name of this._keys)
            Meta.keybindings_set_custom_handler(name, null);
        this._preview.destroy();
    }
}
