/* 乐器详情：绢本线波（移植自 LineWaves，原生 WebGL2，零依赖）
   叠在详情页背景古画之上、图文卡片之下。
   画卷/乐器切换时不重建 DOM、不重启上下文，只随视图显隐暂停帧循环。 */
(function () {
  'use strict';

  const host = document.getElementById('detailWaves');
  const canvas = document.getElementById('detailWavesCanvas');
  if (!host || !canvas) return;

  const PIXEL_BUDGET = 1.25e6;  // 全屏片元预算（原来 1.8e6，集显上和转场抢 GPU）
  const MAX_DPR = 1.25;         // 线波是慢速织纹，1.25 倍足够，省一半填充率
  const FPS = 40;               // 40fps 封顶：肉眼几乎无差，GPU 负载降三分之一
  const MAX_RIPPLES = 4;

  const VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`;

  const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uPixel;
uniform float uTime;
uniform float uLines;
uniform float uWidth;
uniform float uGlow;
uniform float uBrightness;
uniform float uHighlight;
uniform float uHighlightWidth;
uniform float uWarp;
uniform float uScale;
uniform float uRotation;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uCycle;
uniform float uEdge;
uniform vec4 uMouse;
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform float uReveal;
uniform float uLight;
uniform float uOpacity;
out vec4 fragColor;

vec2 rotate(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), w.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), w.x), w.y);
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float bend(vec2 p, float t) {
  vec2 q = p * 2.0 / uScale;
  float w = 0.6 * sin(q.x * 0.55 + t * 0.4 + 0.6 * sin(q.y * 0.9 - t * 0.28));
  w += 0.21 * sin(q.x * 1.3 - t * 0.33 + q.y * 0.8 + 1.3);
  w += 0.12 * sin(q.y * 2.3 + q.x * 0.9 - t * 0.37 + 0.4);
  return w * uWarp * uScale * 0.46;
}

float river(vec2 p, float y, float t) {
  float drift = 0.7 * (0.18 * sin(p.x * 1.6 - t * 0.33 + 0.7) + 0.1 * sin(p.x * 3.1 + t * 0.21));
  float center = 0.5 * (0.2 * sin(t * 0.17) + 0.08 * sin(t * 0.29 + 1.3));
  float width = 0.13 * uHighlightWidth;
  float near = (y - center - drift) / width;
  float far = (y + 0.22 * sin(t * 0.13 + 2.0) - drift * 0.6 + 0.3) / (width * 0.55);
  return max(exp(-near * near), exp(-far * far) * 0.7);
}

vec3 palette(float x) {
  x = fract(x) * 3.0;
  if (x < 1.0) return mix(uColor1, uColor2, smoothstep(0.0, 1.0, x));
  if (x < 2.0) return mix(uColor2, uColor3, smoothstep(1.0, 2.0, x));
  return mix(uColor3, uColor1, smoothstep(2.0, 3.0, x));
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = rotate((gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y, uRotation);
  float t = uTime;

  vec2 mouse = rotate(uMouse.xy, uRotation);
  vec2 toMouse = p - mouse;
  float lens = exp(-dot(toMouse, toMouse) / (uMouse.w * uMouse.w));
  p.y -= (p.y - mouse.y) * lens * uMouse.z;

  float ring = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 ripple = uRipples[i];
    if (ripple.w <= 0.0) continue;
    float x = (length(p - rotate(ripple.xy, uRotation)) - ripple.z * 0.6) / 0.08;
    float fade = exp(-ripple.z * 1.3) * smoothstep(0.0, 0.12, ripple.z);
    float bump = exp(-x * x);
    p.y -= x * bump * 0.07 * fade;
    ring += bump * fade;
  }

  float w = bend(p, t);
  float y = p.y + w;
  float phi = y * uLines;
  float fw = max(fwidth(phi), 1e-5);
  float crowd = smoothstep(0.18, 0.5, fw);

  float fold = smoothstep(1.3, 2.2, fw * uResolution.y / uLines);
  float shimmer = mix(1.0, smoothstep(0.15, 0.85, noise(vec2(y * 1.6 + t * 0.07, p.x * 0.55 - t * 0.22))), 0.5);
  float lit = max(river(p, y, t), fold * 0.9) * shimmer;
  float light = mix(1.0, 0.07 + 0.93 * lit, uHighlight);
  light += (1.0 - light) * min(lens * step(0.0001, uMouse.z) * 0.9 + ring * 0.6, 1.0);

  float dist = abs(fract(phi + 0.5) - 0.5) / fw;
  float width = uWidth * uPixel * (1.0 + mix(1.5, 0.6, uLight) * lit * uHighlight);
  float cover = clamp(min(dist + width * 0.5, 0.5) - max(dist - width * 0.5, -0.5), 0.0, 1.0);
  cover = mix(cover, min(width * fw, 1.0), crowd);
  float halo = exp(-dist / (2.2 * uPixel)) * (1.0 - crowd) * uGlow;
  float thread = mix(1.0, 0.55 + 0.45 * hash(vec2(floor(phi + 0.5), 7.3)), 0.45 * (1.0 - crowd));

  float span = 0.5 * sqrt(aspect * aspect + 1.0);
  float sweep = -span + (2.0 * span + 0.6) * uReveal;
  float reveal = 1.0 - smoothstep(sweep - 0.6, sweep, p.x);

  float edge = 1.0;
  if (uEdge > 0.0) {
    float ex = min(uv.x, 1.0 - uv.x) * aspect;
    float ey = min(uv.y, 1.0 - uv.y);
    edge = smootherstep(0.0, uEdge * 0.5, ex) * smootherstep(0.0, uEdge * 0.5, ey);
  }

  vec3 tint = palette(y * 0.3 + p.x * 0.2 + uCycle);
  float grain = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;

  if (uLight > 0.5) {
    float low = min(tint.r, min(tint.g, tint.b));
    float chroma = max(tint.r, max(tint.g, tint.b)) - low;
    /* 描金三阶：暗金落地防糊，描金为主，亮金只在流光/涟漪处一闪。
       用调色板色差驱动冷暖（偏赭 / 偏黄），色相始终锁在金域。 */
    vec3 deep = vec3(0.408, 0.294, 0.106);    // #684b1b 暗金
    vec3 gold = vec3(0.725, 0.549, 0.243);    // #b98c3e 描金
    vec3 bright = vec3(0.925, 0.796, 0.478);  // #eccb7a 亮金
    vec3 ink = mix(deep, gold, smoothstep(0.0, 0.42, chroma));
    ink = mix(ink, bright, smoothstep(0.30, 0.95, lit) * 0.82);
    float alpha = (cover + halo * 0.35) * thread * light * uBrightness * reveal * edge * 0.78 * uOpacity;
    alpha = clamp(alpha + grain, 0.0, 1.0);
    fragColor = vec4(ink * alpha, alpha);
    return;
  }

  float strength = (cover + halo) * thread * light * uBrightness * reveal * edge;
  vec3 color = clamp(tint * strength * uOpacity, 0.0, 1.0);
  float alpha = max(color.r, max(color.g, color.b));
  color = clamp(color + grain, 0.0, 1.0);
  fragColor = vec4(min(color, vec3(alpha)), alpha);
}`;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const parseColor = value => {
    const text = String(value || '').trim();
    const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
    if (hex) {
      const full = hex[1].length === 3 ? hex[1].replace(/./g, d => d + d) : hex[1];
      return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
    }
    return [0.5, 0.5, 0.5];
  };

  const compile = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const link = gl => {
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = vertex && fragment ? gl.createProgram() : null;
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
      gl.deleteProgram(program);
      return null;
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  };

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance'
  });
  if (!gl) { host.classList.add('is-off'); return; }
  let shader = link(gl);
  if (!shader) { host.classList.add('is-off'); return; }

  /* 三色取自绢本与矿物颜料，改为描金系：暗金、缃金、亮金。lightMode 用金线，
     落在米色绢底上像一层极淡的描金织纹，而不是抢画的白色霓虹。 */
  const S = {
    c1: parseColor('#684b1b'),
    c2: parseColor('#b98c3e'),
    c3: parseColor('#eccb7a'),
    cycleSpeed: 1,
    speed: 0.3,
    lines: 72,
    width: 1.3,
    glow: 0.45,
    brightness: 1,
    highlight: 0.75,
    highlightWidth: 1,
    warp: 1,
    scale: 1,
    rotation: (-33 * Math.PI) / 180,
    edge: 0.05,
    influence: 2,
    opacity: 0.95
  };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let vao = gl.createVertexArray();
  const size = { w: 1, h: 1, ratio: 1 };
  const pointer = { x: 0, y: 0, inside: false };
  const lens = { x: 0, y: 0, presence: 0, ready: false };
  const ripples = [];
  const rippleData = new Float32Array(MAX_RIPPLES * 4);

  let time = Math.random() * 60;
  let cycle = 0;
  let reveal = reduced ? 1 : 0;
  let raf = 0;
  let last = 0;
  let skips = 0;
  let visible = false;
  let pageVisible = document.visibilityState !== 'hidden';
  let lost = false;
  let pendingResize = true;
  let held = false;

  /* 上下文丢失后 program / VAO 全部作废，必须重建；不重建就会永远白屏（用户说的「背景被卡没」） */
  const rebuild = () => {
    if (!gl || gl.isContextLost()) return false;
    shader = link(gl);
    if (!shader) return false;
    vao = gl.createVertexArray();
    return true;
  };

  const applyResize = () => {
    const rect = host.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      MAX_DPR,
      Math.sqrt(PIXEL_BUDGET / (cssW * cssH))
    );
    const w = Math.max(1, Math.round(cssW * ratio));
    const h = Math.max(1, Math.round(cssH * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    size.w = cssW;
    size.h = cssH;
    size.ratio = w / cssW;
  };

  const toField = (x, y) => [(x - size.w / 2) / size.h, (size.h / 2 - y) / size.h];

  const frame = now => {
    raf = 0;
    if (held) return;
    if (pendingResize) {
      pendingResize = false;
      applyResize();
    }
    if (lost) return;
    // 帧率封顶：线波本来就慢，40fps 肉眼几乎无差，把 GPU 让给卡片转场。
    // 连续跳 4 帧后强制画一次，防止异常时钟下永远停帧。
    if (now - last < 1000 / FPS - 1.5 && ++skips < 4) { raf = requestAnimationFrame(frame); return; }
    skips = 0;
    const dt = clamp((now - last) / 1000 || 0, 0, 0.05);
    last = Math.max(last, now);
    time += dt * S.speed * 2.5 * (reduced ? 0.25 : 1);
    cycle += dt * S.speed * S.cycleSpeed * 0.05;
    if (reveal < 1) reveal = Math.min(1, reveal + dt / 1.8);

    const tracking = pointer.inside && !reduced;
    if (tracking) {
      const [x, y] = toField(pointer.x, pointer.y);
      if (!lens.ready) { lens.x = x; lens.y = y; lens.ready = true; }
      const follow = 1 - Math.exp(-dt * 10);
      lens.x += (x - lens.x) * follow;
      lens.y += (y - lens.y) * follow;
    }
    const presence = tracking ? 1 : 0;
    lens.presence += (presence - lens.presence) * (1 - Math.exp(-dt * 5));
    if (lens.presence < 0.002 && !tracking) lens.ready = false;

    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age > 2.6) ripples.splice(i, 1);
    }
    rippleData.fill(0);
    for (let i = 0; i < ripples.length; i++) {
      rippleData[i * 4] = ripples[i].x;
      rippleData[i * 4 + 1] = ripples[i].y;
      rippleData[i * 4 + 2] = ripples[i].age;
      rippleData[i * 4 + 3] = 1;
    }

    const eased = 1 - Math.pow(1 - reveal, 3);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(shader.program);
    gl.bindVertexArray(vao);
    const u = shader.uniforms;
    gl.uniform2f(u.uResolution, canvas.width, canvas.height);
    gl.uniform1f(u.uPixel, size.ratio);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uLines, S.lines);
    gl.uniform1f(u.uWidth, S.width);
    gl.uniform1f(u.uGlow, S.glow);
    gl.uniform1f(u.uBrightness, S.brightness);
    gl.uniform1f(u.uHighlight, S.highlight);
    gl.uniform1f(u.uHighlightWidth, S.highlightWidth);
    gl.uniform1f(u.uWarp, S.warp * (0.25 + 0.75 * eased));
    gl.uniform1f(u.uScale, S.scale);
    gl.uniform1f(u.uRotation, S.rotation);
    gl.uniform3f(u.uColor1, S.c1[0], S.c1[1], S.c1[2]);
    gl.uniform3f(u.uColor2, S.c2[0], S.c2[1], S.c2[2]);
    gl.uniform3f(u.uColor3, S.c3[0], S.c3[1], S.c3[2]);
    gl.uniform1f(u.uCycle, cycle);
    gl.uniform1f(u.uEdge, S.edge);
    gl.uniform4f(u.uMouse, lens.x, lens.y, lens.presence * S.influence * 0.16, 0.2);
    gl.uniform4fv(u.uRipples, rippleData);
    gl.uniform1f(u.uReveal, eased);
    gl.uniform1f(u.uLight, 1);
    gl.uniform1f(u.uOpacity, S.opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const settling = Math.abs(presence - lens.presence) > 0.002;
    const busy = (S.speed > 0 && !reduced) || reveal < 1 || settling || ripples.length > 0 || tracking;
    if (busy && visible && pageVisible && !held) raf = requestAnimationFrame(frame);
  };

  /* 视图从 display:none 切回来时 IntersectionObserver 的回调未必早于路由，
     所以这里按实际尺寸自证一次，避免「进入详情却停在首帧之前」。 */
  const isShown = () => {
    const r = host.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  const wake = () => {
    if (held || lost || !pageVisible) return;
    if (!visible) {
      if (!isShown()) return;
      visible = true;
      pendingResize = true;
    }
    // 尺寸先同步量好，首帧不必等 rAF：避免以默认 300×150 拉伸一帧再纠正
    if (pendingResize) {
      pendingResize = false;
      applyResize();
      // 改 canvas.width 会清空画布，把 last 推到过去，让下一帧立刻补画，不留空帧
      last = performance.now() - 1000;
    }
    if (raf) return;
    if (!last) last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  /* 转场期间：只停帧、不动画布。最后一帧仍作为纹理留在屏幕上，
     既不会露底、也不会和卡片重绘抢 GPU。 */
  const hold = () => {
    held = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  const release = () => {
    if (!held && raf) return;
    held = false;
    last = performance.now();
    wake();
  };

  const locate = e => {
    const rect = host.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      inside: rect.width > 1 && e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom
    };
  };

  window.addEventListener('pointermove', e => {
    if (!visible) return;
    const spot = locate(e);
    pointer.x = spot.x;
    pointer.y = spot.y;
    pointer.inside = spot.inside;
    if (spot.inside) wake();
  }, { passive: true });

  window.addEventListener('pointerdown', e => {
    if (!visible || reduced) return;
    const spot = locate(e);
    if (!spot.inside) return;
    const [x, y] = toField(spot.x, spot.y);
    ripples.push({ x: x, y: y, age: 0 });
    if (ripples.length > MAX_RIPPLES) ripples.shift();
    wake();
  }, { passive: true });

  document.documentElement.addEventListener('pointerleave', () => {
    pointer.inside = false;
    wake();
  });

  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    lost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }, false);

  canvas.addEventListener('webglcontextrestored', () => {
    // 旧 program / VAO 已随上下文作废，必须重建再唤醒，否则画布永远空白
    if (!rebuild()) { host.classList.add('is-off'); return; }
    lost = false;
    held = false;
    pendingResize = true;
    wake();
  }, false);

  new ResizeObserver(() => {
    pendingResize = true;
    wake();
  }).observe(host);

  new IntersectionObserver(entries => {
    visible = entries.some(en => en.isIntersecting);
    wake();
  }, { threshold: 0 }).observe(host);

  document.addEventListener('visibilitychange', () => {
    pageVisible = document.visibilityState !== 'hidden';
    wake();
  });

  /* 进入详情视图时主动唤醒：不依赖 IntersectionObserver 的回调时机 */
  window.__detailWaves = { wake: wake, hold: hold, release: release };

  if (document.readyState === 'complete') wake();
  else window.addEventListener('load', wake, { once: true });
})();
