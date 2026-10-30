'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');
const RUBRICS = require('./rubrics');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { console.error('Thiếu biến môi trường ADMIN_PASSWORD'); process.exit(1); }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ADMIN_TOKEN = crypto.createHmac('sha256', ADMIN_PASSWORD).update('admin-token').digest('hex');

// ---------- Trạng thái ----------
const fresh = () => ({
  phase: 'setup',          // setup -> lobby -> grading -> ended
  roster: [],              // {cls, mssv, name, group}
  groups: [],              // {key, cls, group, form, order}
  students: {},            // mssv -> {mssv,name,cls,group,token,joinedAt}
  ratings: [],             // {key, mssv, scores, total, at}
  activeKey: null,
  open: false,
  startsAt: 0,           // mốc bắt đầu chấm (sau đếm ngược 5 giây)
  showLive: true,
  updatedAt: Date.now(),
});
let S = fresh();
try { S = Object.assign(fresh(), JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) { /* trạng thái mới */ }
let saveTimer = null;
function save() {
  S.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(S), (err) => { if (!err) fs.rename(tmp, STATE_FILE, () => {}); });
  }, 200);
}

// ---------- Tiện ích ----------
const r2 = (x) => Math.round(x * 100) / 100;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
const groupByKey = (k) => S.groups.find((g) => g.key === k);
const formLabel = (f) => (RUBRICS[f] ? RUBRICS[f].label : '');
const sameGroup = (st, g) => g && st.cls === g.cls && String(st.group) === String(g.group);
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
const fail = (res, code, msg) => send(res, code, { error: msg });
function readBody(req, limit = 8e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('Dữ liệu quá lớn')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJson = async (req) => { const b = await readBody(req, 1e6); try { return JSON.parse(b.toString() || '{}'); } catch { return {}; } };

function statsFor(key) {
  const rs = S.ratings.filter((r) => r.key === key);
  const g = groupByKey(key);
  const crit = g && RUBRICS[g.form] ? RUBRICS[g.form].criteria : [];
  const avgs = {};
  crit.forEach((c) => { avgs[c.id] = rs.length ? r2(rs.reduce((s, r) => s + r.scores[c.id], 0) / rs.length) : null; });
  return { n: rs.length, avgs, total: rs.length ? r2(rs.reduce((s, r) => s + r.total, 0) / rs.length) : null };
}
const eligibleCount = (g) => Object.values(S.students).filter((st) => !sameGroup(st, g)).length;
const publicGroup = (g) => ({ key: g.key, cls: g.cls, group: g.group, form: g.form, formLabel: formLabel(g.form), order: g.order || null });

// ---------- Đọc danh sách lớp từ xlsx ----------
async function parseRoster(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const norm = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ALIAS = { mssv: ['rollnumber', 'masosv', 'mssv', 'masv', 'studentid', 'studentcode'], name: ['fullname', 'hovaten', 'hoten', 'name'], group: ['group', 'nhom'], cls: ['class', 'lop'], leader: ['leader', 'nhomtruong'] };
  let hdr = null; const cols = {};
  ws.eachRow((row, n) => {
    if (hdr) return;
    const vals = row.values.map((v) => (v && v.text ? v.text : v));
    const found = {};
    vals.forEach((v, i) => { const k = norm(v); if (!k) return; for (const f in ALIAS) if (!found[f] && ALIAS[f].includes(k)) found[f] = i; });
    if (found.mssv && found.name && found.group) { hdr = n; Object.assign(cols, found); }
  });
  if (!hdr) throw new Error('Không tìm thấy hàng tiêu đề có cột MSSV (RollNumber / Mã số SV), Họ tên (FullName / Họ và tên) và Nhóm (Group / Nhóm)');
  const out = [];
  ws.eachRow((row, n) => {
    if (n <= hdr) return;
    const g = (c) => { const v = row.getCell(cols[c]).value; return v && v.text ? v.text : v; };
    const mssv = String(g('mssv') || '').trim().toUpperCase();
    const gm = String(g('group') == null ? '' : g('group')).match(/\d+/);   // "Nhóm 2" hoặc 2
    const group = gm ? Number(gm[0]) : 0;
    if (!/^[A-Z]{2,}\d{3,}$/.test(mssv) || !Number.isInteger(group) || group < 1) return;  // bỏ dòng trống, dòng ghi chú
    out.push({ cls: cols.cls ? String(g('cls') || '').trim() : '', mssv, name: String(g('name') || '').trim(), group, leader: cols.leader ? /leader|trưởng/i.test(String(g('leader') || '')) : false });
  });
  return out;
}
function rebuildGroups() {
  const old = Object.fromEntries(S.groups.map((g) => [g.key, g]));
  const keys = new Map();
  S.roster.forEach((r) => { if (r.group) keys.set(`${r.cls}-${r.group}`, { cls: r.cls, group: r.group }); });
  S.groups = [...keys.entries()].sort((a, b) => a[1].cls.localeCompare(b[1].cls) || a[1].group - b[1].group)
    .map(([key, v]) => ({ key, cls: v.cls, group: v.group, form: old[key] ? old[key].form : null, order: old[key] ? old[key].order : null }));
}

// ---------- API sinh viên ----------
function studentView(st) {
  const v = { now: Date.now(), phase: S.phase, me: { name: st.name, mssv: st.mssv, cls: st.cls, group: st.group }, joined: Object.keys(S.students).length };
  const g = groupByKey(S.activeKey);
  if ((S.phase === 'grading') && g) {
    const own = sameGroup(st, g);
    v.active = {
      key: g.key, order: g.order, form: g.form, formLabel: formLabel(g.form), open: S.open, own, startsAt: S.startsAt,
      n: S.ratings.filter((r) => r.key === g.key).length, eligible: eligibleCount(g),
      submitted: S.ratings.some((r) => r.key === g.key && r.mssv === st.mssv),
      criteria: own ? [] : RUBRICS[g.form].criteria,
    };
  }
  if (S.phase === 'ended') {
    const mine = S.groups.find((x) => sameGroup(st, x));
    if (mine) {
      const s = statsFor(mine.key);
      v.result = { formLabel: formLabel(mine.form), order: mine.order, n: s.n, total: s.total, criteria: (RUBRICS[mine.form] || { criteria: [] }).criteria.map((c) => ({ name: c.name, avg: s.avgs[c.id] })) };
    }
  }
  return v;
}
function studentFromReq(req) {
  const t = req.headers['x-token'];
  if (!t) return null;
  return Object.values(S.students).find((s) => s.token === t) || null;
}
async function apiJoin(req, res) {
  const b = await readJson(req);
  if (S.phase === 'setup') return fail(res, 409, 'Giảng viên chưa mở phòng chấm. Vui lòng chờ.');
  const mssv = String(b.mssv || '').trim().toUpperCase();
  if (S.phase === 'ended' && !S.students[mssv]) return fail(res, 409, 'Buổi chấm đã kết thúc.');
  const name = String(b.name || '').trim();
  if (!mssv || !name) return fail(res, 400, 'Vui lòng nhập đủ họ tên và MSSV.');
  const r = S.roster.find((x) => x.mssv === mssv);
  if (!r) return fail(res, 404, 'MSSV không có trong danh sách lớp. Vui lòng kiểm tra lại.');
  if (norm(r.name) !== norm(name)) return fail(res, 403, 'Họ tên không khớp với MSSV. Vui lòng nhập đúng họ tên có dấu như trong danh sách lớp.');
  let st = S.students[mssv];
  if (!st) { st = S.students[mssv] = { mssv, name: r.name, cls: r.cls, group: r.group, token: crypto.randomBytes(16).toString('hex'), joinedAt: Date.now() }; }
  save();
  send(res, 200, Object.assign({ token: st.token }, studentView(st)));
}
async function apiRate(req, res) {
  const st = studentFromReq(req);
  if (!st) return fail(res, 401, 'Phiên không hợp lệ. Vui lòng vào lại từ mã QR.');
  const g = groupByKey(S.activeKey);
  if (S.phase !== 'grading' || !g) return fail(res, 409, 'Hiện chưa có phần trình bày nào đang chấm.');
  if (Date.now() < S.startsAt) return fail(res, 409, 'Chưa đến giờ chấm, vui lòng chờ đếm ngược xong.');
  if (!S.open) return fail(res, 409, 'Giảng viên đã đóng chấm phần trình bày này.');
  if (sameGroup(st, g)) return fail(res, 403, 'Bạn không được chấm điểm nhóm của mình.');
  if (S.ratings.some((r) => r.key === g.key && r.mssv === st.mssv)) return fail(res, 409, 'Bạn đã gửi điểm cho nhóm này rồi, không thể sửa.');
  const b = await readJson(req);
  const crit = RUBRICS[g.form].criteria;
  const scores = {}; let total = 0;
  for (const c of crit) {
    const v = Number(b.scores && b.scores[c.id]);
    if (!Number.isFinite(v) || v < 0 || v > 10 || Math.round(v * 2) !== v * 2) return fail(res, 400, 'Điểm không hợp lệ (0 đến 10, bước 0.5).');
    scores[c.id] = v; total += v * c.weight / 100;
  }
  S.ratings.push({ key: g.key, mssv: st.mssv, scores, total: r2(total), at: Date.now() });
  save();
  send(res, 200, { ok: true });
}

// ---------- Màn hình chiếu (công khai, không có thông tin cá nhân) ----------
function screenView() {
  const v = { now: Date.now(), startsAt: S.startsAt, phase: S.phase, joined: Object.keys(S.students).length, showLive: S.showLive };
  if (S.phase === 'lobby') {
    v.bubbles = Object.values(S.students).sort((a, b) => a.joinedAt - b.joinedAt).slice(-80)
      .map((st) => (st.name.trim().split(/\s+/).pop() || '?').charAt(0).toUpperCase());
  }
  const g = groupByKey(S.activeKey);
  if (S.phase === 'grading' && g) {
    const s = statsFor(g.key);
    v.active = Object.assign(publicGroup(g), { open: S.open, n: s.n, eligible: eligibleCount(g),
      criteria: RUBRICS[g.form].criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, avg: S.showLive ? s.avgs[c.id] : null })),
      total: S.showLive ? s.total : null });
    if (S.showLive) {
      const rs = S.ratings.filter((r) => r.key === g.key);
      v.active.hist = Array.from({ length: 10 }, (_, i) => rs.filter((r) => Math.min(9, Math.floor(r.total)) === i).length);
      v.active.feed = rs.slice(-6).map((r, i) => ({ seq: rs.length - Math.min(6, rs.length) + i + 1, total: r.total }));
    }
  }
  if (S.phase === 'ended') {
    v.results = S.groups.filter((x) => x.order).sort((a, b) => a.order - b.order).map((x) => Object.assign(publicGroup(x), statsFor(x.key)));
  }
  return v;
}

// ---------- API giảng viên ----------
function adminView() {
  const groups = S.groups.map((g) => Object.assign(publicGroup(g), statsFor(g.key), { eligible: eligibleCount(g), members: S.roster.filter((r) => sameGroup(r, g)).length,
    list: S.roster.filter((r) => sameGroup(r, g)).map((r) => ({ mssv: r.mssv, name: r.name, leader: !!r.leader, joined: !!S.students[r.mssv] }))
      .sort((a, b) => (b.leader - a.leader) || a.name.localeCompare(b.name, 'vi')) }));
  const classes = [...new Set(S.roster.map((r) => r.cls))].map((c) => ({ cls: c, count: S.roster.filter((r) => r.cls === c).length }));
  const v = { now: Date.now(), startsAt: S.startsAt, phase: S.phase, activeKey: S.activeKey, open: S.open, showLive: S.showLive, classes, groups,
    joined: Object.keys(S.students).length, total: S.roster.length, forms: Object.fromEntries(Object.entries(RUBRICS).map(([k, f]) => [k, { label: f.label, criteria: f.criteria }])) };
  const g = groupByKey(S.activeKey);
  if (g) {
    v.pending = Object.values(S.students).filter((st) => !sameGroup(st, g) && !S.ratings.some((r) => r.key === g.key && r.mssv === st.mssv))
      .map((st) => ({ mssv: st.mssv, name: st.name, cls: st.cls })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }
  v.notJoined = S.roster.filter((r) => !S.students[r.mssv]).length;
  return v;
}
async function buildReport() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hệ thống chấm điểm';
  const head = (ws) => { ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const ordered = S.groups.filter((g) => g.order).sort((a, b) => a.order - b.order);
  // 1. Tổng hợp
  const ws1 = wb.addWorksheet('Tổng hợp');
  ws1.columns = [{ header: 'Thứ tự', key: 'order', width: 8 }, { header: 'Lớp', key: 'cls', width: 12 }, { header: 'Nhóm', key: 'group', width: 8 }, { header: 'Hình thức', key: 'form', width: 18 },
    { header: 'Số lượt chấm', key: 'n', width: 13 }, { header: 'TC1', key: 'c1', width: 9 }, { header: 'TC2', key: 'c2', width: 9 }, { header: 'TC3', key: 'c3', width: 9 }, { header: 'TC4', key: 'c4', width: 9 }, { header: 'TC5', key: 'c5', width: 9 }, { header: 'Điểm tổng (thang 10)', key: 'total', width: 20 }];
  ordered.forEach((g) => { const s = statsFor(g.key); ws1.addRow({ order: g.order, cls: g.cls, group: g.group, form: formLabel(g.form), n: s.n, c1: s.avgs.c1, c2: s.avgs.c2, c3: s.avgs.c3, c4: s.avgs.c4, c5: s.avgs.c5, total: s.total }); });
  head(ws1);
  // 2. Chi tiết
  const ws2 = wb.addWorksheet('Chi tiết từng lượt chấm');
  ws2.columns = [{ header: 'Thứ tự nhóm', key: 'order', width: 12 }, { header: 'Nhóm được chấm', key: 'grp', width: 18 }, { header: 'Hình thức', key: 'form', width: 16 },
    { header: 'MSSV người chấm', key: 'mssv', width: 16 }, { header: 'Họ tên người chấm', key: 'name', width: 26 }, { header: 'Lớp người chấm', key: 'cls', width: 14 }, { header: 'Nhóm người chấm', key: 'sg', width: 14 },
    { header: 'TC1', key: 'c1', width: 8 }, { header: 'TC2', key: 'c2', width: 8 }, { header: 'TC3', key: 'c3', width: 8 }, { header: 'TC4', key: 'c4', width: 8 }, { header: 'TC5', key: 'c5', width: 8 }, { header: 'Điểm tổng', key: 'total', width: 11 }, { header: 'Thời điểm gửi', key: 'at', width: 20 }];
  ordered.forEach((g) => S.ratings.filter((r) => r.key === g.key).forEach((r) => {
    const st = S.students[r.mssv] || {};
    ws2.addRow({ order: g.order, grp: `${g.cls} - Nhóm ${g.group}`, form: formLabel(g.form), mssv: r.mssv, name: st.name, cls: st.cls, sg: st.group, ...r.scores, total: r.total, at: new Date(r.at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) });
  }));
  head(ws2);
  // 3. Điểm danh
  const ws3 = wb.addWorksheet('Tham gia theo sinh viên');
  ws3.columns = [{ header: 'Lớp', key: 'cls', width: 12 }, { header: 'MSSV', key: 'mssv', width: 14 }, { header: 'Họ tên', key: 'name', width: 28 }, { header: 'Nhóm', key: 'group', width: 8 }, { header: 'Đã vào phòng chấm', key: 'joined', width: 19 }, { header: 'Số nhóm đã chấm', key: 'cnt', width: 16 }, { header: 'Số nhóm phải chấm', key: 'need', width: 17 }];
  S.roster.forEach((r) => {
    const need = ordered.filter((g) => !sameGroup(r, g)).length;
    ws3.addRow({ cls: r.cls, mssv: r.mssv, name: r.name, group: r.group, joined: S.students[r.mssv] ? 'Có' : 'Không', cnt: S.ratings.filter((x) => x.mssv === r.mssv).length, need });
  });
  head(ws3);
  // 4. Rubric
  const ws4 = wb.addWorksheet('Rubric');
  ws4.columns = [{ header: 'Hình thức', key: 'f', width: 18 }, { header: 'Mã', key: 'id', width: 6 }, { header: 'Tiêu chí', key: 'n', width: 40 }, { header: 'Trọng số (%)', key: 'w', width: 13 }, { header: 'Mô tả', key: 'd', width: 90 }];
  Object.values(RUBRICS).forEach((f) => f.criteria.forEach((c, i) => ws4.addRow({ f: i === 0 ? f.label : '', id: 'TC' + c.id.slice(1), n: c.name, w: c.weight, d: c.desc })));
  head(ws4);
  return wb.xlsx.writeBuffer();
}
const guardAdmin = (req) => (req.headers.authorization || '') === 'Bearer ' + ADMIN_TOKEN;
const loginFails = new Map();

async function apiAdmin(req, res, url) {
  const p = url.pathname;
  if (p === '/api/admin/login' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const f = loginFails.get(ip) || { n: 0, t: 0 };
    if (f.n >= 8 && Date.now() - f.t < 5 * 60 * 1000) return fail(res, 429, 'Sai mật khẩu quá nhiều lần. Thử lại sau 5 phút.');
    const b = await readJson(req);
    if (b.password !== ADMIN_PASSWORD) { loginFails.set(ip, { n: f.n + 1, t: Date.now() }); return fail(res, 401, 'Sai mật khẩu.'); }
    loginFails.delete(ip);
    return send(res, 200, { token: ADMIN_TOKEN });
  }
  if (!guardAdmin(req)) return fail(res, 401, 'Cần đăng nhập.');
  if (p === '/api/admin/state') return send(res, 200, adminView());
  if (p === '/api/admin/report.xlsx') {
    const buf = await buildReport();
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="bao-cao-cham-diem.xlsx"' });
    return res.end(Buffer.from(buf));
  }
  if (req.method !== 'POST') return fail(res, 405, 'Sai phương thức.');
  if (p === '/api/admin/roster') {
    if (S.phase !== 'setup') return fail(res, 409, 'Chỉ tải danh sách lớp được khi chưa mở phòng chấm.');
    let rows;
    try { rows = await parseRoster(await readBody(req)); } catch (e) { return fail(res, 400, 'Không đọc được file: ' + e.message); }
    if (!rows.length) return fail(res, 400, 'File không có sinh viên nào.');
    const classes = new Set(rows.map((r) => r.cls));
    S.roster = S.roster.filter((r) => !classes.has(r.cls)).concat(rows);
    rebuildGroups(); save();
    return send(res, 200, { ok: true, added: rows.length });
  }
  const b = await readJson(req);
  if (p === '/api/admin/roster/delete') {   // xóa danh sách một lớp (hoặc tất cả) khi chưa mở phòng chờ
    if (S.phase !== 'setup') return fail(res, 409, 'Chỉ xóa được danh sách lớp khi chưa mở phòng chờ.');
    const before = S.roster.length;
    S.roster = b.cls ? S.roster.filter((r) => r.cls !== b.cls) : [];
    rebuildGroups(); save();
    return send(res, 200, { ok: true, removed: before - S.roster.length });
  }
  if (p === '/api/admin/forms') {
    if (S.phase !== 'setup' && S.phase !== 'lobby') return fail(res, 409, 'Không đổi hình thức được khi đang chấm.');
    for (const [key, form] of Object.entries(b.forms || {})) { const g = groupByKey(key); if (g && (RUBRICS[form] || form === null)) g.form = form; }
    save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/lobby') {
    if (S.phase !== 'setup') return fail(res, 409, 'Phòng chờ đã mở.');
    if (!S.groups.length) return fail(res, 400, 'Chưa có danh sách lớp.');
    S.phase = 'lobby'; save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/start') {  // kích hoạt chấm và/hoặc chuyển sang nhóm khác
    const g = groupByKey(b.key);
    if (!g) return fail(res, 400, 'Chọn nhóm cần chấm.');
    if (S.phase !== 'lobby' && S.phase !== 'grading') return fail(res, 409, 'Chưa thể bắt đầu chấm.');
    // hình thức được chọn ngay lúc nhóm trình bày; đã có điểm thì không đổi để rubric không bị lệch
    if (b.form && RUBRICS[b.form] && b.form !== g.form) {
      if (S.ratings.some((r) => r.key === g.key)) return fail(res, 409, 'Nhóm này đã có điểm, không đổi hình thức được.');
      g.form = b.form;
    }
    if (!g.form) return fail(res, 400, 'Hãy chọn hình thức dự án của nhóm này trước khi bắt đầu chấm.');
    if (!g.order) g.order = Math.max(0, ...S.groups.map((x) => x.order || 0)) + 1;
    S.phase = 'grading'; S.activeKey = g.key; S.open = true; S.startsAt = Date.now() + 5000; save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/toggle') {
    if (S.phase !== 'grading') return fail(res, 409, 'Chưa kích hoạt chấm.');
    S.open = !!b.open; save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/resetgroup') {   // xóa toàn bộ điểm của một nhóm (phòng khi lỗi), các bạn đã chấm sẽ chấm lại được
    const g = groupByKey(b.key);
    if (!g) return fail(res, 400, 'Không tìm thấy nhóm.');
    if (S.phase !== 'grading') return fail(res, 409, 'Chỉ reset điểm được khi đang trong buổi chấm.');
    const before = S.ratings.length;
    S.ratings = S.ratings.filter((r) => r.key !== g.key);
    save(); return send(res, 200, { ok: true, removed: before - S.ratings.length });
  }
  if (p === '/api/admin/back') {   // hủy nhóm đang chấm, quay về phòng chờ để chọn lại nhóm
    if (S.phase !== 'grading') return fail(res, 409, 'Chưa ở trạng thái chấm.');
    const g = groupByKey(S.activeKey);
    if (g && !S.ratings.some((r) => r.key === g.key)) g.order = 0;   // chưa có điểm thì coi như chưa trình bày
    S.phase = 'lobby'; S.activeKey = null; S.open = false; S.startsAt = 0; save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/live') { S.showLive = !!b.show; save(); return send(res, 200, { ok: true }); }
  if (p === '/api/admin/end') {
    if (S.phase !== 'grading') return fail(res, 409, 'Chưa ở trạng thái chấm.');
    S.phase = 'ended'; S.open = false; save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/reset') {
    if (b.confirm !== 'XOA') return fail(res, 400, 'Cần xác nhận.');
    const keep = S.roster; S = fresh(); S.roster = keep; rebuildGroups(); save(); return send(res, 200, { ok: true });
  }
  fail(res, 404, 'Không tìm thấy.');
}

// ---------- Máy chủ ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const PAGES = { '/': 'student.html', '/admin': 'admin.html', '/screen': 'screen.html' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (p === '/api/join' && req.method === 'POST') return await apiJoin(req, res);
    if (p === '/api/state') { const st = studentFromReq(req); return st ? send(res, 200, studentView(st)) : fail(res, 401, 'Phiên không hợp lệ.'); }
    if (p === '/api/rate' && req.method === 'POST') return await apiRate(req, res);
    if (p === '/api/screen') return send(res, 200, screenView());
    if (p === '/qr.svg') {
      const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
      const base = process.env.PUBLIC_URL || `${proto}://${req.headers.host}`;
      const svg = await QRCode.toString(base + '/', { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); return res.end(svg);
    }
    if (p === '/api/public-url') { const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0]; return send(res, 200, { url: (process.env.PUBLIC_URL || `${proto}://${req.headers.host}`) + '/' }); }
    if (p.startsWith('/api/admin/')) return await apiAdmin(req, res, url);
    const f = PAGES[p] || (p === '/style.css' ? 'style.css' : null);
    if (f) { res.writeHead(200, { 'Content-Type': MIME[path.extname(f)], 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(path.join(__dirname, 'public', f))); }
    res.writeHead(404); res.end('Không tìm thấy');
  } catch (e) { console.error(e); if (!res.headersSent) fail(res, 500, 'Lỗi máy chủ'); else res.end(); }
});
server.listen(PORT, () => console.log('Chạy tại cổng ' + PORT));
