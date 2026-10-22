/* =====================================================================
   buttons.js · Magnet（磁吸跟随）+ SpecularButton（WebGL 高光描金按钮）
   原生移植 @react-bits/Magnet 与 @react-bits/SpecularButton，去 React 依赖。
   覆盖站内全部按钮（含动态注入的详情按钮），磁吸为多实例独占仲裁。
   ===================================================================== */
(function () {
  var smoothstep = function (edge0, edge1, value) {
    var t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  /* ================= Magnet · 磁吸跟随（多实例独占仲裁） ================= */
  var registry = new Set();
  var field = { pointer: null, owner: null };
  var detach = null;

  var reach = function (rect, pointer) {
    var dx = pointer.x - (rect.left + rect.width / 2);
    var dy = pointer.y - (rect.top + rect.height / 2);
    var outside = Math.hypot(Math.max(0, Math.abs(dx) - rect.width / 2), Math.max(0, Math.abs(dy) - rect.height / 2));
    return { dx: dx, dy: dy, outside: outside };
  };
  var arbitrate = function () {
    var winner = null, nearest = Infinity, closest = Infinity;
    registry.forEach(function (entry) {
      var s = entry.settings();
      var near = null;
      if (field.pointer && !s.disabled && !entry.reduce) {
        near = reach(entry.wrapper.getBoundingClientRect(), field.pointer);
        if (near.outside > s.padding) near = null;
      }
      if (s.exclusive === false) { if (near || entry.active) entry.wake(); return; }
      if (!near) return;
      var center = Math.hypot(near.dx, near.dy);
      if (near.outside < nearest || (near.outside === nearest && center < closest)) {
        winner = entry; nearest = near.outside; closest = center;
      }
    });
    var previous = field.owner;
    field.owner = winner;
    if (previous && previous !== winner) previous.wake();
    if (winner) winner.wake();
  };
  var attach = function () {
    var onMove = function (e) { if (e.pointerType === 'touch') return; field.pointer = { x: e.clientX, y: e.clientY }; arbitrate(); };
    var onLeave = function () { field.pointer = null; arbitrate(); };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', arbitrate, { passive: true, capture: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    return function () {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', arbitrate, { capture: true });
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  };

  function initMagnet(wrapper, inner, o) {
    if (!wrapper || !inner) return;
    o = o || {};
    var opts = {
      padding: Math.max(0, o.padding || 100),
      strength: Math.max(0.1, o.strength || 2),
      maxOffset: o.maxOffset,
      axis: o.axis || 'both',
      tilt: o.tilt || 0,
      scale: o.scale || 1,
      exclusive: o.exclusive !== false,
      stiffness: Math.max(1, o.stiffness || 170),
      damping: Math.max(0, o.damping || 16),
      mass: Math.max(0.01, o.mass || 1),
      disabled: !!o.disabled
    };
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var current = { x: 0, y: 0, tiltX: 0, tiltY: 0, scale: 1 };
    var velocity = { x: 0, y: 0, tiltX: 0, tiltY: 0, scale: 0 };
    var raf = 0, last = 0;

    var entry = { wrapper: wrapper, inner: inner, settings: function () { return opts; }, reduce: reduce, wake: function () {}, active: false };
    var solve = function (target, dt) {
      var resting = true;
      Object.keys(current).forEach(function (key) {
        var force = opts.stiffness * (target[key] - current[key]) - opts.damping * velocity[key];
        velocity[key] += (force / opts.mass) * dt;
        current[key] += velocity[key] * dt;
        var eps = key === 'scale' ? 0.001 : 0.05;
        if (Math.abs(target[key] - current[key]) > eps || Math.abs(velocity[key]) > eps) resting = false;
      });
      return resting;
    };
    var measure = function () {
      var target = { x: 0, y: 0, tiltX: 0, tiltY: 0, scale: 1 };
      if (reduce || !field.pointer || (opts.exclusive && field.owner !== entry)) return { target: target, engaged: false };
      var rect = wrapper.getBoundingClientRect();
      var r = reach(rect, field.pointer);
      if (r.outside > opts.padding) return { target: target, engaged: false };
      var pull = opts.padding > 0 ? 1 - smoothstep(opts.padding * 0.5, opts.padding, r.outside) : 1;
      var x = opts.axis === 'y' ? 0 : (r.dx / opts.strength) * pull;
      var y = opts.axis === 'x' ? 0 : (r.dy / opts.strength) * pull;
      if (opts.maxOffset !== undefined && opts.maxOffset !== null) {
        var len = Math.hypot(x, y);
        if (len > opts.maxOffset) { x *= opts.maxOffset / len; y *= opts.maxOffset / len; }
      }
      var nx = Math.max(-1, Math.min(1, r.dx / Math.max(rect.width / 2, 1)));
      var ny = Math.max(-1, Math.min(1, r.dy / Math.max(rect.height / 2, 1)));
      target.x = x; target.y = y;
      target.tiltX = -ny * opts.tilt * pull;
      target.tiltY = nx * opts.tilt * pull;
      target.scale = 1 + (opts.scale - 1) * pull;
      return { target: target, engaged: true };
    };
    var apply = function () {
      var turned = Math.abs(current.tiltX) > 0.01 || Math.abs(current.tiltY) > 0.01;
      var tf = 'translate3d(' + current.x.toFixed(2) + 'px, ' + current.y.toFixed(2) + 'px, 0)';
      if (turned) tf += ' perspective(800px) rotateX(' + current.tiltX.toFixed(2) + 'deg) rotateY(' + current.tiltY.toFixed(2) + 'deg)';
      if (Math.abs(current.scale - 1) > 0.0005) tf += ' scale(' + current.scale.toFixed(4) + ')';
      inner.style.transform = tf;
    };
    var frame = function (now) {
      raf = 0;
      var dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      var m = measure();
      if (m.engaged !== entry.active) {
        entry.active = m.engaged;
        if (m.engaged) wrapper.setAttribute('data-magnet-active', '');
        else wrapper.removeAttribute('data-magnet-active');
      }
      var steps = Math.ceil(dt / (1 / 120));
      var resting = true;
      for (var i = 0; i < steps; i++) resting = solve(m.target, dt / steps);
      if (resting) {
        Object.keys(current).forEach(function (key) { current[key] = m.target[key]; velocity[key] = 0; });
      }
      apply();
      if (!resting) raf = requestAnimationFrame(frame); else last = 0;
    };
    var wake = function () { if (!raf) raf = requestAnimationFrame(frame); };
    entry.wake = wake;
    registry.add(entry);
    if (!detach) detach = attach();
    return entry;
  }

  /* ================= SpecularButton · WebGL 高光描金按钮 ================= */
  var PAD = 24;
  var TAU = Math.PI * 2;
  var VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
  var FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uPx;
uniform float uSpot;
uniform vec2 uEntry;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform vec2 uWindow;
uniform float uThickness;
uniform float uGlow;
out vec4 outColor;
float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float loopPosition(vec2 p, vec2 b, float r) {
  vec2 inner = b - r;
  float arc = 1.5707963 * r;
  float quarter = inner.x + inner.y + arc;
  vec2 a = abs(p);
  vec2 q = a - inner;
  float s = q.x > 0.0 && q.y > 0.0
    ? inner.y + atan(q.y, q.x) * r
    : (q.x > q.y ? min(a.y, inner.y) : inner.y + arc + inner.x - min(a.x, inner.x));
  if (p.x < 0.0) s = p.y >= 0.0 ? 2.0 * quarter - s : 2.0 * quarter + s;
  else if (p.y < 0.0) s = 4.0 * quarter - s;
  return s / max(4.0 * quarter, 0.0001);
}
float lobe(float position, float center) {
  float gap = abs(fract(position - center + 0.5) - 0.5);
  return 1.0 - smoothstep(uWindow.x, uWindow.x + uWindow.y, gap);
}
void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = roundedBox(p, uHalf, uRadius);
  float position = loopPosition(p, uHalf, uRadius);
  float key = lobe(position, uSpot);
  float back = lobe(position, uSpot + 0.5);
  float streak = key + back * 0.45;
  float width = max(uThickness * uPx * mix(1.0, max(key, back), 0.6), 0.35);
  float band = smoothstep(-width - 0.6, -width + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float hair = smoothstep(-uPx - 0.6, -uPx + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float inside = 1.0 - smoothstep(-0.6, 0.6, d);
  vec2 pool = (p - uEntry) / (uHalf.y * vec2(1.6, 1.1));
  float glow = streak * 0.2 * exp(-abs(d + width * 0.5) / (5.0 * uPx)) + inside * 0.08 * exp(-dot(pool, pool));
  float light = clamp((band * streak + glow * uGlow) * uIntensity, 0.0, 1.0);
  vec4 base = vec4(uBaseColor, 1.0) * hair * 0.6;
  outColor = vec4(uLineColor, 1.0) * light + base * (1.0 - light);
}`;
  var UNIFORMS = ['uCenter', 'uHalf', 'uRadius', 'uPx', 'uSpot', 'uEntry', 'uLineColor', 'uBaseColor', 'uIntensity', 'uWindow', 'uThickness', 'uGlow'];

  var clamp = function (v, a, b) { return Math.min(Math.max(v, a), b); };
  var wrap = function (v) { return v - Math.floor(v); };
  var loopPosition = function (x, y, halfX, halfY, r) {
    var innerX = halfX - r, innerY = halfY - r;
    var arc = (Math.PI / 2) * r;
    var quarter = innerX + innerY + arc;
    var ax = Math.abs(x), ay = Math.abs(y);
    var qx = ax - innerX, qy = ay - innerY;
    var s;
    if (qx > 0 && qy > 0) s = innerY + Math.atan2(qy, qx) * r;
    else if (qx > qy) s = Math.min(ay, innerY);
    else s = innerY + arc + innerX - Math.min(ax, innerX);
    if (x < 0) s = y >= 0 ? 2 * quarter - s : 2 * quarter + s;
    else if (y < 0) s = 4 * quarter - s;
    return wrap(s / Math.max(4 * quarter, 0.0001));
  };
  var rimPoint = function (position, halfX, halfY, r) {
    var innerX = halfX - r, innerY = halfY - r;
    var arc = (Math.PI / 2) * r;
    var quarter = innerX + innerY + arc;
    var s = wrap(position) * 4 * quarter;
    var signX = 1, signY = 1;
    if (s > 3 * quarter) { s = 4 * quarter - s; signY = -1; }
    else if (s > 2 * quarter) { s -= 2 * quarter; signX = -1; signY = -1; }
    else if (s > quarter) { s = 2 * quarter - s; signX = -1; }
    var x = innerX - (s - innerY - arc);
    var y = halfY;
    if (s <= innerY) { x = halfX; y = s; }
    else if (s <= innerY + arc) {
      var angle = (s - innerY) / Math.max(r, 0.0001);
      x = innerX + Math.cos(angle) * r;
      y = innerY + Math.sin(angle) * r;
    }
    return [x * signX, y * signY];
  };
  var compile = function (gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };
  var link = function (gl) {
    var vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    var fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    var program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
    gl.deleteProgram(program);
    return null;
  };

  function initSpecular(button, o) {
    if (!button || button.querySelector('.sb-light')) return;
    o = o || {};
    var canvas = document.createElement('canvas');
    canvas.className = 'sb-light';
    canvas.setAttribute('aria-hidden', 'true');
    button.appendChild(canvas);
    var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) { if (canvas.parentNode) canvas.parentNode.removeChild(canvas); return; }
    var program = link(gl);
    if (!program) { if (canvas.parentNode) canvas.parentNode.removeChild(canvas); return; }
    var uniforms = {};
    for (var i = 0; i < UNIFORMS.length; i++) uniforms[UNIFORMS[i]] = gl.getUniformLocation(program, UNIFORMS[i]);
    var buffer = gl.createBuffer();
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    var probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var colors = new Map();
    var view = { width: 1, height: 1, ratio: 1 };
    var pointer = { x: 0, y: 0, known: false };
    var state = { spot: 0, level: 0, press: 0, ready: false };
    var raf = 0, last = 0, visible = true;

    var S = {
      radius: Math.max(0, o.radius || 18),
      lineColor: o.lineColor || '#c9a14a',
      baseColor: o.baseColor || '#221a12',
      intensity: Math.max(0, o.intensity || 1),
      idleIntensity: clamp(o.idleIntensity || 0.4, 0, 1),
      shineSize: Math.max(0, o.shineSize || 12),
      shineFade: Math.max(0, o.shineFade || 34),
      thickness: Math.max(0, o.thickness || 1.3),
      glow: Math.max(0, o.glow || 1.2),
      speed: o.speed || 0.35,
      followMouse: o.followMouse !== false,
      proximity: Math.max(1, o.proximity || 250),
      autoAnimate: !!o.autoAnimate,
      disabled: !!o.disabled
    };
    var toRgb = function (value) {
      if (colors.has(value)) return colors.get(value);
      var rgb = [1, 1, 1];
      if (probe) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = '#000000';
        probe.fillStyle = value;
        probe.fillRect(0, 0, 1, 1);
        var d = probe.getImageData(0, 0, 1, 1).data;
        rgb = [d[0] / 255, d[1] / 255, d[2] / 255];
      }
      colors.set(value, rgb);
      return rgb;
    };
    var cornerRadius = function (s) { return Math.min(s.radius, view.width / 2, view.height / 2); };
    var restSpot = function (s) {
      var r = cornerRadius(s);
      var inset = r * (1 - Math.SQRT1_2);
      return loopPosition(inset - view.width / 2, view.height / 2 - inset, view.width / 2, view.height / 2, r);
    };
    var aim = function (s) {
      if (!s.followMouse || s.disabled || !pointer.known) return null;
      var rect = button.getBoundingClientRect();
      var scale = rect.width / view.width || 1;
      var halfX = view.width / 2, halfY = view.height / 2;
      var x = (pointer.x - rect.left - rect.width / 2) / scale;
      var y = (rect.top + rect.height / 2 - pointer.y) / scale;
      var distance = Math.hypot(Math.max(Math.abs(x) - halfX, 0), Math.max(Math.abs(y) - halfY, 0));
      var t = clamp(1 - distance / s.proximity, 0, 1);
      var near = t * t * (3 - 2 * t);
      var nearest = loopPosition(x, y, halfX, halfY, cornerRadius(s));
      if (distance > 0) return { spot: nearest, near: near };
      var depth = clamp(Math.min(halfX - Math.abs(x), halfY - Math.abs(y)) / (halfY * 0.8), 0, 1);
      var sway = restSpot(s) - (x / halfX) * 0.06 - (y / halfY) * 0.02;
      var offset = sway - nearest - Math.round(sway - nearest);
      return { spot: wrap(nearest + offset * depth * depth * (3 - 2 * depth)), near: near };
    };
    var draw = function (s) {
      var scaleX = canvas.width / (view.width + PAD * 2);
      var scaleY = canvas.height / (view.height + PAD * 2);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uniforms.uCenter, (PAD + view.width / 2) * scaleX, (PAD + view.height / 2) * scaleY);
      gl.uniform2f(uniforms.uHalf, (view.width / 2) * scaleX, (view.height / 2) * scaleY);
      gl.uniform1f(uniforms.uRadius, Math.min(s.radius, view.width / 2, view.height / 2) * scaleX);
      gl.uniform1f(uniforms.uPx, view.ratio);
      var r = Math.min(s.radius, view.width / 2, view.height / 2);
      var rim = rimPoint(state.spot, view.width / 2, view.height / 2, r);
      var pull = 1 - Math.min(0.35 * (view.height / 2), Math.hypot(rim[0], rim[1])) / Math.max(Math.hypot(rim[0], rim[1]), 0.0001);
      gl.uniform1f(uniforms.uSpot, state.spot);
      gl.uniform2f(uniforms.uEntry, rim[0] * pull * scaleX, rim[1] * pull * scaleY);
      gl.uniform3fv(uniforms.uLineColor, toRgb(s.lineColor));
      gl.uniform3fv(uniforms.uBaseColor, toRgb(s.baseColor));
      gl.uniform1f(uniforms.uIntensity, s.intensity * (state.level + state.press * 0.8));
      gl.uniform2f(uniforms.uWindow, s.shineSize / 360 + state.press * 0.06, s.shineFade / 360 + 0.0001);
      gl.uniform1f(uniforms.uThickness, s.thickness);
      gl.uniform1f(uniforms.uGlow, s.glow);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    };
    var frame = function (now) {
      raf = 0;
      if (!visible) return;
      var s = S;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      var target = aim(s);
      var spinning = s.autoAnimate && !reduce;
      var steering = !!target && target.near > 0;
      if (!state.ready) {
        state.spot = restSpot(s);
        state.level = s.autoAnimate ? 1 : s.idleIntensity;
        state.ready = true;
      }
      var diff = 0;
      if (spinning && !steering) state.spot = wrap(state.spot + (s.speed / TAU) * dt);
      else {
        diff = (steering ? target.spot : restSpot(s)) - state.spot;
        diff -= Math.round(diff);
        state.spot = wrap(state.spot + diff * (1 - Math.exp(-dt * 8)));
      }
      var level = s.autoAnimate ? 1 : s.idleIntensity + (1 - s.idleIntensity) * (target ? target.near : 0);
      state.level += (level - state.level) * (1 - Math.exp(-dt * 7));
      state.press *= Math.exp(-dt * 5);
      draw(s);
      var settling = Math.abs(diff) > 0.0002 || Math.abs(level - state.level) > 0.001 || state.press > 0.002;
      if (settling || (spinning && !steering)) raf = requestAnimationFrame(frame); else last = 0;
    };
    var wake = function () { if (!raf && visible) raf = requestAnimationFrame(frame); };
    var measure = function (entry) {
      var box = entry && entry.borderBoxSize && entry.borderBoxSize[0];
      view.width = Math.max(1, box ? box.inlineSize : button.offsetWidth);
      view.height = Math.max(1, box ? box.blockSize : button.offsetHeight);
      view.ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.max(1, Math.round((view.width + PAD * 2) * view.ratio));
      canvas.height = Math.max(1, Math.round((view.height + PAD * 2) * view.ratio));
      if (state.ready) draw(S);
      wake();
    };
    var onPointerMove = function (e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.known = true; wake(); };
    var onPointerDown = function (e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.known = true; if (!S.disabled) state.press = 1; wake(); };
    var onPointerLeave = function () { pointer.known = false; wake(); };
    var resizeObserver = new ResizeObserver(function (entries) { measure(entries[entries.length - 1]); });
    resizeObserver.observe(button);
    var io = new IntersectionObserver(function (entries) {
      visible = entries.some(function (en) { return en.isIntersecting; });
      if (visible) { last = 0; wake(); }
    });
    io.observe(button);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave);
    button.addEventListener('pointerdown', onPointerDown);
    measure();
  }

  /* ================= 覆盖全部按钮（含动态注入） ================= */
  var SPEC_OPTS = function (btn) {
    var small = btn.classList.contains('btn--sm');
    return {
      radius: small ? 6 : 10,
      lineColor: '#d8b25e',
      baseColor: '#1d1711',
      intensity: 1,
      idleIntensity: 0.38,
      shineSize: 12,
      shineFade: 34,
      thickness: small ? 1.2 : 1.4,
      glow: small ? 1.0 : 1.3,
      followMouse: true,
      proximity: small ? 180 : 250,
      speed: 0.35
    };
  };
  var MAGNET_OPTS = function (btn) {
    var small = btn.classList.contains('btn--sm');
    return { padding: small ? 70 : 110, strength: 2, tilt: small ? 3 : 4, scale: 1.02 };
  };
  var applyTo = function (btn) {
    if (!btn || btn.nodeName !== 'BUTTON' || btn.getAttribute('data-sb')) return;
    btn.setAttribute('data-sb', '1');
    btn.classList.add('sb');
    var pos = getComputedStyle(btn).position;
    if (pos === 'static' || pos === '') btn.style.position = 'relative';
    if (!btn.querySelector('.sb-label')) {
      var wrap = document.createElement('span');
      wrap.className = 'sb-label';
      while (btn.firstChild) wrap.appendChild(btn.firstChild);
      btn.appendChild(wrap);
    }
    var parent = btn.parentNode;
    var wrapper = null;
    if (parent && parent.classList && parent.classList.contains('magnet')) wrapper = parent;
    if (!wrapper && pos !== 'fixed' && pos !== 'absolute') {
      wrapper = document.createElement('span');
      wrapper.className = 'magnet';
      parent.insertBefore(wrapper, btn);
      wrapper.appendChild(btn);
    }
    initSpecular(btn, SPEC_OPTS(btn));
    initMagnet(wrapper || btn, btn, MAGNET_OPTS(btn));
  };

  function boot() {
    var list = document.querySelectorAll('button');
    for (var i = 0; i < list.length; i++) applyTo(list[i]);
    /* 详情按钮由 JS 动态注入，用观察器自动应用 */
    var mo = new MutationObserver(function (mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var nodes = mutations[m].addedNodes;
        for (var n = 0; n < nodes.length; n++) {
          var node = nodes[n];
          if (!node || node.nodeType !== 1) continue;
          if (node.nodeName === 'BUTTON') applyTo(node);
          else {
            var inner = node.querySelectorAll('button');
            for (var k = 0; k < inner.length; k++) applyTo(inner[k]);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
