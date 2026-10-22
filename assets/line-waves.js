/* ============================================================
   LineWaves — 描金丝绢波线（原生 WebGL2 移植，无 React 依赖）
   用途：乐器介绍界面背景动效，贴合网站国风描金视觉。
   属性由 HTML 容器上的 data-lw-* 提供，默认描金三阶渐变、低透明。
   ============================================================ */
(function () {
  'use strict';

  var PIXEL_BUDGET = 2.4e6;
  var MAX_RIPPLES = 4;

  var VERTEX = [
    '#version 300 es',
    'const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));',
    'void main() {',
    '  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAGMENT = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2 uResolution;',
    'uniform float uPixel;',
    'uniform float uTime;',
    'uniform float uLines;',
    'uniform float uWidth;',
    'uniform float uGlow;',
    'uniform float uBrightness;',
    'uniform float uHighlight;',
    'uniform float uHighlightWidth;',
    'uniform float uWarp;',
    'uniform float uScale;',
    'uniform float uRotation;',
    'uniform vec3 uColor1;',
    'uniform vec3 uColor2;',
    'uniform vec3 uColor3;',
    'uniform float uCycle;',
    'uniform float uEdge;',
    'uniform vec4 uMouse;',
    'uniform vec4 uRipples[' + MAX_RIPPLES + '];',
    'uniform float uReveal;',
    'uniform float uLight;',
    'uniform float uOpacity;',
    'out vec4 fragColor;',
    'vec2 rotate(vec2 p, float a) {',
    '  float c = cos(a);',
    '  float s = sin(a);',
    '  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);',
    '}',
    'float hash(vec2 p) {',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    'float noise(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = p - i;',
    '  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), w.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), w.x), w.y);',
    '}',
    'float smootherstep(float edge0, float edge1, float x) {',
    '  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);',
    '  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);',
    '}',
    'float bend(vec2 p, float t) {',
    '  vec2 q = p * 2.0 / uScale;',
    '  float w = 0.6 * sin(q.x * 0.55 + t * 0.4 + 0.6 * sin(q.y * 0.9 - t * 0.28));',
    '  w += 0.21 * sin(q.x * 1.3 - t * 0.33 + q.y * 0.8 + 1.3);',
    '  w += 0.12 * sin(q.y * 2.3 + q.x * 0.9 - t * 0.37 + 0.4);',
    '  return w * uWarp * uScale * 0.46;',
    '}',
    'float river(vec2 p, float y, float t) {',
    '  float drift = 0.7 * (0.18 * sin(p.x * 1.6 - t * 0.33 + 0.7) + 0.1 * sin(p.x * 3.1 + t * 0.21));',
    '  float center = 0.5 * (0.2 * sin(t * 0.17) + 0.08 * sin(t * 0.29 + 1.3));',
    '  float width = 0.13 * uHighlightWidth;',
    '  float near = (y - center - drift) / width;',
    '  float far = (y + 0.22 * sin(t * 0.13 + 2.0) - drift * 0.6 + 0.3) / (width * 0.55);',
    '  return max(exp(-near * near), exp(-far * far) * 0.7);',
    '}',
    'vec3 palette(float x) {',
    '  x = fract(x) * 3.0;',
    '  if (x < 1.0) return mix(uColor1, uColor2, smoothstep(0.0, 1.0, x));',
    '  if (x < 2.0) return mix(uColor2, uColor3, smoothstep(1.0, 2.0, x));',
    '  return mix(uColor3, uColor1, smoothstep(2.0, 3.0, x));',
    '}',
    'void main() {',
    '  float aspect = uResolution.x / uResolution.y;',
    '  vec2 uv = gl_FragCoord.xy / uResolution;',
    '  vec2 p = rotate((gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y, uRotation);',
    '  float t = uTime;',
    '  vec2 mouse = rotate(uMouse.xy, uRotation);',
    '  vec2 toMouse = p - mouse;',
    '  float lens = exp(-dot(toMouse, toMouse) / (uMouse.w * uMouse.w));',
    '  p.y -= (p.y - mouse.y) * lens * uMouse.z;',
    '  float ring = 0.0;',
    '  for (int i = 0; i < ' + MAX_RIPPLES + '; i++) {',
    '    vec4 ripple = uRipples[i];',
    '    if (ripple.w <= 0.0) continue;',
    '    float x = (length(p - rotate(ripple.xy, uRotation)) - ripple.z * 0.6) / 0.08;',
    '    float fade = exp(-ripple.z * 1.3) * smoothstep(0.0, 0.12, ripple.z);',
    '    float bump = exp(-x * x);',
    '    p.y -= x * bump * 0.07 * fade;',
    '    ring += bump * fade;',
    '  }',
    '  float w = bend(p, t);',
    '  float y = p.y + w;',
    '  float phi = y * uLines;',
    '  float fw = max(fwidth(phi), 1e-5);',
    '  float crowd = smoothstep(0.18, 0.5, fw);',
    '  float fold = smoothstep(1.3, 2.2, fw * uResolution.y / uLines);',
    '  float shimmer = mix(1.0, smoothstep(0.15, 0.85, noise(vec2(y * 1.6 + t * 0.07, p.x * 0.55 - t * 0.22))), 0.5);',
    '  float lit = max(river(p, y, t), fold * 0.9) * shimmer;',
    '  float light = mix(1.0, 0.07 + 0.93 * lit, uHighlight);',
    '  light += (1.0 - light) * min(lens * step(0.0001, uMouse.z) * 0.9 + ring * 0.6, 1.0);',
    '  float dist = abs(fract(phi + 0.5) - 0.5) / fw;',
    '  float width = uWidth * uPixel * (1.0 + mix(1.5, 0.6, uLight) * lit * uHighlight);',
    '  float cover = clamp(min(dist + width * 0.5, 0.5) - max(dist - width * 0.5, -0.5), 0.0, 1.0);',
    '  cover = mix(cover, min(width * fw, 1.0), crowd);',
    '  float halo = exp(-dist / (2.2 * uPixel)) * (1.0 - crowd) * uGlow;',
    '  float thread = mix(1.0, 0.55 + 0.45 * hash(vec2(floor(phi + 0.5), 7.3)), 0.45 * (1.0 - crowd));',
    '  float span = 0.5 * sqrt(aspect * aspect + 1.0);',
    '  float sweep = -span + (2.0 * span + 0.6) * uReveal;',
    '  float reveal = 1.0 - smoothstep(sweep - 0.6, sweep, p.x);',
    '  float edge = 1.0;',
    '  if (uEdge > 0.0) {',
    '    float ex = min(uv.x, 1.0 - uv.x) * aspect;',
    '    float ey = min(uv.y, 1.0 - uv.y);',
    '    edge = smootherstep(0.0, uEdge * 0.5, ex) * smootherstep(0.0, uEdge * 0.5, ey);',
    '  }',
    '  vec3 tint = palette(y * 0.3 + p.x * 0.2 + uCycle);',
    '  float grain = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;',
    '  if (uLight > 0.5) {',
    '    float low = min(tint.r, min(tint.g, tint.b));',
    '    float chroma = max(tint.r, max(tint.g, tint.b)) - low;',
    '    vec3 hue = (tint - low) / max(chroma, 1e-3);',
    '    vec3 ink = mix(vec3(0.08), hue * 0.56 + 0.06, smoothstep(0.04, 0.2, chroma));',
    '    float alpha = (cover + halo * 0.35) * thread * light * uBrightness * reveal * edge * 0.78 * uOpacity;',
    '    alpha = clamp(alpha + grain, 0.0, 1.0);',
    '    fragColor = vec4(ink * alpha, alpha);',
    '    return;',
    '  }',
    '  float strength = (cover + halo) * thread * light * uBrightness * reveal * edge;',
    '  vec3 color = clamp(tint * strength * uOpacity, 0.0, 1.0);',
    '  float alpha = max(color.r, max(color.g, color.b));',
    '  color = clamp(color + grain, 0.0, 1.0);',
    '  fragColor = vec4(min(color, vec3(alpha)), alpha);',
    '}'
  ].join('\n');

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function parseColor(value) {
    var text = String(value || '').trim();
    var hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (hex) {
      var full = hex[1].length === 3 ? hex[1].replace(/./g, function (d) { return d + d; }) : hex[1];
      return [0, 2, 4].map(function (i) { return parseInt(full.slice(i, i + 2), 16) / 255; });
    }
    var rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    if (rgb) return [rgb[1], rgb[2], rgb[3]].map(function (c) { return clamp(parseFloat(c) / 255, 0, 1); });
    return [1, 1, 1];
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function link(gl) {
    var vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    var fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    var program = vertex && fragment ? gl.createProgram() : null;
    if (!vertex || !fragment || !program) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    var uniforms = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
    }
    return { program: program, uniforms: uniforms };
  }

  function readOpts(container) {
    var d = function (key, fallback) {
      var v = container.getAttribute('data-lw-' + key);
      return v === null || v === '' ? fallback : v;
    };
    return {
      color1: d('color1', '#dcb46e'),
      color2: d('color2', '#c9a961'),
      color3: d('color3', '#9c7f3f'),
      colorCycleSpeed: parseFloat(d('colorCycleSpeed', 1)),
      speed: parseFloat(d('speed', 0.3)),
      lineCount: parseFloat(d('lineCount', 72)),
      lineWidth: parseFloat(d('lineWidth', 1.3)),
      glow: parseFloat(d('glow', 0.6)),
      brightness: parseFloat(d('brightness', 1)),
      highlight: parseFloat(d('highlight', 1)),
      highlightWidth: parseFloat(d('highlightWidth', 1)),
      warpIntensity: parseFloat(d('warpIntensity', 1)),
      warpScale: parseFloat(d('warpScale', 1)),
      rotation: parseFloat(d('rotation', -33)),
      edgeFade: parseFloat(d('edgeFade', 0)),
      enableMouseInteraction: d('mouse', 'true') !== 'false',
      mouseInfluence: parseFloat(d('mouseInfluence', 2)),
      clickRipple: d('clickRipple', 'false') === 'true',
      intro: d('intro', 'true') !== 'false',
      lightMode: d('lightMode', 'false') === 'true',
      opacity: parseFloat(d('opacity', 0.4)),
      maxDevicePixelRatio: parseFloat(d('maxRatio', 2))
    };
  }

  function initLineWaves(container) {
    var old = container.querySelector('.line-waves__canvas');
    if (old) old.parentNode.removeChild(old);

    var canvas = document.createElement('canvas');
    canvas.className = 'line-waves__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    var gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance'
    });
    var shader = gl ? link(gl) : null;
    if (!gl || !shader) return;

    var o = readOpts(container);
    var settings = {
      colors: [parseColor(o.color1), parseColor(o.color2), parseColor(o.color3)],
      cycleSpeed: o.colorCycleSpeed,
      speed: Math.max(0, o.speed),
      lines: clamp(o.lineCount, 2, 400),
      width: clamp(o.lineWidth, 0.25, 12),
      glow: Math.max(0, o.glow),
      brightness: Math.max(0, o.brightness),
      highlight: clamp(o.highlight, 0, 1),
      highlightWidth: clamp(o.highlightWidth, 0.2, 5),
      warp: clamp(o.warpIntensity, 0, 3),
      scale: clamp(o.warpScale, 0.2, 4),
      rotation: (o.rotation * Math.PI) / 180,
      edge: clamp(o.edgeFade, 0, 1),
      mouse: o.enableMouseInteraction,
      influence: clamp(o.mouseInfluence, 0, 3),
      clickRipple: o.clickRipple,
      intro: o.intro,
      light: o.lightMode,
      opacity: clamp(o.opacity, 0, 1),
      maxRatio: clamp(o.maxDevicePixelRatio, 0.5, 3)
    };

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var vao = gl.createVertexArray();
    var size = { width: 1, height: 1, ratio: 1 };
    var pointer = { x: 0, y: 0, inside: false };
    var lens = { x: 0, y: 0, presence: 0, ready: false };
    var ripples = [];
    var rippleData = new Float32Array(MAX_RIPPLES * 4);
    var time = Math.random() * 60;
    var cycle = 0;
    var reveal = settings.intro && !reduced ? 0 : 1;
    var raf = 0;
    var last = 0;
    var visible = true;
    var pageVisible = document.visibilityState !== 'hidden';
    var lost = false;

    function resize() {
      var rect = container.getBoundingClientRect();
      var cssWidth = Math.max(1, rect.width);
      var cssHeight = Math.max(1, rect.height);
      var ratio = Math.min(
        window.devicePixelRatio || 1,
        settings.maxRatio,
        Math.sqrt(PIXEL_BUDGET / (cssWidth * cssHeight))
      );
      var width = Math.max(1, Math.round(cssWidth * ratio));
      var height = Math.max(1, Math.round(cssHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      size.width = cssWidth;
      size.height = cssHeight;
      size.ratio = width / cssWidth;
    }

    function toField(x, y) {
      return [(x - size.width / 2) / size.height, (size.height / 2 - y) / size.height];
    }

    function frame(now) {
      raf = 0;
      if (lost) return;
      var s = settings;
      var dt = clamp((now - last) / 1000 || 0, 0, 0.05);
      last = Math.max(last, now);
      time += dt * s.speed * 2.5 * (reduced ? 0.25 : 1);
      cycle += dt * s.speed * s.cycleSpeed * 0.05;
      if (reveal < 1) reveal = Math.min(1, reveal + dt / 1.8);
      var tracking = s.mouse && pointer.inside && !reduced;
      if (tracking) {
        var tf = toField(pointer.x, pointer.y);
        if (!lens.ready) { lens.x = tf[0]; lens.y = tf[1]; lens.ready = true; }
        var follow = 1 - Math.exp(-dt * 10);
        lens.x += (tf[0] - lens.x) * follow;
        lens.y += (tf[1] - lens.y) * follow;
      }
      var presence = tracking ? 1 : 0;
      lens.presence += (presence - lens.presence) * (1 - Math.exp(-dt * 5));
      if (lens.presence < 0.002 && !tracking) lens.ready = false;
      for (var i = ripples.length - 1; i >= 0; i--) {
        ripples[i].age += dt;
        if (ripples[i].age > 2.6) ripples.splice(i, 1);
      }
      rippleData.fill(0);
      ripples.forEach(function (ripple, index) {
        rippleData[index * 4] = ripple.x;
        rippleData[index * 4 + 1] = ripple.y;
        rippleData[index * 4 + 2] = ripple.age;
        rippleData[index * 4 + 3] = 1;
      });
      var eased = 1 - Math.pow(1 - reveal, 3);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(shader.program);
      gl.bindVertexArray(vao);
      var u = shader.uniforms;
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform1f(u.uPixel, size.ratio);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uLines, s.lines);
      gl.uniform1f(u.uWidth, s.width);
      gl.uniform1f(u.uGlow, s.glow);
      gl.uniform1f(u.uBrightness, s.brightness);
      gl.uniform1f(u.uHighlight, s.highlight);
      gl.uniform1f(u.uHighlightWidth, s.highlightWidth);
      gl.uniform1f(u.uWarp, s.warp * (0.25 + 0.75 * eased));
      gl.uniform1f(u.uScale, s.scale);
      gl.uniform1f(u.uRotation, s.rotation);
      gl.uniform3f(u.uColor1, s.colors[0][0], s.colors[0][1], s.colors[0][2]);
      gl.uniform3f(u.uColor2, s.colors[1][0], s.colors[1][1], s.colors[1][2]);
      gl.uniform3f(u.uColor3, s.colors[2][0], s.colors[2][1], s.colors[2][2]);
      gl.uniform1f(u.uCycle, cycle);
      gl.uniform1f(u.uEdge, s.edge);
      gl.uniform4f(u.uMouse, lens.x, lens.y, lens.presence * s.influence * 0.16, 0.2);
      gl.uniform4fv(u.uRipples, rippleData);
      gl.uniform1f(u.uReveal, eased);
      gl.uniform1f(u.uLight, s.light ? 1 : 0);
      gl.uniform1f(u.uOpacity, s.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      var settling = Math.abs(presence - lens.presence) > 0.002;
      var busy = (s.speed > 0 && !reduced) || reveal < 1 || settling || ripples.length > 0 || tracking;
      if (busy && visible && pageVisible) raf = requestAnimationFrame(frame);
    }

    function wake() {
      if (raf || lost || !visible || !pageVisible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function locate(event) {
      var rect = container.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        inside: event.clientX >= rect.left && event.clientX <= rect.right &&
                event.clientY >= rect.top && event.clientY <= rect.bottom
      };
    }

    function onPointerMove(event) {
      var spot = locate(event);
      pointer.x = spot.x;
      pointer.y = spot.y;
      pointer.inside = spot.inside;
      wake();
    }

    function onPointerDown(event) {
      var spot = locate(event);
      if (!spot.inside || !settings.clickRipple || reduced) return;
      var tf = toField(spot.x, spot.y);
      ripples.push({ x: tf[0], y: tf[1], age: 0 });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
      wake();
    }

    function onLeave() {
      pointer.inside = false;
      wake();
    }

    function onPointerUp(event) {
      if (event.pointerType !== 'mouse') onLeave();
    }

    function onLost(event) {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
      raf = 0;
    }

    function onRestored() {
      initLineWaves(container);
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    var resizeObserver = new ResizeObserver(function () { resize(); wake(); });
    resizeObserver.observe(container);
    var intersection = new IntersectionObserver(function (entries) {
      visible = entries.some(function (entry) { return entry.isIntersecting; });
      wake();
    });
    intersection.observe(container);
    function onVisibility() {
      pageVisible = document.visibilityState !== 'hidden';
      wake();
    }
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    wake();
  }

  var hosts = document.querySelectorAll('[data-line-waves]');
  for (var i = 0; i < hosts.length; i++) initLineWaves(hosts[i]);
})();
