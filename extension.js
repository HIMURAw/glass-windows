import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Corners} from './corners.js';
import {Snap} from './snap.js';

export default class GlassWindowsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._snap = new Snap(this._settings);
        this._toggleCorners();
        this._cornersId = this._settings.connect('changed::corners', () => this._toggleCorners());
    }

    _toggleCorners() {
        this._corners?.destroy();
        this._corners = this._settings.get_boolean('corners') ? new Corners(this._settings) : null;
    }

    disable() {
        this._settings.disconnect(this._cornersId);
        this._corners?.destroy();
        this._corners = null;
        this._snap.destroy();
        this._snap = null;
        this._settings = null;
    }
}
