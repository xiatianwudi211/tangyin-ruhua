/* ============================================================
   锦鲤群 · 中国鲤鱼 · 水墨国风背景（原生 Canvas 2D，无依赖）
   —— 移植自 ascii-sharks 海洋鱼群的精髓：
      ① Reynolds boids 于 Couzin 分区内游弋（127° 后方盲区）
      ② 无散度洋流让鱼群始终散布、不扎堆
      ③ 指针划过时驱散附近锦鲤
   渲染：低透明度的水墨锦鲤（朱红描金 / 白底粉晕 / 墨黑），
   小而疏，铺在乐器详情背景、垫于磨砂卡之后。
   ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('koiCanvas');
  if (!canvas || !canvas.parentElement) return;
  var host = canvas.parentElement;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  // —— 参数（小而疏、低透明，透明由外层 .detail-waves 控制） ——
  var DPR_CAP = 2;
  var COUNT = 28;               // 鱼再多一点（仍不显挤，靠洋流散布）
  var LEN = 32;                 // 鱼长约 32 CSS px，小而疏
  var SPEED_MIN = 30;
  var SPEED_MAX = 52;
  var RESPAWN_INTERVAL = 1.8;   // 周期性从边缘"游出"一条，提升出现频率
  // Couzin 分区半径
  var SEP_R = 48;
  var ALIGN_R = 92;
  var COHES_R = 160;
  var BLIND = (127 * Math.PI) / 180; // 后方盲区
  // 转向强度
  var SEP_STR = 300;
  var ALIGN_STR = 120;
  var COHES_STR = 46;
  var CURRENT_STR = 1.6;
  var POINTER_R = 190;          // 指针影响半径
  var POINTER_STR = 720;

  // —— 锦鲤配色（国风水墨） ——
  var PALETTES = [
    { body: ['#d96a3a', '#b98c3e'], ink: 'rgba(54,40,24,0.42)', fin: '#c0562e', stroke: 'rgba(120,70,40,0.55)' }, // 朱红描金
    { body: ['#f0e3d3', '#e0b398'], ink: 'rgba(70,48,32,0.26)', fin: '#dca58a', stroke: 'rgba(140,100,72,0.5)' }, // 白底粉晕
    { body: ['#3a3a38', '#1f1f1e'], ink: 'rgba(0,0,0,0.55)', fin: '#2c2b29', stroke: 'rgba(20,20,20,0.6)' }        // 墨黑
  ];

  var W = 0, H = 0, ratio = 1;
  var fish = [];
  var pointer = { x: -1e5, y: -1e5, inside: false };
  var respawnTimer = RESPAWN_INTERVAL;
  var raf = 0, last = 0, visible = true, pageVisible = true, paused = false;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function makeFish(spawn) {
    var pal = PALETTES[(Math.random() * PALETTES.length) | 0];
    return {
      x: spawn ? Math.random() * W : W * 0.5,
      y: spawn ? Math.random() * H : H * 0.5,
      a: Math.random() * Math.PI * 2,
      s: SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN),
      phase: Math.random() * Math.PI * 2,
      len: LEN * (0.82 + Math.random() * 0.34),
      pal: pal
    };
  }

  function resize() {
    var r = host.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    ratio = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    var pw = Math.round(W * ratio);
    var ph = Math.round(H * ratio);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
  }

  // —— 无散度洋流（curl of stream function，出自 ascii-sharks/math） ——
  var K1 = 1 / 260, K2 = 1 / 310, K3 = 1 / 190, CUR_SCALE = 3400;
  function current(x, y, t, out) {
    var a = x * K1 + t * 0.07;
    var b = y * K2 - t * 0.05;
    var c = (x + y) * K3 + t * 0.11;
    out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CUR_SCALE;
    out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CUR_SCALE;
    return out;
  }

  var cur = { x: 0, y: 0 };

  function step(dt) {
    var n = fish.length;
    // 周期性从边缘"游出"一条，提升出现频率
    respawnTimer -= dt;
    if (respawnTimer <= 0) {
      respawnTimer = RESPAWN_INTERVAL + Math.random() * 1.2;
      var rf = fish[(Math.random() * n) | 0];
      var m = 20;
      var edge = (Math.random() * 4) | 0;
      if (edge === 0) { rf.x = -m; rf.y = Math.random() * H; }
      else if (edge === 1) { rf.x = W + m; rf.y = Math.random() * H; }
      else if (edge === 2) { rf.y = -m; rf.x = Math.random() * W; }
      else { rf.y = H + m; rf.x = Math.random() * W; }
      rf.a = Math.random() * Math.PI * 2;
      rf.phase = Math.random() * Math.PI * 2;
    }
    for (var i = 0; i < n; i++) {
      var f = fish[i];
      var sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0;
      var sa = 0, aa = 0, ca = 0;
      for (var j = 0; j < n; j++) {
        if (j === i) continue;
        var g = fish[j];
        var dx = g.x - f.x, dy = g.y - f.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var rel = Math.atan2(dy, dx);
        var relA = Math.atan2(Math.sin(rel - f.a), Math.cos(rel - f.a));
        if (Math.abs(relA) > BLIND) continue; // 盲区：身后看不见
        if (d < SEP_R) {
          var push = (SEP_R - d) / SEP_R;
          sx -= (dx / d) * push; sy -= (dy / d) * push; sa++;
        } else if (d < ALIGN_R) {
          ax += Math.cos(g.a); ay += Math.sin(g.a); aa++;
        } else if (d < COHES_R) {
          cx += dx; cy += dy; ca++;
        }
      }
      current(f.x, f.y, t, cur);
      var vx = Math.cos(f.a) * f.s;
      var vy = Math.sin(f.a) * f.s;
      if (sa) { vx += (sx / sa) * SEP_STR; vy += (sy / sa) * SEP_STR; }
      if (aa) { vx += (ax / aa) * ALIGN_STR; vy += (ay / aa) * ALIGN_STR; }
      if (ca) {
        var cc = Math.atan2(cy, cx);
        vx += Math.cos(cc) * COHES_STR; vy += Math.sin(cc) * COHES_STR;
      }
      vx += cur.x * CURRENT_STR; vy += cur.y * CURRENT_STR;
      // 指针驱散
      if (pointer.inside) {
        var pdx = f.x - pointer.x, pdy = f.y - pointer.y;
        var pd = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
        if (pd < POINTER_R) {
          var k = (1 - pd / POINTER_R);
          vx += (pdx / pd) * POINTER_STR * k;
          vy += (pdy / pd) * POINTER_STR * k;
        }
      }
      var sp = Math.sqrt(vx * vx + vy * vy) || 1;
      var target = Math.min(sp, SPEED_MAX * 1.45);
      if (sp > SPEED_MIN) target = Math.max(target, SPEED_MIN * 0.6);
      f.a = Math.atan2(vy, vx);
      f.s = target;
      f.x += Math.cos(f.a) * f.s * dt;
      f.y += Math.sin(f.a) * f.s * dt;
      // 回绕（留边距）
      var m = 30;
      if (f.x < -m) f.x = W + m; else if (f.x > W + m) f.x = -m;
      if (f.y < -m) f.y = H + m; else if (f.y > H + m) f.y = -m;
    }
    t += dt;
  }

  function drawFish(f, t) {
    var L = f.len * ratio;
    ctx.save();
    ctx.translate(f.x * ratio, f.y * ratio);
    ctx.rotate(f.a);
    var ph = Math.sin(t * 3.2 + f.phase); // 尾摆相位
    var pal = f.pal;

    // 尾鳍（两叶随相位摆动）
    ctx.beginPath();
    ctx.moveTo(-L * 0.24, 0);
    ctx.quadraticCurveTo(-L * 0.44, -L * 0.06 + ph * L * 0.05, -L * 0.5, -L * 0.16 - ph * L * 0.09);
    ctx.quadraticCurveTo(-L * 0.4, -L * 0.02, -L * 0.24, -L * 0.04);
    ctx.quadraticCurveTo(-L * 0.4, L * 0.02, -L * 0.5, L * 0.16 - ph * L * 0.09);
    ctx.quadraticCurveTo(-L * 0.44, L * 0.06 + ph * L * 0.05, -L * 0.24, 0);
    ctx.closePath();
    ctx.fillStyle = pal.fin;
    ctx.globalAlpha = 0.82;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 身体（流线吻部 → 尾柄）
    var grad = ctx.createLinearGradient(L * 0.5, 0, -L * 0.28, 0);
    grad.addColorStop(0, pal.body[0]);
    grad.addColorStop(1, pal.body[1]);
    ctx.beginPath();
    ctx.moveTo(L * 0.52, 0);
    ctx.bezierCurveTo(L * 0.3, -L * 0.15, -L * 0.04, -L * 0.13, -L * 0.26, 0);
    ctx.bezierCurveTo(-L * 0.04, L * 0.13, L * 0.3, L * 0.15, L * 0.52, 0);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 胸鳍（两片轻扫）
    ctx.beginPath();
    ctx.moveTo(L * 0.1, -L * 0.05);
    ctx.quadraticCurveTo(L * 0.02, -L * 0.22 - ph * L * 0.03, -L * 0.14, -L * 0.2);
    ctx.quadraticCurveTo(-L * 0.02, -L * 0.06, L * 0.1, -L * 0.05);
    ctx.closePath();
    ctx.fillStyle = pal.fin;
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(L * 0.1, L * 0.05);
    ctx.quadraticCurveTo(L * 0.02, L * 0.22 + ph * L * 0.03, -L * 0.14, L * 0.2);
    ctx.quadraticCurveTo(-L * 0.02, L * 0.06, L * 0.1, L * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // 水墨斑（朱红/墨色鱼的点睛墨意）
    ctx.beginPath();
    ctx.ellipse(-L * 0.02, 0, L * 0.13, L * 0.05, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal.ink;
    ctx.fill();

    // 墨线描边
    ctx.beginPath();
    ctx.moveTo(L * 0.52, 0);
    ctx.bezierCurveTo(L * 0.3, -L * 0.15, -L * 0.04, -L * 0.13, -L * 0.26, 0);
    ctx.bezierCurveTo(-L * 0.04, L * 0.13, L * 0.3, L * 0.15, L * 0.52, 0);
    ctx.strokeStyle = pal.stroke;
    ctx.lineWidth = Math.max(1, ratio * 0.8);
    ctx.stroke();

    ctx.restore();
  }

  var t = Math.random() * 60;

  function frame(now) {
    raf = 0;
    var dt = Math.min((now - last) / 1000 || 0, 0.05);
    last = now;
    t += dt;
    step(dt);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < fish.length; i++) drawFish(fish[i], t);
    if (visible && pageVisible && !paused) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !visible || !pageVisible || paused) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // 指针（window 级，不挡交互）
  function onPointerMove(e) {
    var r = host.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    wake();
  }
  function onPointerLeave() { pointer.inside = false; }
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerLeave);

  var ro = new ResizeObserver(function () { resize(); wake(); });
  ro.observe(host);
  var io = new IntersectionObserver(function (entries) {
    visible = entries.some(function (e) { return e.isIntersecting; });
    wake();
  });
  io.observe(host);
  function onVis() { pageVisible = document.visibilityState !== 'hidden'; wake(); }
  document.addEventListener('visibilitychange', onVis);

  // 初始化
  resize();
  for (var i = 0; i < COUNT; i++) fish.push(makeFish(true));
  if (reduced) {
    // 减弱动效：只画一帧静态
    frame(performance.now());
    paused = true;
  } else {
    wake();
  }
})();
