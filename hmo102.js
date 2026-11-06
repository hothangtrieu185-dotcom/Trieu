'use strict';
// Chấm chéo trong nhóm HMO102: phòng chờ, định danh bằng MSSV + họ tên, giảng viên bấm bắt đầu và đếm ngược.
// Chạy chung máy chủ với hệ thống chấm điểm SSA101, các đường dẫn riêng: /hmo102, /hmo102/admin, /hmo102/screen, /api/h/*
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CRIT = [
  { k: 'rep', name: 'Nội dung báo cáo' },
  { k: 'pre', name: 'Slide và thuyết trình' },
  { k: 'res', name: 'Trách nhiệm và đúng hạn' },
  { k: 'col', name: 'Hợp tác và giao tiếp' },
];
const LO = 0.8, HI = 1.1;

module.exports = function init({ ExcelJS, QRCode, parseRoster, DATA_DIR }) {
  const PASSWORD = process.env.HMO102_PASSWORD || '';
  const TOKEN = PASSWORD ? crypto.createHmac('sha256', PASSWORD).update('hmo102-admin').digest('hex') : null;
  const FILE = path.join(DATA_DIR, 'hmo102-state.json');
  const fresh = () => ({ roster: [], joined: {}, session: null, ratings: {}, updatedAt: Date.now() });
  let H = fresh();
  try { H = Object.assign(fresh(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* trạng thái mới */ }
  let timer = null;
  const save = () => {
    H.updatedAt = Date.now(); clearTimeout(timer);
    timer = setTimeout(() => { const t = FILE + '.tmp'; fs.writeFile(t, JSON.stringify(H), (er) => { if (!er) fs.rename(t, FILE, () => {}); }); }, 200);
  };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  const r2 = (x) => Math.round(x * 100) / 100;
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const fail = (res, code, msg) => send(res, code, { error: msg });
  const readBody = (req, limit = 8e6) => new Promise((ok, no) => {
    const ch = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { no(new Error('Dữ liệu quá lớn')); req.destroy(); } else ch.push(c); });
    req.on('end', () => ok(Buffer.concat(ch))); req.on('error', no);
  });
  const readJson = async (req) => { try { return JSON.parse((await readBody(req, 2e6)).toString() || '{}'); } catch { return {}; } };

  const groupIds = () => [...new Set(H.roster.map((r) => r.group))].sort((a, b) => a - b);
  const members = (g) => H.roster.filter((r) => r.group === g);
  const byMssv = (m) => H.roster.find((r) => r.mssv === m);
  const userFromReq = (req) => { const t = req.headers['x-token']; if (!t) return null; const e = Object.entries(H.joined).find(([, v]) => v.token === t); return e ? byMssv(e[0]) || null : null; };
  const runOpen = () => !!(H.session && H.session.status === 'running' && Date.now() <= H.session.endsAt + 4000);
  const newCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 6; i++) c += A[crypto.randomInt(A.length)]; return c; };
  const adminOk = (req) => TOKEN && (req.headers.authorization || '') === 'Bearer ' + TOKEN;

  // ---- tính điểm một nhóm ----
  function calc(g) {
    const ms = members(g), sub = H.ratings[g] || {};
    const raters = Object.keys(sub).filter((m) => ms.some((x) => x.mssv === m));
    const recv = {}; ms.forEach((m) => { recv[m.mssv] = []; });
    const selfAvg = {};
    raters.forEach((rm) => {
      const rec = sub[rm].v || {};
      Object.entries(rec).forEach(([tm, a]) => {
        if (!Array.isArray(a)) return;
        const nums = a.slice(0, 4).map(Number);
        if (tm === rm) { selfAvg[rm] = r2(nums.reduce((s, x) => s + x, 0) / 4); return; }
        if (recv[tm]) recv[tm].push({ rater: rm, nums, comment: String(a[4] || ''), at: sub[rm].at });
      });
    });
    const all = []; Object.values(recv).forEach((l) => l.forEach((x) => all.push(...x.nums)));
    const gAvg = all.length ? all.reduce((s, x) => s + x, 0) / all.length : 0;
    const rows = ms.map((m) => {
      const l = recv[m.mssv], n = l.length;
      const crit = CRIT.map((c, i) => (n ? r2(l.reduce((s, x) => s + x.nums[i], 0) / n) : null));
      const avg = n ? r2(l.reduce((s, x) => s + x.nums.reduce((a, b) => a + b, 0) / 4, 0) / n) : null;
      const coef = n && gAvg ? r2(Math.min(HI, Math.max(LO, avg / gAvg))) : null;
      return { mssv: m.mssv, name: m.name, leader: !!m.leader, n, crit, avg, coef, self: selfAvg[m.mssv] == null ? null : selfAvg[m.mssv], comments: l.map((x) => ({ rater: (byMssv(x.rater) || {}).name || x.rater, low: x.nums.some((v) => v < 3), text: x.comment, nums: x.nums })).filter((x) => x.text) };
    });
    const flags = [];
    raters.forEach((rm) => {
      const rec = sub[rm].v || {}; const nums = [];
      Object.entries(rec).forEach(([tm, a]) => { if (tm !== rm && Array.isArray(a)) nums.push(...a.slice(0, 4).map(Number)); });
      if (nums.length >= 8 && nums.every((x) => x === nums[0])) flags.push({ type: 'same', who: (byMssv(rm) || {}).name, text: 'chấm cùng một điểm (' + nums[0] + ') cho mọi người và mọi tiêu chí' });
    });
    ms.forEach((m) => {
      const l = recv[m.mssv]; if (l.length < 3) return;
      const av = l.map((x) => x.nums.reduce((a, b) => a + b, 0) / 4);
      l.forEach((x, i) => {
        const others = av.filter((_, j) => j !== i); const mo = others.reduce((a, b) => a + b, 0) / others.length;
        if (Math.abs(av[i] - mo) >= 1.5) flags.push({ type: 'dev', who: (byMssv(x.rater) || {}).name, text: 'chấm ' + m.name + ' ' + r2(av[i]) + ', lệch ' + r2(Math.abs(av[i] - mo)) + ' so với các bạn khác (' + r2(mo) + ')' });
      });
    });
    const missing = ms.filter((m) => !raters.includes(m.mssv)).map((m) => m.name);
    return { g, rows, flags, missing, gAvg: r2(gAvg), raters: raters.length, total: ms.length };
  }

  // ---- view ----
  const loggedCount = (g) => members(g).filter((m) => H.joined[m.mssv]).length;
  const inRoomCount = () => (H.session ? Object.keys(H.session.room).length : 0);
  const submittedCount = (g) => Object.keys(H.ratings[g] || {}).length;
  function studentView(u) {
    const g = u.group, ms = members(g), S = H.session;
    const v = { now: Date.now(), crit: CRIT, me: { mssv: u.mssv, name: u.name, group: g }, logged: loggedCount(g), total: ms.length, session: null };
    if (S) {
      const mine = S.g === g;
      v.session = { id: S.id, g: S.g, mine, status: S.status, startsAt: S.startsAt, endsAt: S.endsAt, open: runOpen(), inRoom: mine && !!S.room[u.mssv] };
      if (mine) {
        v.session.roomCount = inRoomCount();
        if (v.session.inRoom) {
          v.session.members = ms.map((m) => ({ mssv: m.mssv, name: m.name }));
          v.session.mine_rating = (H.ratings[g] || {})[u.mssv] || null;
        }
      }
    }
    return v;
  }
  function screenView() {
    const S = H.session;
    const v = { now: Date.now(), roster: H.roster.length, logged: Object.keys(H.joined).filter((m) => byMssv(m)).length, session: null };
    if (S) {
      v.session = { g: S.g, status: S.status, startsAt: S.startsAt, endsAt: S.endsAt, open: runOpen(), inRoom: inRoomCount(), total: members(S.g).length, submitted: submittedCount(S.g),
        bubbles: Object.entries(S.room).sort((a, b) => a[1] - b[1]).map(([m]) => (byMssv(m).name.trim().split(/\s+/).pop() || '?').charAt(0).toUpperCase()) };
    }
    return v;
  }
  function adminView() {
    const S = H.session;
    return { now: Date.now(), configured: !!TOKEN, total: H.roster.length,
      session: S && Object.assign({}, S, { open: runOpen(), inRoom: inRoomCount(), submitted: submittedCount(S.g) }),
      hasResults: Object.keys(H.ratings).some((g) => submittedCount(g) > 0),
      groups: groupIds().map((g) => Object.assign(calc(g), { list: members(g).map((m) => ({ mssv: m.mssv, name: m.name, leader: !!m.leader, logged: !!H.joined[m.mssv], inRoom: !!(S && S.g === g && S.room[m.mssv]), submitted: !!(H.ratings[g] || {})[m.mssv] })) })) };
  }

  async function report() {
    const wb = new ExcelJS.Workbook(); wb.creator = 'Chấm chéo HMO102';
    const head = (ws) => { ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A1630' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
    const gs = groupIds(), cs = gs.map(calc);
    const w1 = wb.addWorksheet('Tổng hợp');
    w1.columns = [{ header: 'Nhóm', key: 'g', width: 8 }, { header: 'MSSV', key: 'm', width: 12 }, { header: 'Họ tên', key: 'n', width: 28 }, { header: 'Số bạn chấm', key: 'c', width: 12 },
      ...CRIT.map((c) => ({ header: c.name, key: c.k, width: 18 })), { header: 'TB nhận được', key: 'a', width: 14 }, { header: 'TB cả nhóm', key: 'ga', width: 12 }, { header: 'Hệ số điều chỉnh', key: 'cf', width: 16 }, { header: 'Tự đánh giá (không tính)', key: 's', width: 22 }];
    cs.forEach((c) => c.rows.forEach((r) => w1.addRow({ g: c.g, m: r.mssv, n: r.name, c: r.n, rep: r.crit[0], pre: r.crit[1], res: r.crit[2], col: r.crit[3], a: r.avg, ga: c.gAvg, cf: r.coef, s: r.self })));
    head(w1);
    const w2 = wb.addWorksheet('Chi tiết');
    w2.columns = [{ header: 'Nhóm', key: 'g', width: 8 }, { header: 'MSSV người chấm', key: 'rm', width: 16 }, { header: 'Người chấm', key: 'rn', width: 26 }, { header: 'MSSV được chấm', key: 'tm', width: 16 }, { header: 'Được chấm', key: 'tn', width: 26 },
      ...CRIT.map((c) => ({ header: c.name, key: c.k, width: 14 })), { header: 'Nhận xét', key: 'cm', width: 60 }, { header: 'Giờ nộp', key: 'at', width: 20 }];
    gs.forEach((g) => Object.entries(H.ratings[g] || {}).forEach(([rm, s]) => Object.entries(s.v || {}).forEach(([tm, a]) => {
      w2.addRow({ g, rm, rn: (byMssv(rm) || {}).name, tm, tn: (byMssv(tm) || {}).name + (tm === rm ? ' (tự đánh giá)' : ''), rep: a[0], pre: a[1], res: a[2], col: a[3], cm: a[4] || '', at: new Date(s.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) });
    })));
    head(w2);
    const w3 = wb.addWorksheet('Cảnh báo và chưa nộp');
    w3.columns = [{ header: 'Nhóm', key: 'g', width: 8 }, { header: 'Loại', key: 't', width: 16 }, { header: 'Nội dung', key: 'x', width: 90 }];
    cs.forEach((c) => { c.flags.forEach((f) => w3.addRow({ g: c.g, t: 'Cảnh báo', x: f.who + ' ' + f.text })); c.missing.forEach((n) => w3.addRow({ g: c.g, t: 'Chưa nộp', x: n })); });
    head(w3);
    return wb.xlsx.writeBuffer();
  }

  function normalizeSubmission(g, rm, b) {
    const ms = members(g), v = {};
    for (const m of ms) {
      const a = (b.r || {})[m.mssv] || (m.mssv === rm ? b.self : null);
      if (m.mssv === rm) { // tự đánh giá: không bắt buộc
        if (Array.isArray(a) && a.slice(0, 4).every((x) => Number.isInteger(+x) && +x >= 1 && +x <= 5)) v[m.mssv] = [...a.slice(0, 4).map(Number), String(a[4] || '').slice(0, 500)];
        continue;
      }
      if (!Array.isArray(a)) return { error: 'Thiếu phần chấm cho ' + m.name + '.' };
      const nums = a.slice(0, 4).map(Number);
      if (nums.length < 4 || !nums.every((x) => Number.isInteger(x) && x >= 1 && x <= 5)) return { error: 'Điểm của ' + m.name + ' chưa hợp lệ (1 đến 5 cho cả 4 tiêu chí).' };
      const cm = String(a[4] || '').trim().slice(0, 500);
      if (nums.some((x) => x < 3) && cm.length < 10) return { error: 'Cần nhận xét ít nhất 10 ký tự khi chấm dưới 3 cho ' + m.name + '.' };
      v[m.mssv] = [...nums, cm];
    }
    return { v };
  }

  const PAGES = { '/hmo102': 'index.html', '/hmo102/admin': 'admin.html', '/hmo102/screen': 'screen.html', '/hmo102/screen.css': 'screen.css', '/hmo102/h.css': 'h.css', '/hmo102/doodle.js': 'doodle.js', '/hmo102/common.js': 'common.js' };
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

  return async function handle(req, res, url) {
    const p = url.pathname;
    if (PAGES[p]) {
      const f = PAGES[p];
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)], 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', 'h', f))); return true;
    }
    if (p === '/hmo102/') { res.writeHead(302, { Location: '/hmo102' }); res.end(); return true; }
    if (!p.startsWith('/api/h/') && p !== '/h/qr.svg') return false;
    if (p === '/h/qr.svg') {
      const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
      const base = process.env.PUBLIC_URL || `${proto}://${req.headers.host}`;
      const S = H.session, room = url.searchParams.get('mode') === 'room';
      if (room && !(S && S.status !== 'ended')) { res.writeHead(404); res.end(); return true; }
      const svg = await QRCode.toString(room ? `${base}/hmo102?r=${S.code}` : `${base}/hmo102`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); res.end(svg); return true;
    }
    // ---- sinh viên ----
    if (p === '/api/h/join' && req.method === 'POST') {   // đăng nhập: nhận nhóm theo MSSV + họ tên
      const b = await readJson(req);
      if (!H.roster.length) { fail(res, 409, 'Giảng viên chưa nạp danh sách. Vui lòng chờ.'); return true; }
      const mssv = String(b.mssv || '').trim().toUpperCase(), name = String(b.name || '').trim();
      if (!mssv || !name) { fail(res, 400, 'Vui lòng nhập đủ MSSV và họ tên.'); return true; }
      const u = byMssv(mssv);
      if (!u) { fail(res, 404, 'MSSV này không có trong danh sách chấm chéo. Kiểm tra lại MSSV.'); return true; }
      if (norm(u.name) !== norm(name)) { fail(res, 403, 'Họ tên không khớp với MSSV. Hãy nhập đúng họ tên có dấu như trong danh sách lớp.'); return true; }
      let j = H.joined[mssv]; if (!j) { j = H.joined[mssv] = { token: crypto.randomBytes(16).toString('hex'), at: Date.now() }; save(); }
      send(res, 200, Object.assign({ token: j.token }, studentView(u))); return true;
    }
    if (p === '/api/h/state') { const u = userFromReq(req); if (u) send(res, 200, studentView(u)); else fail(res, 401, 'Phiên không hợp lệ.'); return true; }
    if (p === '/api/h/leave' && req.method === 'POST') {   // đăng xuất: rời phòng chờ nếu chưa bắt đầu chấm
      const u = userFromReq(req); if (!u) { send(res, 200, { ok: true }); return true; }
      const S = H.session;
      if (!S || S.status !== 'running') { if (S && S.room) delete S.room[u.mssv]; delete H.joined[u.mssv]; save(); }
      send(res, 200, { ok: true }); return true;
    }
    if (p === '/api/h/screen') { send(res, 200, screenView()); return true; }
    if (p === '/api/h/enter' && req.method === 'POST') {   // quét QR: vào phòng chờ
      const u = userFromReq(req); if (!u) { fail(res, 401, 'Hãy đăng nhập bằng MSSV và họ tên trước.'); return true; }
      const b = await readJson(req), S = H.session;
      if (!S || S.status === 'ended') { fail(res, 409, 'Chưa có phòng chờ đang mở. Đợi giảng viên tạo mã QR.'); return true; }
      if (S.g !== u.group) { fail(res, 403, 'Phòng chờ này dành cho Nhóm ' + S.g + '. Nhóm của bạn (Nhóm ' + u.group + ') chưa đến lượt.'); return true; }
      if (String(b.code || '').trim().toUpperCase() !== S.code) { fail(res, 403, 'Mã phòng không đúng. Hãy quét lại QR trên màn hình.'); return true; }
      if (!S.room[u.mssv]) { S.room[u.mssv] = Date.now(); save(); }
      send(res, 200, studentView(u)); return true;
    }
    if (p === '/api/h/rate' && req.method === 'POST') {
      const u = userFromReq(req); if (!u) { fail(res, 401, 'Phiên không hợp lệ. Hãy đăng nhập lại.'); return true; }
      const S = H.session;
      if (!S || S.g !== u.group || !S.room[u.mssv]) { fail(res, 409, 'Bạn chưa ở trong phòng chờ của nhóm mình.'); return true; }
      if (S.status !== 'running') { fail(res, 409, S.status === 'ended' ? 'Giảng viên đã kết thúc chấm.' : 'Giảng viên chưa bấm bắt đầu.'); return true; }
      if (Date.now() < S.startsAt - 500) { fail(res, 409, 'Chưa đến giờ chấm.'); return true; }
      if (!runOpen()) { fail(res, 409, 'Đã hết giờ chấm.'); return true; }
      const b = await readJson(req), r = normalizeSubmission(u.group, u.mssv, b);
      if (r.error) { fail(res, 400, r.error); return true; }
      (H.ratings[u.group] = H.ratings[u.group] || {})[u.mssv] = { at: Date.now(), v: r.v };
      save(); send(res, 200, { ok: true, at: Date.now() }); return true;
    }
    // ---- giảng viên ----
    if (p === '/api/h/admin/login' && req.method === 'POST') {
      if (!TOKEN) { fail(res, 503, 'Chưa đặt biến môi trường HMO102_PASSWORD trên máy chủ.'); return true; }
      const b = await readJson(req);
      if (b.password !== PASSWORD) { fail(res, 401, 'Sai mật khẩu.'); return true; }
      send(res, 200, { token: TOKEN }); return true;
    }
    if (!adminOk(req)) { fail(res, 401, 'Cần đăng nhập.'); return true; }
    if (p === '/api/h/admin/state') { send(res, 200, adminView()); return true; }
    if (p === '/api/h/admin/report.xlsx') {
      const buf = await report();
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="HMO102-cham-cheo.xlsx"' });
      res.end(Buffer.from(buf)); return true;
    }
    if (req.method !== 'POST') { fail(res, 405, 'Sai phương thức.'); return true; }
    if (p === '/api/h/admin/roster') {
      let rows; try { rows = await parseRoster(await readBody(req)); } catch (e) { fail(res, 400, 'Không đọc được file: ' + e.message); return true; }
      if (!rows.length) { fail(res, 400, 'File không có sinh viên nào có nhóm.'); return true; }
      H.roster = rows.map((r) => ({ mssv: r.mssv, name: r.name, group: r.group, leader: !!r.leader }));
      Object.keys(H.joined).forEach((m) => { if (!byMssv(m)) delete H.joined[m]; });
      save(); send(res, 200, { ok: true, added: rows.length, groups: groupIds().length }); return true;
    }
    const b = await readJson(req), S = H.session;
    if (p === '/api/h/admin/create') {   // thiết lập nhóm + thời gian, tạo mã QR phòng chờ
      const g = Number(b.g), mins = Number(b.minutes);
      if (S && S.status !== 'ended') { fail(res, 409, 'Đang có một phiên chưa kết thúc.'); return true; }
      if (!groupIds().includes(g)) { fail(res, 400, 'Chọn nhóm cần chấm.'); return true; }
      if (![5, 10, 15, 20].includes(mins)) { fail(res, 400, 'Chọn 5, 10, 15 hoặc 20 phút.'); return true; }
      H.session = { id: Date.now(), g, minutes: mins, code: newCode(), status: 'open', createdAt: Date.now(), startsAt: 0, endsAt: 0, room: {} };
      save(); send(res, 200, { ok: true }); return true;
    }
    if (p === '/api/h/admin/start') {
      if (!S || S.status !== 'open') { fail(res, 409, 'Chưa có phòng chờ đang mở.'); return true; }
      S.status = 'running'; S.startsAt = Date.now() + 5000; S.endsAt = S.startsAt + S.minutes * 60000; save(); send(res, 200, { ok: true }); return true;
    }
    if (p === '/api/h/admin/extend') {
      if (!S || S.status !== 'running') { fail(res, 409, 'Chưa đang chấm.'); return true; }
      S.endsAt = Math.max(S.endsAt, Date.now()) + (Number(b.minutes) || 5) * 60000; save(); send(res, 200, { ok: true }); return true;
    }
    if (p === '/api/h/admin/end') { if (S && S.status !== 'ended') { S.status = 'ended'; S.endsAt = Math.min(S.endsAt || Date.now(), Date.now()); } save(); send(res, 200, { ok: true }); return true; }
    if (p === '/api/h/admin/cancel') { if (S && S.status === 'open') H.session = null; save(); send(res, 200, { ok: true }); return true; }   // hủy phòng chờ chưa bắt đầu
    if (p === '/api/h/admin/next') { if (S && S.status === 'ended') H.session = null; save(); send(res, 200, { ok: true }); return true; }   // chuẩn bị chấm nhóm khác
    if (p === '/api/h/admin/clear') {
      const g = Number(b.g); if (b.confirm !== 'XOA') { fail(res, 400, 'Cần xác nhận.'); return true; }
      delete H.ratings[g]; save(); send(res, 200, { ok: true }); return true;
    }
    if (p === '/api/h/admin/reset') { H.joined = {}; H.session = null; save(); send(res, 200, { ok: true }); return true; }
    fail(res, 404, 'Không tìm thấy.'); return true;
  };
};
