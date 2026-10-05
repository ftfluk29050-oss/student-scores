/* สมุดคะแนนนักเรียน
   ข้อมูลคะแนนเก็บใน localStorage ของเบราว์เซอร์ (ไม่ถูกส่งขึ้นอินเทอร์เน็ต)
   โครงสร้าง: db.subjects[] = {id, name, code, classIds[], items[{id, name, max}]}
              db.scores[subjectId][studentCode][itemId] = number
              db.notes[studentCode] = string */
(function () {
  'use strict';

  var KEY = 'student-scores-v1';
  var R = window.ROSTER;
  var app = document.getElementById('app');
  var dlg = document.getElementById('dlg');

  var classById = {}, stuByCode = {};
  R.classes.forEach(function (c) {
    classById[c.id] = c;
    c.students.forEach(function (s) { stuByCode[s.code] = { no: s.no, code: s.code, name: s.name, classId: c.id }; });
  });

  // เกณฑ์ตัดเกรด 8 ระดับ (ร้อยละ)
  var GRADES = [[80, '4'], [75, '3.5'], [70, '3'], [65, '2.5'], [60, '2'], [55, '1.5'], [50, '1'], [0, '0']];
  var TEMPLATE = [['เก็บก่อนกลางภาค', 25], ['สอบกลางภาค', 20], ['เก็บหลังกลางภาค', 25], ['สอบปลายภาค', 30]];

  // ---------- ข้อมูล ----------
  function blank() { return { subjects: [], scores: {}, notes: {}, lastBackup: null }; }
  function loadLocal() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY));
      if (d && Array.isArray(d.subjects)) { d.scores = d.scores || {}; d.notes = d.notes || {}; return d; }
    } catch (e) { /* ใช้ข้อมูลว่าง */ }
    return blank();
  }
  // ถ้าตั้งค่า Firebase ไว้ (js/firebase-config.js) จะต้องล็อกอิน และข้อมูลเก็บบนคลาวด์ในบัญชีของผู้ใช้
  // ถ้าไม่ได้ตั้งค่า ข้อมูลเก็บในเบราว์เซอร์ของเครื่องนี้
  var CONFIG = window.FIREBASE_CONFIG || null;
  var db = CONFIG ? blank() : loadLocal();
  var storageOk = true;
  var cloud = null, cloudUser = null, cloudReady = false, cloudErr = '';
  var mainDirty = false, mainTimer = 0, lastMain = '', patchQ = {}, patchTimer = 0, pending = 0, localPhotos = {};

  function status() {
    var el = document.getElementById('saved');
    var t = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    el.style.color = '';
    if (CONFIG) {
      if (!cloudUser) el.textContent = '';
      else if (cloudErr) { el.textContent = 'ซิงก์ขึ้นคลาวด์ไม่สำเร็จ (' + cloudErr + ') ให้สำรองข้อมูลเป็นไฟล์ไว้ก่อน'; el.style.color = 'var(--red)'; }
      else if (pending > 0 || mainDirty || Object.keys(patchQ).length) el.textContent = navigator.onLine ? 'กำลังซิงก์ขึ้นคลาวด์' : 'ออฟไลน์อยู่ ข้อมูลจะซิงก์เมื่อมีอินเทอร์เน็ต';
      else el.textContent = 'ซิงก์ขึ้นคลาวด์แล้ว เวลา ' + t + ' น.';
      return;
    }
    el.textContent = storageOk
      ? 'บันทึกในเครื่องนี้แล้ว เวลา ' + t + ' น.'
      : 'บันทึกไม่ได้ เบราว์เซอร์ปิดการเก็บข้อมูลไว้ ให้สำรองข้อมูลเป็นไฟล์ก่อนปิดหน้านี้';
    if (!storageOk) el.style.color = 'var(--red)';
  }
  function save() {
    if (CONFIG) {
      if (cloudUser && JSON.stringify(mainObj()) !== lastMain) { mainDirty = true; clearTimeout(mainTimer); mainTimer = setTimeout(flushMain, 700); }
      status(); return;
    }
    try { localStorage.setItem(KEY, JSON.stringify(db)); storageOk = true; }
    catch (e) { storageOk = false; }
    status();
  }

  // ---------- ส่งข้อมูลขึ้นคลาวด์ ----------
  function mainObj() { return { subjects: db.subjects, notes: db.notes, lastBackup: db.lastBackup || null }; }
  function track(p) {
    pending++; status();
    p.then(function () { pending--; cloudErr = ''; status(); }, function (e) { pending--; cloudErr = (e && e.code) || 'error'; status(); });
  }
  function flushMain() {
    clearTimeout(mainTimer);
    if (!mainDirty || !cloudUser) return;
    mainDirty = false; lastMain = JSON.stringify(mainObj());
    track(cloud.putMain(JSON.parse(lastMain)));
  }
  function flushPatches() {
    clearTimeout(patchTimer);
    var q = patchQ; patchQ = {};
    if (cloudUser) Object.keys(q).forEach(function (sid) { track(cloud.patchScores(sid, q[sid])); });
  }
  // เขียนทับคะแนนทั้งวิชา (ใช้เมื่อลบช่องคะแนน หรือกู้คืนข้อมูล)
  function cloudPutScores(sid) { if (!cloudUser) return; delete patchQ[sid]; track(cloud.putScores(sid, JSON.parse(JSON.stringify(db.scores[sid] || {})))); }
  function cloudDelScores(sid) { if (!cloudUser) return; delete patchQ[sid]; track(cloud.delScores(sid)); }
  // แทนที่ข้อมูลบนคลาวด์ทั้งหมดด้วยข้อมูลในหน่วยความจำตอนนี้
  function cloudReplaceAll(prevSids, prevCodes) {
    if (!cloudUser) return;
    patchQ = {}; mainDirty = true; flushMain();
    var keep = {};
    db.subjects.forEach(function (s) { keep[s.id] = 1; cloudPutScores(s.id); });
    prevSids.forEach(function (sid) { if (!keep[sid]) { keep[sid] = 1; cloudDelScores(sid); } });
    prevCodes.forEach(function (c) { if (!photos[c]) track(cloud.delPhoto(c)); });
    Object.keys(photos).forEach(function (c) { track(cloud.putPhoto(c, photos[c])); });
  }

  // ---------- รูปนักเรียน (เก็บใน IndexedDB ของเบราว์เซอร์ เพราะรูปใหญ่เกินที่ localStorage รับได้) ----------
  var photos = {}, idb = null;
  function photoStore(mode) { return idb.transaction('photos', mode).objectStore('photos'); }
  function photosLoad(done) {
    var req; try { req = indexedDB.open('student-scores', 1); } catch (e) { done(); return; }
    req.onupgradeneeded = function () { req.result.createObjectStore('photos'); };
    req.onerror = function () { done(); };
    req.onsuccess = function () {
      idb = req.result;
      var cur = photoStore('readonly').openCursor();
      cur.onsuccess = function () { var c = cur.result; if (c) { photos[c.key] = c.value; c.continue(); } else done(); };
      cur.onerror = function () { done(); };
    };
  }
  function photoSet(code, dataUrl) {
    photos[code] = dataUrl;
    if (cloudUser) track(cloud.putPhoto(code, dataUrl)); else if (!CONFIG && idb) photoStore('readwrite').put(dataUrl, code);
  }
  function photoDel(code) {
    delete photos[code];
    if (cloudUser) track(cloud.delPhoto(code)); else if (!CONFIG && idb) photoStore('readwrite').delete(code);
  }
  // แทนที่รูปทั้งหมดในหน่วยความจำ (และในเครื่อง ถ้าเป็นโหมดเก็บในเครื่อง) ส่วนบนคลาวด์ให้ cloudReplaceAll จัดการ
  function photosReplace(all) {
    var local = !CONFIG && idb;
    photos = {}; if (local) photoStore('readwrite').clear();
    Object.keys(all || {}).forEach(function (code) {
      if (!/^data:image\//.test(all[code])) return;
      photos[code] = all[code]; if (local) photoStore('readwrite').put(all[code], code);
    });
  }
  // ย่อและครอบรูปเป็นสัดส่วน 3:4 (300x400) ก่อนเก็บ เพื่อให้ไฟล์เล็ก
  function photoFromFile(file, ok, fail) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var W = 300, H = 400, s = Math.max(W / img.width, H / img.height);
      var w = img.width * s, hh = img.height * s, c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d').drawImage(img, (W - w) / 2, (H - hh) / 3, w, hh);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = function () { URL.revokeObjectURL(url); fail(); };
    img.src = url;
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return String(+(+n).toFixed(2)); }
  function subj(id) { return db.subjects.filter(function (s) { return s.id === id; })[0]; }
  function subjName(s) { return (s.code ? s.code + ' ' : '') + s.name; }
  function getScore(sid, code, iid) { var a = db.scores[sid]; a = a && a[code]; var v = a && a[iid]; return typeof v === 'number' ? v : null; }
  function putLocal(sid, code, iid, v) {
    var a = db.scores[sid] = db.scores[sid] || {}; var b = a[code] = a[code] || {};
    if (v === null) delete b[iid]; else b[iid] = v;
  }
  function setScore(sid, code, iid, v) {
    putLocal(sid, code, iid, v);
    if (cloudUser) {
      var q = patchQ[sid] = patchQ[sid] || {}; (q[code] = q[code] || {})[iid] = v;
      clearTimeout(patchTimer); patchTimer = setTimeout(flushPatches, 600);
    }
  }
  function gradeOf(pct) { for (var i = 0; i < GRADES.length; i++) if (pct >= GRADES[i][0]) return GRADES[i][1]; return '0'; }

  // สรุปคะแนนของนักเรียนหนึ่งคนในหนึ่งวิชา
  function summary(s, code) {
    var total = 0, max = 0, done = 0;
    s.items.forEach(function (it) {
      max += it.max;
      var v = getScore(s.id, code, it.id);
      if (v !== null) { total += v; done++; }
    });
    var complete = s.items.length > 0 && done === s.items.length;
    var pct = max ? total / max * 100 : 0;
    return { total: total, max: max, done: done, left: s.items.length - done, complete: complete, pct: pct, grade: complete ? gradeOf(pct) : null };
  }
  function itemAvg(s, cls, it) {
    var sum = 0, n = 0;
    cls.students.forEach(function (st) { var v = getScore(s.id, st.code, it.id); if (v !== null) { sum += v; n++; } });
    return n ? sum / n : null;
  }
  function parseScore(text, max) {
    var t = String(text).trim().replace(',', '.');
    if (t === '') return { ok: true, v: null };
    if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false };
    var v = parseFloat(t);
    return v >= 0 && v <= max ? { ok: true, v: v } : { ok: false };
  }

  // ---------- เส้นทางหน้า ----------
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function route(keepScroll) {
    if (CONFIG && !(cloudUser && cloudReady)) { if (cloud && !cloudUser) viewLogin(); return; }
    var p = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    var page = p[0] || 'home';
    if (!(page === 'home' && keepScroll === true)) stopShaders();
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      var on = a.dataset.nav === page || (page === 'student' && a.dataset.nav === 'students');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (page === 'students') viewStudents(p[1]);
    else if (page === 'student') viewStudent(p[1]);
    else if (page === 'settings') viewSettings();
    else if (page === 'scores') viewScores(p[1], p[2]);
    else viewHome(keepScroll === true);
    if (keepScroll !== true) window.scrollTo(0, 0);
  }

  // ---------- หน้าแรก ----------
  // การ์ดพื้นหลังเชเดอร์เคลื่อนไหว (Warp ของ Paper Shaders) ถ้าเครื่องไม่รองรับ WebGL จะเห็นพื้นหลังไล่สีแทน
  var HOME = [
    { key: 'scores', title: 'กรอกคะแนน', go: 'ไปที่ตารางคะแนน', href: '#/scores',
      icon: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
      warp: { proportion: 0.35, softness: 0.9, distortion: 0.18, swirl: 0.7, swirlIterations: 10, shape: 'checks', shapeScale: 0.1,
        colors: ['hsl(120, 100%, 25%)', 'hsl(140, 100%, 60%)', 'hsl(100, 90%, 30%)', 'hsl(130, 100%, 70%)'] } },
    { key: 'students', title: 'ข้อมูลนักเรียน', go: 'ดูรายชื่อนักเรียน', href: '#/students',
      icon: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
      warp: { proportion: 0.4, softness: 1.2, distortion: 0.2, swirl: 0.9, swirlIterations: 12, shape: 'dots', shapeScale: 0.12,
        colors: ['hsl(200, 100%, 25%)', 'hsl(180, 100%, 65%)', 'hsl(160, 90%, 35%)', 'hsl(190, 100%, 75%)'] } },
    { key: 'add', title: 'เพิ่มวิชา', go: 'สร้างวิชาใหม่', href: '#/scores',
      icon: 'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 11h-3v3h-2v-3H8v-2h3V8h2v3h3v2z',
      warp: { proportion: 0.45, softness: 1.1, distortion: 0.22, swirl: 0.8, swirlIterations: 15, shape: 'dots', shapeScale: 0.09,
        colors: ['hsl(30, 100%, 35%)', 'hsl(50, 100%, 65%)', 'hsl(40, 90%, 40%)', 'hsl(45, 100%, 75%)'] } }
  ];
  var shaders = [], shaderRun = 0;
  function stopShaders() { shaderRun++; shaders.forEach(function (s) { try { s.dispose(); } catch (e) { /* ปิดไปแล้ว */ } }); shaders = []; }
  function homeText(key) {
    var nStu = Object.keys(stuByCode).length;
    if (key === 'scores') return db.subjects.length
      ? 'เลือกวิชาและห้อง แล้วกรอกคะแนนในตาราง ระบบรวมคะแนนและตัดเกรดให้ ตอนนี้มี ' + db.subjects.length + ' วิชา'
      : 'เลือกวิชาและห้อง แล้วกรอกคะแนนในตาราง ระบบรวมคะแนนและตัดเกรดให้ เริ่มได้เมื่อเพิ่มวิชาแรก';
    if (key === 'students') return 'รายชื่อ ' + nStu + ' คน ' + R.classes.length + ' ห้อง เปิดดูคะแนนรายบุคคล รูปถ่าย และบันทึกของครู';
    return 'เพิ่มวิชาที่สอน เลือกห้อง และกำหนดช่องคะแนน เพิ่มได้ไม่จำกัดจำนวน';
  }
  function viewHome(updateOnly) {
    if (updateOnly && app.querySelector('.home')) { // ข้อมูลเปลี่ยนจากเครื่องอื่น: แก้เฉพาะข้อความ ไม่เริ่มภาพเคลื่อนไหวใหม่
      HOME.forEach(function (c) { var el = app.querySelector('[data-card="' + c.key + '"] p'); if (el) el.textContent = homeText(c.key); });
      return;
    }
    app.innerHTML = '<section class="home"><header><h1>สมุดคะแนนนักเรียน</h1><p>เลือกสิ่งที่จะทำ</p></header><div class="cards">' +
      HOME.map(function (c) {
        return '<a class="card" href="' + c.href + '" data-card="' + c.key + '"><span class="warp warp-' + c.key + '" aria-hidden="true"></span><span class="card-body">' +
          '<svg class="card-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + c.icon + '"/></svg>' +
          '<h2>' + c.title + '</h2><p>' + h(homeText(c.key)) + '</p>' +
          '<span class="card-go">' + c.go + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></span>' +
          '</span></a>';
      }).join('') + '</div></section>';
    app.querySelector('[data-card="add"]').onclick = function (e) { e.preventDefault(); subjectDialog(null); };
    var run = ++shaderRun, still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    import('./vendor/paper-warp.js').then(function (m) {
      HOME.forEach(function (c, i) {
        var el = app.querySelector('.warp-' + c.key); if (!el || run !== shaderRun) return;
        m.mountWarp(el, Object.assign({ speed: still ? 0 : 0.8, frame: i * 4000 }, c.warp)).then(function (s) {
          if (run !== shaderRun) { s.dispose(); return; }
          shaders.push(s);
        }, function () { /* ไม่มี WebGL ใช้พื้นหลังไล่สีจาก CSS */ });
      });
    }, function () { /* โหลดเชเดอร์ไม่ได้ ใช้พื้นหลังไล่สีจาก CSS */ });
  }

  // ---------- หน้ากรอกคะแนน ----------
  function viewScores(sid, cid) {
    if (!db.subjects.length) {
      app.innerHTML = '<div class="empty"><h1>เริ่มจากเพิ่มวิชาที่สอน</h1>' +
        '<p>เลือกห้องที่สอนและกำหนดช่องคะแนน แล้วตารางกรอกคะแนนของแต่ละห้องจะพร้อมใช้ รายชื่อนักเรียน ' +
        R.classes.length + ' ห้องใส่ไว้ให้แล้ว</p><button class="primary" id="add-subject">เพิ่มวิชา</button></div>';
      document.getElementById('add-subject').onclick = function () { subjectDialog(null); };
      return;
    }
    var s = subj(sid) || subj(localStorage.getItem(KEY + ':last')) || db.subjects[0];
    var cls = s.classIds.indexOf(cid) >= 0 ? classById[cid] : classById[s.classIds[0]];
    localStorage.setItem(KEY + ':last', s.id);

    var html = '<div class="toolbar"><label class="sr" for="pick">วิชา</label><select id="pick">' +
      db.subjects.map(function (x) { return '<option value="' + x.id + '"' + (x.id === s.id ? ' selected' : '') + '>' + h(subjName(x)) + '</option>'; }).join('') +
      '</select><button id="edit-subject" class="plain">แก้ไขวิชา</button><button id="new-subject">+ เพิ่มวิชา</button><span class="grow"></span>' +
      '<button id="add-item" class="primary">เพิ่มช่องคะแนน</button>' +
      (cls ? '<button id="export">ส่งออกเป็น Excel</button>' : '') + '</div>';

    if (!cls) {
      html += '<div class="empty"><h1>วิชานี้ยังไม่ได้เลือกห้อง</h1><p>กด “แก้ไขวิชา” แล้วเลือกห้องที่สอน</p></div>';
      app.innerHTML = html; bindScoreToolbar(s, null); return;
    }

    html += '<div class="tabs">' + s.classIds.map(function (id) {
      return '<a href="#/scores/' + s.id + '/' + id + '"' + (id === cls.id ? ' aria-current="true"' : '') + '>' + classById[id].name + '</a>';
    }).join('') + '</div><div class="sheet"><div class="sheet-head"><h1>' + h(subjName(s)) + ' ' + cls.name + '</h1>' +
      '<span class="muted">' + cls.students.length + ' คน ครูที่ปรึกษา ' + h(cls.advisors.join(', ')) + '</span></div>';

    if (!s.items.length) {
      html += '<div style="padding:2rem 1rem"><h2>ยังไม่มีช่องคะแนน</h2><p>กด “เพิ่มช่องคะแนน” เพื่อสร้างช่องแรก เช่น ใบงานที่ 1 เต็ม 10 คะแนน</p></div></div>';
      app.innerHTML = html; bindScoreToolbar(s, cls); return;
    }

    var maxTotal = s.items.reduce(function (a, it) { return a + it.max; }, 0);
    html += '<div class="gridwrap"><table class="grid"><thead><tr><th class="c-no">เลขที่</th><th class="c-code">รหัส</th><th class="c-name">ชื่อ สกุล</th>' +
      s.items.map(function (it) { return '<th><button data-item="' + it.id + '" title="แก้ไขช่องคะแนนนี้">' + h(it.name) + '</button><small>เต็ม ' + fmt(it.max) + '</small></th>'; }).join('') +
      '<th class="c-sum">รวม<small>เต็ม ' + fmt(maxTotal) + '</small></th><th class="c-grade">เกรด</th></tr></thead><tbody>';
    cls.students.forEach(function (st, r) {
      html += '<tr data-code="' + st.code + '"><td class="c-no">' + st.no + '</td><td class="c-code">' + st.code + '</td>' +
        '<td class="c-name"><a href="#/student/' + st.code + '" tabindex="-1">' + h(st.name) + '</a></td>' +
        s.items.map(function (it, c) {
          var v = getScore(s.id, st.code, it.id);
          return '<td class="cell"><input inputmode="decimal" autocomplete="off" data-r="' + r + '" data-c="' + c + '" value="' + (v === null ? '' : fmt(v)) +
            '" aria-label="' + h(it.name) + ' ของ ' + h(st.name) + '"></td>';
        }).join('') + '<td class="c-sum"></td><td class="c-grade"></td></tr>';
    });
    html += '</tbody><tfoot><tr><td class="c-no"></td><td class="c-code"></td><td class="c-name">เฉลี่ยห้อง</td>' +
      s.items.map(function () { return '<td class="f-avg"></td>'; }).join('') + '<td class="c-sum f-sum"></td><td></td></tr></tfoot></table></div></div>' +
      '<p class="hint">กด Enter หรือลูกศรเพื่อเลื่อนไปช่องถัดไป วางคะแนนที่คัดลอกจาก Excel ลงได้ทั้งคอลัมน์ กดชื่อนักเรียนเพื่อดูข้อมูลรายบุคคล</p>';
    app.innerHTML = html;
    bindScoreToolbar(s, cls);

    var tbody = app.querySelector('tbody');
    function refreshRow(tr) {
      var m = summary(s, tr.dataset.code);
      tr.querySelector('.c-sum').textContent = m.done ? fmt(m.total) : '';
      var g = tr.querySelector('.c-grade');
      g.className = 'c-grade' + (m.grade !== null && +m.grade < 1 ? ' low' : '');
      g.innerHTML = m.grade !== null ? m.grade : (m.done ? '<span class="pending">ค้าง ' + m.left + '</span>' : '');
    }
    function refreshFoot() {
      var cells = app.querySelectorAll('.f-avg'), sum = 0, n = 0;
      s.items.forEach(function (it, i) { var a = itemAvg(s, cls, it); cells[i].textContent = a === null ? '' : fmt(a); });
      cls.students.forEach(function (st) { var m = summary(s, st.code); if (m.done) { sum += m.total; n++; } });
      app.querySelector('.f-sum').textContent = n ? fmt(sum / n) : '';
    }
    function commit(inp) {
      var it = s.items[+inp.dataset.c], code = inp.closest('tr').dataset.code;
      var res = parseScore(inp.value, it.max);
      inp.parentNode.classList.toggle('bad', !res.ok);
      inp.title = res.ok ? '' : 'ใส่ตัวเลข 0 ถึง ' + fmt(it.max);
      // ค่าที่กรอกผิดจะไม่ถูกเก็บ (ช่องนั้นนับเป็นยังไม่มีคะแนนจนกว่าจะแก้)
      setScore(s.id, code, it.id, res.ok ? res.v : null); save(); refreshRow(inp.closest('tr')); refreshFoot();
    }
    function cellAt(r, c) { return tbody.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]'); }

    tbody.querySelectorAll('tr').forEach(refreshRow); refreshFoot();
    tbody.addEventListener('input', function (e) { if (e.target.tagName === 'INPUT') commit(e.target); });
    tbody.addEventListener('focusin', function (e) { if (e.target.tagName === 'INPUT') e.target.select(); });
    tbody.addEventListener('keydown', function (e) {
      var inp = e.target; if (inp.tagName !== 'INPUT') return;
      var r = +inp.dataset.r, c = +inp.dataset.c, to = null;
      if (e.key === 'Enter' || e.key === 'ArrowDown') to = cellAt(r + 1, c) || (e.key === 'Enter' ? cellAt(0, c + 1) : null);
      else if (e.key === 'ArrowUp') to = cellAt(r - 1, c);
      else if (e.key === 'ArrowRight' && inp.selectionStart === inp.value.length) to = cellAt(r, c + 1);
      else if (e.key === 'ArrowLeft' && inp.selectionEnd === 0) to = cellAt(r, c - 1);
      else return;
      if (to) { e.preventDefault(); to.focus(); }
    });
    tbody.addEventListener('paste', function (e) {
      var inp = e.target; if (inp.tagName !== 'INPUT') return;
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n]/.test(text.trim())) return; // ค่าเดียว ปล่อยให้วางตามปกติ
      e.preventDefault();
      var r0 = +inp.dataset.r, c0 = +inp.dataset.c;
      text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').forEach(function (line, i) {
        line.split('\t').forEach(function (val, j) {
          var cell = cellAt(r0 + i, c0 + j);
          if (cell) { cell.value = val.trim(); commit(cell); }
        });
      });
    });
  }

  function bindScoreToolbar(s, cls) {
    document.getElementById('pick').onchange = function () { go('#/scores/' + this.value); };
    document.getElementById('edit-subject').onclick = function () { subjectDialog(s); };
    document.getElementById('new-subject').onclick = function () { subjectDialog(null); };
    document.getElementById('add-item').onclick = function () { itemDialog(s, null); };
    var ex = document.getElementById('export'); if (ex) ex.onclick = function () { exportCsv(s, cls); };
    app.querySelectorAll('[data-item]').forEach(function (b) {
      b.onclick = function () { itemDialog(s, s.items.filter(function (it) { return it.id === b.dataset.item; })[0]); };
    });
  }

  // ---------- หน้านักเรียน (รายห้อง) ----------
  function viewStudents(cid) {
    var cls = classById[cid] || classById[localStorage.getItem(KEY + ':class')] || R.classes[0];
    localStorage.setItem(KEY + ':class', cls.id);
    var subs = db.subjects.filter(function (s) { return s.classIds.indexOf(cls.id) >= 0; });
    var lvl = null;
    var html = '<div class="tabs">' + R.classes.map(function (c) {
      var gap = lvl !== null && lvl !== c.level ? '<span class="gap"></span>' : ''; lvl = c.level;
      return gap + '<a href="#/students/' + c.id + '"' + (c.id === cls.id ? ' aria-current="true"' : '') + '>' + c.name + '</a>';
    }).join('') + '</div><div class="sheet"><div class="sheet-head"><h1>นักเรียน ' + cls.name + '</h1><span class="muted">' +
      cls.students.length + ' คน ครูที่ปรึกษา ' + h(cls.advisors.join(', ')) + '</span></div>' +
      '<div class="gridwrap"><table class="grid"><thead><tr><th class="c-no">เลขที่</th><th class="c-code">รหัส</th><th class="c-name">ชื่อ สกุล</th>' +
      subs.map(function (s) { return '<th>' + h(subjName(s)) + '<small>รวม / เกรด</small></th>'; }).join('') +
      (subs.length ? '' : '<th style="text-align:left;font-weight:500">ยังไม่มีวิชาที่สอนห้องนี้</th>') + '</tr></thead><tbody>';
    cls.students.forEach(function (st) {
      html += '<tr class="link" data-code="' + st.code + '"><td class="c-no">' + st.no + '</td><td class="c-code">' + st.code + '</td>' +
        '<td class="c-name"><a href="#/student/' + st.code + '">' +
        (photos[st.code] ? '<img class="thumb" src="' + photos[st.code] + '" alt="">' : '<i class="thumb"></i>') + h(st.name) + '</a></td>' +
        subs.map(function (s) {
          var m = summary(s, st.code);
          if (!m.done) return '<td class="c-grade"><span class="pending">ยังไม่มีคะแนน</span></td>';
          return '<td class="c-grade' + (m.grade !== null && +m.grade < 1 ? ' low' : '') + '">' + fmt(m.total) + ' / ' + fmt(m.max) +
            (m.grade !== null ? ' เกรด ' + m.grade : ' <span class="pending">ค้าง ' + m.left + '</span>') + '</td>';
        }).join('') + (subs.length ? '' : '<td></td>') + '</tr>';
    });
    html += '</tbody></table></div></div><p class="hint">กดที่แถวเพื่อเปิดข้อมูลรายบุคคล</p>';
    app.innerHTML = html;
    app.querySelector('tbody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr'); if (tr && e.target.tagName !== 'A') go('#/student/' + tr.dataset.code);
    });
  }

  // ---------- หน้านักเรียนรายบุคคล ----------
  function viewStudent(code) {
    var st = stuByCode[code];
    if (!st) { app.innerHTML = '<div class="empty"><h1>ไม่พบนักเรียนรหัส ' + h(code) + '</h1><p><a href="#/students">กลับไปหน้ารายชื่อ</a></p></div>'; return; }
    var cls = classById[st.classId];
    var i = cls.students.findIndex(function (x) { return x.code === code; });
    var prev = cls.students[i - 1], next = cls.students[i + 1];
    var subs = db.subjects.filter(function (s) { return s.classIds.indexOf(cls.id) >= 0; });

    var html = '<div class="toolbar"><a class="btn plain" href="#/students/' + cls.id + '">กลับไปรายชื่อ ' + cls.name + '</a><span class="grow"></span>' +
      (prev ? '<a class="btn" href="#/student/' + prev.code + '">คนก่อนหน้า</a>' : '') +
      (next ? '<a class="btn" href="#/student/' + next.code + '">คนถัดไป</a>' : '') +
      '<button id="print">พิมพ์หน้านี้</button></div>' +
      '<div class="stu-head"><div class="who"><div class="photo">' +
      (photos[code] ? '<img src="' + photos[code] + '" alt="รูปของ ' + h(st.name) + '">' : '<span>ยังไม่มีรูป</span>') + '</div><div><h1>' + h(st.name) + '</h1>' +
      '<div class="stu-meta">' + cls.name + ' เลขที่ ' + st.no + ' รหัสนักเรียน ' + st.code + '<br>ครูที่ปรึกษา ' + h(cls.advisors.join(', ')) + '</div>' +
      '<div class="row noprint" style="margin-top:.6rem"><button id="photo-pick">' + (photos[code] ? 'เปลี่ยนรูป' : 'อัปโหลดรูปนักเรียน') + '</button>' +
      (photos[code] ? '<button id="photo-del" class="danger">ลบรูป</button>' : '') +
      '<input type="file" id="photo-file" accept="image/*" hidden></div><p class="err" id="photo-err" hidden></p></div></div></div>';

    if (!subs.length) html += '<div class="empty"><h2>ยังไม่มีวิชาที่สอนห้อง ' + cls.name + '</h2><p>เพิ่มวิชาและเลือกห้องนี้ที่หน้า <a href="#/settings">วิชาและข้อมูล</a> แล้วคะแนนจะแสดงที่นี่</p></div>';

    subs.forEach(function (s) {
      var m = summary(s, code);
      html += '<section class="subject"><header><h2>' + h(subjName(s)) + '</h2><div class="totals">' +
        '<span>รวม <b>' + fmt(m.total) + '</b> / ' + fmt(m.max) + '</span>' +
        (m.grade !== null ? '<span class="' + (+m.grade < 1 ? 'low' : '') + '">เกรด <b>' + m.grade + '</b></span>'
          : '<span class="muted">' + (s.items.length ? 'ยังค้าง ' + m.left + ' ช่อง' : 'ยังไม่มีช่องคะแนน') + '</span>') +
        '</div></header>';
      if (s.items.length) {
        html += '<table class="items">' + s.items.map(function (it) {
          var v = getScore(s.id, code, it.id), avg = itemAvg(s, cls, it);
          var low = v !== null && v < it.max / 2;
          return '<tr><th>' + h(it.name) + '</th><td class="sc">' + (v === null ? '<span class="missing">ยังไม่มีคะแนน</span>' : fmt(v) + ' <small>/ ' + fmt(it.max) + '</small>') + '</td>' +
            '<td><div class="bar">' + (v === null ? '' : '<i class="' + (low ? 'low' : '') + '" style="width:' + (v / it.max * 100) + '%"></i>') +
            (avg === null ? '' : '<u style="left:calc(' + (avg / it.max * 100) + '% - 1px)"></u>') + '</div></td>' +
            '<td class="avg">' + (avg === null ? '' : 'เฉลี่ยห้อง ' + fmt(avg)) + '</td></tr>';
        }).join('') + '</table><div class="legend"><u></u>ขีดดำคือค่าเฉลี่ยของห้อง แถบสีแดงคือได้ต่ำกว่าครึ่งของคะแนนเต็ม ' +
          '<a class="noprint" href="#/scores/' + s.id + '/' + cls.id + '">ไปกรอกคะแนนวิชานี้</a></div>';
      }
      html += '</section>';
    });

    html += '<div class="panel"><h2><label for="note">บันทึกของครู</label></h2>' +
      '<textarea id="note" placeholder="เช่น งานที่ต้องตามส่ง พฤติกรรมในชั้นเรียน สิ่งที่ควรช่วยเสริม">' + h(db.notes[code] || '') + '</textarea></div>';
    app.innerHTML = html;
    document.getElementById('print').onclick = function () { window.print(); };
    var pf = document.getElementById('photo-file');
    document.getElementById('photo-pick').onclick = function () { pf.click(); };
    pf.onchange = function () {
      if (!pf.files[0]) return;
      photoFromFile(pf.files[0], function (data) { photoSet(code, data); viewStudent(code); }, function () {
        var er = document.getElementById('photo-err'); er.hidden = false;
        er.textContent = 'เปิดไฟล์นี้เป็นรูปไม่ได้ เลือกไฟล์รูป เช่น .jpg หรือ .png';
      });
    };
    var pd = document.getElementById('photo-del');
    if (pd) pd.onclick = function () { if (confirm('ลบรูปของ ' + st.name + ' ใช่ไหม')) { photoDel(code); viewStudent(code); } };
    document.getElementById('note').oninput = function () {
      if (this.value.trim()) db.notes[code] = this.value; else delete db.notes[code];
      save();
    };
  }

  function prevIds() { return { sids: Object.keys(db.scores).concat(db.subjects.map(function (s) { return s.id; })), codes: Object.keys(photos) }; }

  // ---------- หน้าวิชาและข้อมูล ----------
  function viewSettings() {
    var nScores = 0;
    Object.keys(db.scores).forEach(function (a) { Object.keys(db.scores[a]).forEach(function (b) { nScores += Object.keys(db.scores[a][b]).length; }); });
    var html = '<div class="toolbar"><h1>วิชาและข้อมูล</h1></div><div class="panel"><div class="row" style="justify-content:space-between"><h2>วิชาที่สอน</h2>' +
      '<button class="primary" id="add-subject">เพิ่มวิชา</button></div>';
    html += db.subjects.length ? '<ul class="list">' + db.subjects.map(function (s) {
      return '<li><span><b>' + h(subjName(s)) + '</b><br><span class="muted">' +
        (s.classIds.map(function (id) { return classById[id].name; }).join(', ') || 'ยังไม่ได้เลือกห้อง') + ' มี ' + s.items.length + ' ช่องคะแนน</span></span>' +
        '<span class="row"><a class="btn" href="#/scores/' + s.id + '">กรอกคะแนน</a><button data-edit="' + s.id + '">แก้ไขวิชา</button></span></li>';
    }).join('') + '</ul>' : '<p class="muted">ยังไม่มีวิชา</p>';
    html += '</div>';
    if (cloudUser) html += '<div class="panel"><h2>บัญชี</h2><p>เข้าสู่ระบบด้วย <b>' + h(cloudUser.email) + '</b> คะแนน รูปนักเรียน และบันทึกของครูเก็บบนคลาวด์ในบัญชีนี้ เปิดจากเครื่องไหนก็เห็นข้อมูลเดียวกัน</p>' +
      '<div class="row"><button id="logout">ออกจากระบบ</button></div></div>';
    else html += '<div class="panel"><h2>ล็อกอินและซิงก์ข้ามเครื่อง</h2><p>ยังไม่ได้เปิดใช้ ตอนนี้ข้อมูลเก็บในเครื่องนี้เครื่องเดียวและไม่ต้องล็อกอิน เปิดใช้ได้โดยสร้างโปรเจกต์ Firebase แล้วใส่ค่าในไฟล์ <code>js/firebase-config.js</code> ตามขั้นตอนใน README</p></div>';
    html += '<div class="panel"><h2>ติดตั้งเป็นแอป</h2>' + (standalone()
      ? '<p>กำลังใช้งานแบบแอปอยู่แล้ว</p>'
      : '<p>ติดตั้งแล้วจะมีไอคอนบนหน้าจอ เปิดได้เต็มจอเหมือนแอป และเปิดได้แม้ไม่มีอินเทอร์เน็ต</p>' +
        '<div class="row"><button class="primary" id="install"' + (installEvt ? '' : ' hidden') + '>ติดตั้งแอป</button></div>' +
        '<p class="muted"' + (installEvt ? ' hidden' : '') + ' id="install-how">Android (Chrome): เมนู ⋮ แล้วเลือก “ติดตั้งแอป” หรือ “เพิ่มลงในหน้าจอหลัก”<br>iPhone/iPad (Safari): ปุ่มแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”<br>คอมพิวเตอร์ (Chrome/Edge): ไอคอนติดตั้งที่ขวาสุดของช่องที่อยู่เว็บ</p>') + '</div>';
    html += '<div class="panel"><h2>สำรองและกู้คืนข้อมูล</h2>' +
      (cloudUser ? '<p>ข้อมูลซิงก์ขึ้นคลาวด์ให้อัตโนมัติ ไฟล์สำรองเป็นสำเนาเผื่อไว้อีกชั้น ควรสำรองเมื่อจบแต่ละช่วงการวัดผล ไฟล์สำรองมีรูปนักเรียนรวมอยู่ด้วย</p>'
        : '<p>คะแนน รูปนักเรียน และบันทึกของครู เก็บอยู่ในเบราว์เซอร์ของเครื่องนี้เท่านั้น ถ้าล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่อง ข้อมูลจะไม่ตามไปด้วย ควรสำรองเป็นไฟล์ทุกครั้งหลังกรอกคะแนน ไฟล์สำรองมีรูปนักเรียนรวมอยู่ด้วย</p>') +
      '<p class="muted">ตอนนี้มีคะแนน ' + nScores + ' ช่อง รูปนักเรียน ' + Object.keys(photos).length + ' คน สำรองล่าสุด ' + (db.lastBackup ? new Date(db.lastBackup).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : 'ยังไม่เคยสำรอง') + '</p>' +
      '<div class="row"><button class="primary" id="backup">สำรองข้อมูลเป็นไฟล์</button><button id="restore">กู้คืนจากไฟล์สำรอง</button>' +
      '<input type="file" id="file" accept=".json,application/json" hidden><button class="danger" id="wipe">' + (cloudUser ? 'ลบข้อมูลทั้งหมดในบัญชีนี้' : 'ลบข้อมูลทั้งหมดในเครื่องนี้') + '</button></div><p class="err" id="msg" hidden></p></div>' +
      '<div class="panel"><h2>เกณฑ์ตัดเกรด</h2><p>คิดจากร้อยละของคะแนนรวมทุกช่อง เกรดจะแสดงเมื่อกรอกคะแนนครบทุกช่องแล้ว</p><table class="plain"><tr><th>ร้อยละตั้งแต่</th>' +
      GRADES.map(function (g) { return '<td class="num">' + g[0] + '</td>'; }).join('') + '</tr><tr><th>เกรด</th>' +
      GRADES.map(function (g) { return '<td class="num"><b>' + g[1] + '</b></td>'; }).join('') + '</tr></table></div>';
    app.innerHTML = html;

    document.getElementById('add-subject').onclick = function () { subjectDialog(null); };
    var lo = document.getElementById('logout');
    if (lo) lo.onclick = function () { flushMain(); flushPatches(); cloud.signOut(); };
    var ins = document.getElementById('install');
    if (ins) ins.onclick = function () { if (!installEvt) return; installEvt.prompt(); installEvt = null; ins.hidden = true; };
    app.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { subjectDialog(subj(b.dataset.edit)); }; });
    document.getElementById('backup').onclick = function () {
      db.lastBackup = Date.now(); save();
      download('สำรองคะแนน-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(Object.assign({}, db, { photos: photos })), 'application/json');
      viewSettings();
    };
    var file = document.getElementById('file'), msg = document.getElementById('msg');
    document.getElementById('restore').onclick = function () { file.click(); };
    file.onchange = function () {
      var f = file.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var d = JSON.parse(rd.result);
          if (!d || !Array.isArray(d.subjects) || typeof d.scores !== 'object') throw 0;
          if (!confirm('แทนที่ข้อมูล' + (cloudUser ? 'ในบัญชีนี้' : 'ในเครื่องนี้') + 'ด้วยข้อมูลจากไฟล์ “' + f.name + '” ใช่ไหม')) return;
          var prev = prevIds();
          photosReplace(d.photos); delete d.photos;
          d.scores = d.scores || {}; d.notes = d.notes || {}; db = d; cloudReplaceAll(prev.sids, prev.codes); save(); viewSettings();
        } catch (e) { msg.hidden = false; msg.textContent = 'ไฟล์นี้ไม่ใช่ไฟล์สำรองของสมุดคะแนน เลือกไฟล์ .json ที่ได้จากปุ่ม “สำรองข้อมูลเป็นไฟล์”'; }
      };
      rd.readAsText(f);
    };
    document.getElementById('wipe').onclick = function () {
      if (confirm('ลบวิชา คะแนน รูปนักเรียน และบันทึกของครูทั้งหมด' + (cloudUser ? 'ในบัญชีนี้ (ทุกเครื่อง)' : 'ในเครื่องนี้') + ' กู้คืนได้จากไฟล์สำรองเท่านั้น ลบเลยไหม')) { var prev = prevIds(); db = blank(); photosReplace({}); cloudReplaceAll(prev.sids, prev.codes); save(); viewSettings(); }
    };
  }

  // ---------- หน้าต่างแก้ไขวิชา ----------
  function subjectDialog(s) {
    var isNew = !s, lvl = null;
    dlg.innerHTML = '<form method="dialog"><h2>' + (isNew ? 'เพิ่มวิชา' : 'แก้ไขวิชา') + '</h2>' +
      '<label>ชื่อวิชา<input type="text" name="name" required value="' + h(s ? s.name : '') + '" placeholder="เช่น วิทยาศาสตร์"></label>' +
      '<label>รหัสวิชา (ไม่ใส่ก็ได้)<input type="text" name="code" value="' + h(s ? s.code : '') + '" placeholder="เช่น ว21101"></label>' +
      '<fieldset><legend>ห้องที่สอน</legend><div class="checks">' + R.classes.map(function (c) {
        return '<label><input type="checkbox" name="cls" value="' + c.id + '"' + (s && s.classIds.indexOf(c.id) >= 0 ? ' checked' : '') + '>' + c.name + '</label>';
      }).join('') + '</div></fieldset>' +
      (isNew ? '<label class="check"><input type="checkbox" name="tpl" checked>สร้างช่องคะแนนตั้งต้น 100 คะแนน (' +
        TEMPLATE.map(function (t) { return t[0] + ' ' + t[1]; }).join(', ') + ') แก้ไขทีหลังได้</label>' : '') +
      '<p class="err" hidden></p><div class="actions">' + (isNew ? '' : '<button type="button" class="danger left" data-act="del">ลบวิชานี้</button>') +
      '<button type="button" data-act="cancel">ยกเลิก</button><button class="primary" type="submit">' + (isNew ? 'เพิ่มวิชา' : 'บันทึก') + '</button></div></form>';
    var f = dlg.querySelector('form'), err = f.querySelector('.err');
    f.querySelector('[data-act="cancel"]').onclick = function () { dlg.close(); };
    if (!isNew) f.querySelector('[data-act="del"]').onclick = function () {
      if (!confirm('ลบวิชา “' + subjName(s) + '” พร้อมคะแนนทั้งหมดของวิชานี้ ลบเลยไหม')) return;
      db.subjects = db.subjects.filter(function (x) { return x.id !== s.id; }); delete db.scores[s.id]; cloudDelScores(s.id);
      save(); dlg.close(); go(location.hash.indexOf('settings') >= 0 ? '#/settings' : '#/scores');
    };
    f.onsubmit = function (e) {
      e.preventDefault();
      var ids = [].map.call(f.querySelectorAll('[name=cls]:checked'), function (x) { return x.value; });
      if (!ids.length) { err.hidden = false; err.textContent = 'เลือกห้องที่สอนอย่างน้อย 1 ห้อง'; return; }
      if (isNew) {
        s = { id: uid(), items: f.tpl.checked ? TEMPLATE.map(function (t) { return { id: uid(), name: t[0], max: t[1] }; }) : [] };
        db.subjects.push(s);
      }
      s.name = f.name.value.trim(); s.code = f.code.value.trim(); s.classIds = ids;
      save(); dlg.close();
      go(isNew || location.hash.indexOf('settings') < 0 ? '#/scores/' + s.id : '#/settings');
    };
    dlg.showModal();
  }

  // ---------- หน้าต่างแก้ไขช่องคะแนน ----------
  function itemDialog(s, it) {
    var isNew = !it;
    dlg.innerHTML = '<form method="dialog"><h2>' + (isNew ? 'เพิ่มช่องคะแนน' : 'แก้ไขช่องคะแนน') + '</h2>' +
      '<p class="muted">ช่องคะแนนของวิชา ' + h(subjName(s)) + ' ใช้ร่วมกันทุกห้องที่สอน</p>' +
      '<label>ชื่อช่องคะแนน<input type="text" name="name" required value="' + h(it ? it.name : '') + '" placeholder="เช่น ใบงานที่ 1"></label>' +
      '<label>คะแนนเต็ม<input type="number" name="max" required min="0.5" step="0.5" value="' + (it ? it.max : 10) + '"></label>' +
      '<p class="err" hidden></p><div class="actions">' +
      (isNew ? '' : '<button type="button" class="danger left" data-act="del">ลบช่องนี้</button><button type="button" data-act="left">ย้ายไปซ้าย</button><button type="button" data-act="right">ย้ายไปขวา</button>') +
      '<button type="button" data-act="cancel">ยกเลิก</button><button class="primary" type="submit">' + (isNew ? 'เพิ่มช่องคะแนน' : 'บันทึก') + '</button></div></form>';
    var f = dlg.querySelector('form'), err = f.querySelector('.err');
    function done() { save(); dlg.close(); route(); }
    f.querySelector('[data-act="cancel"]').onclick = function () { dlg.close(); };
    if (!isNew) {
      var idx = s.items.indexOf(it);
      f.querySelector('[data-act="del"]').onclick = function () {
        if (!confirm('ลบช่อง “' + it.name + '” พร้อมคะแนนในช่องนี้ของทุกห้อง ลบเลยไหม')) return;
        s.items.splice(idx, 1);
        var sc = db.scores[s.id] || {}; Object.keys(sc).forEach(function (code) { delete sc[code][it.id]; });
        cloudPutScores(s.id);
        done();
      };
      f.querySelector('[data-act="left"]').onclick = function () { if (idx > 0) { s.items.splice(idx, 1); s.items.splice(idx - 1, 0, it); } done(); };
      f.querySelector('[data-act="right"]').onclick = function () { if (idx < s.items.length - 1) { s.items.splice(idx, 1); s.items.splice(idx + 1, 0, it); } done(); };
    }
    f.onsubmit = function (e) {
      e.preventDefault();
      var max = parseFloat(f.max.value);
      if (!(max > 0)) { err.hidden = false; err.textContent = 'คะแนนเต็มต้องมากกว่า 0'; return; }
      if (!isNew) {
        var over = 0, sc = db.scores[s.id] || {};
        Object.keys(sc).forEach(function (code) { if (sc[code][it.id] > max) over++; });
        if (over) { err.hidden = false; err.textContent = 'มีนักเรียน ' + over + ' คนได้คะแนนช่องนี้เกิน ' + fmt(max) + ' แก้คะแนนก่อนแล้วค่อยลดคะแนนเต็ม'; return; }
      } else { it = { id: uid() }; s.items.push(it); }
      it.name = f.name.value.trim(); it.max = max;
      done();
    };
    dlg.showModal();
    f.name.focus();
  }

  // ---------- ส่งออก ----------
  function download(name, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportCsv(s, cls) {
    function q(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var rows = [['เลขที่', 'รหัสนักเรียน', 'ชื่อ สกุล'].concat(s.items.map(function (it) { return it.name + ' (' + fmt(it.max) + ')'; }), ['รวม', 'ร้อยละ', 'เกรด'])];
    cls.students.forEach(function (st) {
      var m = summary(s, st.code);
      rows.push([st.no, st.code, st.name].concat(s.items.map(function (it) { var v = getScore(s.id, st.code, it.id); return v === null ? '' : fmt(v); }),
        [m.done ? fmt(m.total) : '', m.complete ? fmt(m.pct) : '', m.grade === null ? '' : m.grade]));
    });
    download('คะแนน ' + subjName(s) + ' ' + cls.name.replace('/', '-') + '.csv', '﻿' + rows.map(function (r) { return r.map(q).join(','); }).join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ---------- ค้นหานักเรียน ----------
  var q = document.getElementById('q'), qres = document.getElementById('qres');
  q.addEventListener('input', function () {
    var t = q.value.trim().toLowerCase();
    if (!t) { qres.hidden = true; return; }
    var hits = Object.keys(stuByCode).map(function (k) { return stuByCode[k]; })
      .filter(function (s) { return s.name.toLowerCase().indexOf(t) >= 0 || s.code.indexOf(t) === 0; }).slice(0, 8);
    qres.innerHTML = hits.length ? hits.map(function (s) {
      return '<li><a href="#/student/' + s.code + '"><span>' + h(s.name) + '</span><span class="muted">' + classById[s.classId].name + ' เลขที่ ' + s.no + '</span></a></li>';
    }).join('') : '<li class="none">ไม่พบนักเรียนที่ตรงกับ “' + h(q.value.trim()) + '”</li>';
    qres.hidden = false;
  });
  q.addEventListener('keydown', function (e) {
    var first = qres.querySelector('a');
    if (e.key === 'Enter' && first && !qres.hidden) { location.hash = first.getAttribute('href'); }
    if (e.key === 'Escape') { q.value = ''; qres.hidden = true; }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.search')) qres.hidden = true; });
  window.addEventListener('hashchange', function () { q.value = ''; qres.hidden = true; route(); });
  window.addEventListener('pagehide', function () { flushMain(); flushPatches(); });
  window.addEventListener('online', status); window.addEventListener('offline', status);

  // ---------- ติดตั้งเป็นแอป ----------
  var installEvt = null;
  function standalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); installEvt = e;
    var b = document.getElementById('install'), how = document.getElementById('install-how');
    if (b) b.hidden = false; if (how) how.hidden = true;
  });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});

  // ---------- ล็อกอิน ----------
  function box(title, body) { app.innerHTML = '<div class="login"><div class="panel"><h1>' + title + '</h1>' + body + '</div></div>'; }
  function viewLogin(signup) {
    app.innerHTML = '<div class="login"><form class="panel" id="login"><h1>' + (signup ? 'สมัครใช้งาน' : 'เข้าสู่ระบบ') + '</h1>' +
      (signup ? '<p class="muted">สร้างบัญชีใหม่ด้วยอีเมลของคุณครู แต่ละบัญชีมีสมุดคะแนนของตัวเอง</p>' : '') +
      '<label>อีเมล<input type="email" name="email" required autocomplete="username"></label>' +
      '<label>รหัสผ่าน' + (signup ? ' (อย่างน้อย 6 ตัว)' : '') + '<input type="password" name="password" required minlength="6" autocomplete="' + (signup ? 'new-password' : 'current-password') + '"></label>' +
      (signup ? '<label>ยืนยันรหัสผ่าน<input type="password" name="password2" required autocomplete="new-password"></label>' : '') +
      '<p class="err" hidden></p><p class="ok" hidden></p>' +
      '<div class="row"><button class="primary" type="submit">' + (signup ? 'สมัครใช้งาน' : 'เข้าสู่ระบบ') + '</button>' +
      (signup ? '' : '<button type="button" class="plain" id="forgot">ลืมรหัสผ่าน</button>') + '</div>' +
      '<p class="switch">' + (signup ? 'มีบัญชีอยู่แล้ว' : 'ยังไม่มีบัญชี') + ' <button type="button" id="swap">' + (signup ? 'เข้าสู่ระบบ' : 'สมัครใช้งาน') + '</button></p></form></div>';
    var f = document.getElementById('login'), err = f.querySelector('.err'), ok = f.querySelector('.ok'), btn = f.querySelector('[type=submit]');
    function say(el, text) { err.hidden = ok.hidden = true; el.hidden = false; el.textContent = text; }
    function explain(e) {
      var c = (e && e.code) || '';
      if (/invalid-credential|wrong-password|user-not-found/.test(c)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
      if (/invalid-email/.test(c)) return 'รูปแบบอีเมลไม่ถูกต้อง';
      if (/email-already-in-use/.test(c)) return 'อีเมลนี้มีบัญชีอยู่แล้ว ให้กด “เข้าสู่ระบบ” หรือ “ลืมรหัสผ่าน”';
      if (/weak-password/.test(c)) return 'รหัสผ่านสั้นเกินไป ต้องมีอย่างน้อย 6 ตัว';
      if (/too-many-requests/.test(c)) return 'ลองผิดหลายครั้งเกินไป รอสักครู่แล้วลองใหม่';
      if (/network-request-failed/.test(c)) return 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบการเชื่อมต่อแล้วลองใหม่';
      if (/operation-not-allowed|configuration-not-found|admin-restricted/.test(c)) return 'โปรเจกต์ Firebase ยังไม่ได้เปิดการสมัครหรือล็อกอินด้วยอีเมล/รหัสผ่าน (ดูขั้นตอนใน README)';
      if (/unauthorized-domain/.test(c)) return 'ยังไม่ได้เพิ่มโดเมนของเว็บนี้ใน Authorized domains ของ Firebase (ดูขั้นตอนใน README)';
      return (signup ? 'สมัครใช้งานไม่สำเร็จ (' : 'เข้าสู่ระบบไม่สำเร็จ (') + (c || 'ไม่ทราบสาเหตุ') + ')';
    }
    f.onsubmit = function (e) {
      e.preventDefault(); err.hidden = ok.hidden = true;
      if (signup && f.password.value !== f.password2.value) { say(err, 'รหัสผ่านสองช่องไม่ตรงกัน'); f.password2.focus(); return; }
      btn.disabled = true;
      var email = f.email.value.trim();
      (signup ? cloud.signUp(email, f.password.value) : cloud.signIn(email, f.password.value))
        .catch(function (er) { btn.disabled = false; say(err, explain(er)); });
    };
    document.getElementById('swap').onclick = function () { viewLogin(!signup); };
    var fg = document.getElementById('forgot');
    if (fg) fg.onclick = function () {
      var email = f.email.value.trim();
      if (!email) { say(err, 'ใส่อีเมลก่อน แล้วกด “ลืมรหัสผ่าน” อีกครั้ง'); f.email.focus(); return; }
      cloud.resetPassword(email).then(function () { say(ok, 'ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ' + email + ' แล้ว'); }, function (er) { say(err, explain(er)); });
    };
  }

  // อัปเดตหน้าจอเมื่อมีข้อมูลเปลี่ยนจากเครื่องอื่น (ไม่ทำระหว่างที่กำลังพิมพ์หรือเปิดหน้าต่างแก้ไขอยู่)
  var refreshTimer = 0;
  function refresh() {
    if (!cloudReady) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      var a = document.activeElement;
      if (dlg.open || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      route(true);
    }, 200);
  }

  // ครั้งแรกที่ล็อกอิน: ถ้าเครื่องนี้มีข้อมูลที่เคยเก็บไว้ในเครื่อง ให้ย้ายขึ้นคลาวด์
  function migrateLocal() {
    var d = loadLocal();
    var n = d.subjects.length + Object.keys(d.notes).length + Object.keys(localPhotos).length;
    if (!n || localStorage.getItem(KEY + ':keep-cloud')) return;
    function upload() {
      var prev = prevIds();
      db = d; photos = localPhotos; localPhotos = {};
      cloudReplaceAll(prev.sids, prev.codes);
      localStorage.removeItem(KEY); if (idb) photoStore('readwrite').clear();
      route();
    }
    cloud.remoteHasData().then(function (has) {
      if (!has) { upload(); return; }
      dlg.innerHTML = '<form method="dialog"><h2>เครื่องนี้มีข้อมูลที่ยังไม่ได้ขึ้นคลาวด์</h2>' +
        '<p>เครื่องนี้มีข้อมูลที่กรอกไว้ก่อนเปิดใช้ระบบล็อกอิน (' + d.subjects.length + ' วิชา รูปนักเรียน ' + Object.keys(localPhotos).length + ' คน) และบัญชีนี้ก็มีข้อมูลบนคลาวด์อยู่แล้ว เลือกชุดที่จะใช้ต่อ</p>' +
        '<div class="actions"><button type="button" data-act="local" class="danger">ใช้ข้อมูลในเครื่องนี้แทนที่บนคลาวด์</button><button type="button" data-act="cloud" class="primary">ใช้ข้อมูลบนคลาวด์</button></div></form>';
      dlg.querySelector('[data-act="cloud"]').onclick = function () { localStorage.setItem(KEY + ':keep-cloud', '1'); dlg.close(); };
      dlg.querySelector('[data-act="local"]').onclick = function () { dlg.close(); upload(); };
      dlg.showModal();
    }, function () { /* ออฟไลน์อยู่ ไว้ถามใหม่ครั้งหน้า */ });
  }

  function startCloud() {
    document.body.classList.add('locked');
    box('กำลังเชื่อมต่อ', '<p class="muted">รอสักครู่</p>');
    import('./cloud.js').then(function (m) {
      cloud = m;
      m.init(CONFIG, {
        auth: function (u) {
          cloudUser = u; cloudReady = false; cloudErr = ''; db = blank(); photos = {};
          lastMain = ''; mainDirty = false; patchQ = {};
          document.body.classList.toggle('locked', !u); status(); stopShaders();
          if (u) box('กำลังโหลดข้อมูล', '<p class="muted">' + h(u.email) + '</p>'); else viewLogin();
        },
        main: function (data, pend) {
          if (mainDirty) return; // ในเครื่องมีการแก้ไขที่ใหม่กว่า กำลังจะส่งขึ้นไป
          data = data || {};
          db.subjects = data.subjects || []; db.notes = data.notes || {}; db.lastBackup = data.lastBackup || null;
          lastMain = JSON.stringify(mainObj());
          if (!pend) refresh();
        },
        scores: function (sid, map, pend) {
          if (map === null) delete db.scores[sid];
          else {
            db.scores[sid] = map;
            var q = patchQ[sid] || {}; // ทับด้วยคะแนนที่เพิ่งกรอกและยังไม่ได้ส่ง
            Object.keys(q).forEach(function (code) { Object.keys(q[code]).forEach(function (iid) { putLocal(sid, code, iid, q[code][iid]); }); });
          }
          if (!pend) refresh();
        },
        photo: function (code, data, pend) { if (data) photos[code] = data; else delete photos[code]; if (!pend) refresh(); },
        ready: function () { cloudReady = true; route(); migrateLocal(); },
        error: function (code) {
          cloudErr = code; status();
          if (!cloudReady) box('อ่านข้อมูลจากคลาวด์ไม่ได้', '<p>รหัสข้อผิดพลาด: ' + h(code) + '</p><p>ถ้าเป็น permission-denied ให้ตรวจสอบ Rules ของ Firestore ตามขั้นตอนใน README</p>' +
            '<div class="row"><button id="retry" class="primary">ลองใหม่</button><button id="out">ออกจากระบบ</button></div>');
          var r = document.getElementById('retry'), o = document.getElementById('out');
          if (r) r.onclick = function () { location.reload(); };
          if (o) o.onclick = function () { cloud.signOut(); };
        }
      });
    }, function () {
      box('โหลดระบบล็อกอินไม่ได้', '<p>ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่</p><div class="row"><button id="retry" class="primary">ลองใหม่</button></div>');
      document.getElementById('retry').onclick = function () { location.reload(); };
    });
  }

  photosLoad(function () {
    if (!CONFIG) { route(); return; }
    localPhotos = photos; photos = {};
    startCloud();
  });
})();
