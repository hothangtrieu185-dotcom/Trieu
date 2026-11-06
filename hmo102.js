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
  const fresh = () => ({ roster: [], joined: {}, round: null, ratings: {}, updatedAt: Date.now() });
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
  const roundOpen = () => !!(H.round && H.round.open && Date.now() <= H.round.endsAt + 4000);
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
  const groupJoined = (g) => members(g).filter((m) => H.joined[m.mssv]).length;
  function studentView(u) {
    const g = u.group, ms = members(g);
    const v = { now: Date.now(), crit: CRIT, me: { mssv: u.mssv, name: u.name, group: g }, joined: groupJoined(g), total: ms.length, allJoined: Object.keys(H.joined).filter((m) => byMssv(m)).length, allTotal: H.roster.length, round: null };
    if (H.round) {
      const R = H.round;
      v.round = { g: R.g, mine: R.g === g, startsAt: R.startsAt, endsAt: R.endsAt, open: roundOpen() };
      if (R.g === g) {
        v.round.members = ms.map((m) => ({ mssv: m.mssv, name: m.name }));
        const mine = (H.ratings[g] || {})[u.mssv]; v.round.mine_rating = mine || null;
        v.round.submitted = Object.keys(H.ratings[g] || {}).length;
      }
    }
    return v;
  }
  function screenView() {
    const gs = groupIds();
    const v = { now: Date.now(), joined: Object.keys(H.joined).filter((m) => byMssv(m)).length, total: H.roster.length, round: null,
      groups: gs.map((g) => ({ g, joined: groupJoined(g), total: members(g).length })),
      bubbles: Object.entries(H.joined).filter(([m]) => byMssv(m)).sort((a, b) => a[1].at - b[1].at).map(([m]) => ({ t: (byMssv(m).name.trim().split(/\s+/).pop() || '?').charAt(0).toUpperCase(), g: byMssv(m).group })) };
    if (H.round) v.round = { g: H.round.g, startsAt: H.round.startsAt, endsAt: H.round.endsAt, open: roundOpen(), submitted: Object.keys(H.ratings[H.round.g] || {}).length, total: members(H.round.g).length };
    return v;
  }
  function adminView() {
    const gs = groupIds();
    return { now: Date.now(), configured: !!TOKEN, round: H.round && Object.assign({}, H.round, { open: roundOpen() }), total: H.roster.length,
      groups: gs.map((g) => Object.assign(calc(g), { list: members(g).map((m) => ({ mssv: m.mssv, name: m.name, leader: !!m.leader, joined: !!H.joined[m.mssv], submitted: !!(H.ratings[g] || {})[m.mssv] })) })) };
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

  const PAGES = { '/hmo102': 'index.html', '/hmo102/admin': 'admin.html', '/hmo102/screen': 'screen.html', '/hmo102/h.css': 'h.css', '/hmo102/doodle.js': 'doodle.js', '/hmo102/common.js': 'common.js' };
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
      const svg = await QRCode.toString(base + '/hmo102', { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); res.end(svg); return true;
    }
    if (p === '/api/h/join' && req.method === 'POST') {
      const b = await readJson(req);
      if (!H.roster.length) { fail(res, 409, 'Giảng viên chưa mở phòng chờ. Vui lòng chờ.'); return true; }
      const mssv = String(b.mssv || '').trim().toUpperCase(), name = String(b.name || '').trim();
      if (!mssv || !name) { fail(res, 400, 'Vui lòng nhập đủ MSSV và họ tên.'); return true; }
      const u = byMssv(mssv);
      if (!u) { fail(res, 404, 'MSSV này không có trong danh sách chấm chéo. Kiểm tra lại MSSV.'); return true; }
      if (norm(u.name) !== norm(name)) { fail(res, 403, 'Họ tên không khớp với MSSV. Hãy nhập đúng họ tên có dấu như trong danh sách lớp.'); return true; }
      let j = H.joined[mssv]; if (!j) { j = H.joined[mssv] = { token: crypto.randomBytes(16).toString('hex'), at: Date.now() }; save(); }
      send(res, 200, Object.assign({ token: j.token }, studentView(u))); return true;
    }
    if (p === '/api/h/state') { const u = userFromReq(req); if (u) send(res, 200, studentView(u)); else fail(res, 401, 'Phiên không hợp lệ.'); return true; }
    if (p === '/api/h/screen') { send(res, 200, screenView()); return true; }
    if (p === '/api/h/rate' && req.method === 'POST') {
      const u = userFromReq(req); if (!u) { fail(res, 401, 'Phiên không hợp lệ. Vào lại từ mã QR.'); return true; }
      if (!H.round || H.round.g !== u.group) { fail(res, 409, 'Nhóm của bạn hiện chưa được mở chấm.'); return true; }
      if (Date.now() < H.round.startsAt - 500) { fail(res, 409, 'Chưa đến giờ chấm.'); return true; }
      if (!roundOpen()) { fail(res, 409, 'Đã hết giờ hoặc giảng viên đã đóng chấm.'); return true; }
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
    const b = await readJson(req);
    if (p === '/api/h/admin/start') {
      const g = Number(b.g), mins = Number(b.minutes);
      if (!groupIds().includes(g)) { fail(res, 400, 'Chọn nhóm cần chấm.'); return true; }
      if (![5, 10, 15, 20].includes(mins)) { fail(res, 400, 'Chọn 5, 10, 15 hoặc 20 phút.'); return true; }
      const s = Date.now() + 3000;
      H.round = { g, minutes: mins, startsAt: s, endsAt: s + mins * 60000, open: true }; save(); send(res, 200, { ok: true }); return true;
    }
    if (p === '/api/h/admin/extend') {
      if (!H.round) { fail(res, 409, 'Chưa có lượt chấm.'); return true; }
      H.round.endsAt = Math.max(H.round.endsAt, Date.now()) + (Number(b.minutes) || 5) * 60000; H.round.open = true; save(); send(res, 200, { ok: true }); return true;
    }
    if (p === '/api/h/admin/stop') { if (H.round) { H.round.open = false; H.round.endsAt = Math.min(H.round.endsAt, Date.now()); } save(); send(res, 200, { ok: true }); return true; }
    if (p === '/api/h/admin/lobby') { H.round = null; save(); send(res, 200, { ok: true }); return true; }   // quay về phòng chờ để chọn nhóm khác
    if (p === '/api/h/admin/clear') {   // xóa điểm một nhóm để chấm lại
      const g = Number(b.g); if (b.confirm !== 'XOA') { fail(res, 400, 'Cần xác nhận.'); return true; }
      delete H.ratings[g]; save(); send(res, 200, { ok: true }); return true;
    }
    if (p === '/api/h/admin/reset') {   // đăng xuất toàn bộ bạn trong phòng chờ (giữ điểm)
      H.joined = {}; H.round = null; save(); send(res, 200, { ok: true }); return true;
    }
    fail(res, 404, 'Không tìm thấy.'); return true;
  };
};
