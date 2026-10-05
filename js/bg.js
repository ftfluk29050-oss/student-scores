/* พื้นหลัง "Katihar" (Ribbon Field): แถบสีเขียว 3 แถบตามแนวมุม angle ขอบแถบฟุ้งเล็กน้อย
   และโค้งเป็นคลื่นด้วย offset = (wave/100) * 0.35 * sin(cross * 2.4 * 2π + clock)
   วาดบน canvas ความละเอียดต่ำแล้วขยายเต็มจอ จึงใช้เครื่องน้อย */
(function () {
  'use strict';
  var canvas = document.getElementById('bg');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var ANGLE = 97, WAVE = 12, AMT = 0.85, DIR = 1, SPEED = 1.0, CLOCK0 = 20.75;
  // จุดเปลี่ยนสีตามแนวแถบ (ร้อยละ) ชุดเดียวกับ CSS สำรองใน style.css
  var STOPS = [[0, 0x53, 0x92, 0x55], [15.44, 0x53, 0x92, 0x55], [18.56, 0x91, 0xC6, 0x82], [59.94, 0x91, 0xC6, 0x82], [61.5, 0xDD, 0xF0, 0xC8], [100, 0xDD, 0xF0, 0xC8]];

  // ตารางสีล่วงหน้า 2048 ช่อง (เก็บเป็น ABGR สำหรับเขียนลง ImageData ทีละพิกเซล)
  var N = 2048, lut = new Uint32Array(N);
  for (var i = 0; i < N; i++) {
    var p = i / (N - 1) * 100, k = 0;
    while (k < STOPS.length - 2 && p > STOPS[k + 1][0]) k++;
    var a = STOPS[k], b = STOPS[k + 1], f = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (p - a[0]) / (b[0] - a[0])));
    f = f * f * (3 - 2 * f); // ขอบฟุ้งแบบนุ่ม
    var r = a[1] + (b[1] - a[1]) * f, g = a[2] + (b[2] - a[2]) * f, bl = a[3] + (b[3] - a[3]) * f;
    lut[i] = (255 << 24) | (bl << 16) | (g << 8) | r;
  }

  var W = 0, H = 0, img = null, px = null;
  function resize() {
    var vw = window.innerWidth || 1, vh = window.innerHeight || 1, s = Math.min(1, 360 / Math.max(vw, vh));
    W = Math.max(2, Math.round(vw * s)); H = Math.max(2, Math.round(vh * s));
    canvas.width = W; canvas.height = H;
    img = ctx.createImageData(W, H); px = new Uint32Array(img.data.buffer);
  }

  function draw(t) {
    var ph = t * SPEED, spin = ph * DIR;
    var ang = (ANGLE + Math.sin(spin * 0.6) * 28 * AMT) * Math.PI / 180; // แกว่งไปมา ไม่หมุนรอบ (เป็น 0 พอดีเมื่อ ph = 0)
    var clock = CLOCK0 + ph * 1.2;
    var dx = Math.sin(ang), dy = -Math.cos(ang);                 // ทิศของแถบ แบบเดียวกับ linear-gradient ของ CSS
    var len = Math.abs(W * dx) + Math.abs(H * dy);                // ความยาวตามแนวแถบ
    var amp = WAVE / 100 * 0.35, freq = 2.4 * 2 * Math.PI, cx = W / 2, cy = H / 2, n1 = N - 1, o = 0;
    for (var y = 0; y < H; y++) {
      var ry = y + 0.5 - cy;
      for (var x = 0; x < W; x++) {
        var rx = x + 0.5 - cx;
        var u = (rx * dx + ry * dy) / len + 0.5;                  // ตำแหน่งตามแนวแถบ 0..1
        var c = (rx * -dy + ry * dx) / len + 0.5;                 // ตำแหน่งขวางแถบ
        u += amp * Math.sin(c * freq + clock);
        px[o++] = lut[u <= 0 ? 0 : u >= 1 ? n1 : (u * n1) | 0];
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var start = null, raf = 0;
  function frame(now) {
    if (start === null) start = now;
    draw((now - start) / 1000);
    raf = requestAnimationFrame(frame);
  }
  function play() { if (!still && !raf && !document.hidden) raf = requestAnimationFrame(frame); }
  function pause() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  resize(); draw(0);
  window.addEventListener('resize', function () { resize(); if (!raf) draw(0); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else play(); });
  play();
  window.__bgDraw = draw; // ใช้ตรวจภาพที่เวลาใดเวลาหนึ่งตอนทดสอบ
})();
