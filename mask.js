import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

// GJS turns whole numbers into int GValues, which float uniforms ignore.
export const asFloat = v => (Number.isInteger(v) ? v + 1e-4 : v);

// Cuts a rectangle's corners at 45 degrees and draws a frame along the cut, the same shape
// as Dynamic Island and Glass Dock. `rect` is where the shape sits inside the actor
// (x, y, w, h in logical px); outside it pixels pass through untouched, so a window's
// shadow stays. The offscreen texture can be a little larger than the actor (its paint
// box rounded out): it is centred on the actor, not stretched over it.
const SHADER = `
uniform sampler2D tex;
uniform float actor_w;
uniform float actor_h;
uniform float tex_w;
uniform float tex_h;
uniform float rect_x;
uniform float rect_y;
uniform float rect_w;
uniform float rect_h;
uniform float cut;
uniform float frame_width;
uniform float frame_r;
uniform float frame_g;
uniform float frame_b;
uniform float frame_a;

void main(void) {
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 color = texture2D(tex, uv);
    vec2 tex_size = vec2(tex_w, tex_h);
    vec2 pos = uv * tex_size - (tex_size - vec2(actor_w, actor_h)) * 0.5;
    vec2 half_size = vec2(rect_w, rect_h) * 0.5;
    vec2 p = abs(pos - vec2(rect_x, rect_y) - half_size);
    if (p.x > half_size.x || p.y > half_size.y) {
        cogl_color_out = color;
        return;
    }
    vec2 d = p - half_size;
    float box = max(d.x, d.y);
    float c = (p.x + p.y - (half_size.x + half_size.y - cut)) * 0.70710678;
    float dist = max(box, c);
    float outer = clamp(0.5 - dist, 0.0, 1.0);
    // Inside the cut corner nothing of the window shows; the shadow there goes too.
    float inner = frame_width > 0.0 ? clamp(0.5 - (dist + frame_width), 0.0, 1.0) : outer;
    vec4 frame = vec4(frame_r, frame_g, frame_b, 1.0) * frame_a;
    vec4 over = frame + color * (1.0 - frame_a);
    cogl_color_out = color * inner + over * (outer - inner);
}`;

export const ChamferEffect = GObject.registerClass(
class ChamferEffect extends Clutter.ShaderEffect {
    _init() {
        super._init();
        this.set_shader_source(SHADER);
        this._vals = {};
    }

    _set(name, value) {
        if (this._vals[name] === value)
            return;
        this._vals[name] = value;
        this.set_uniform_value(name, asFloat(value));
    }

    // The shape inside the actor; for St widgets this is simply 0, 0, width, height.
    setShape(actorW, actorH, x, y, w, h, cut) {
        this._set('actor_w', actorW);
        this._set('actor_h', actorH);
        this._set('rect_x', x);
        this._set('rect_y', y);
        this._set('rect_w', w);
        this._set('rect_h', h);
        this._set('cut', cut);
    }

    // [r, g, b, a] 0..1 and its width in px; width 0 for none.
    setFrame(rgba, width) {
        this._set('frame_width', width);
        ['frame_r', 'frame_g', 'frame_b', 'frame_a'].forEach((n, i) => this._set(n, rgba[i]));
    }

    vfunc_paint_target(node, paintContext) {
        // In device pixels; the shape is in logical ones (fractional scaling).
        const [ok, dw, dh] = this.get_target_size();
        const scale = this.actor?.get_resource_scale?.() || 1;
        if (ok) {
            this._set('tex_w', dw / scale);
            this._set('tex_h', dh / scale);
        }
        super.vfunc_paint_target(node, paintContext);
    }
});

// Keeps an St widget cut to the shape at its full size; the frame colour comes from
// the stylesheet (-glass-frame-color, -glass-frame-width) so hover states can change it.
export function chamferWidget(actor, cut) {
    const effect = new ChamferEffect();
    const update = () => {
        const [w, h] = actor.get_size();
        effect.setShape(w, h, 0, 0, w, h, cut);
        const node = actor.get_theme_node?.();
        if (!node)
            return;
        const [ok, c] = node.lookup_color('-glass-frame-color', false);
        if (!ok) {
            effect.setFrame([0, 0, 0, 0], 0);
            return;
        }
        const ch = k => (typeof c[`get_${k}`] === 'function' ? c[`get_${k}`]() : c[k] / 255);
        const [hasWidth, width] = node.lookup_length('-glass-frame-width', false);
        effect.setFrame([ch('red'), ch('green'), ch('blue'), ch('alpha')], hasWidth ? width : 1);
    };
    actor.add_effect(effect);
    actor.connect('notify::size', update);
    actor.connect('style-changed', update);
    actor.connect('notify::mapped', update);
    update();
    return effect;
}
