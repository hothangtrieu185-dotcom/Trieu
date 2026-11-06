const CRIT=[
 {k:'rep',t:'Đóng góp nội dung báo cáo',d:'Chất lượng phần viết, nghiên cứu, số liệu'},
 {k:'pre',t:'Đóng góp slide và thuyết trình',d:'Làm slide, luyện nói, trả lời hỏi đáp'},
 {k:'res',t:'Trách nhiệm và đúng hạn',d:'Hoàn thành việc đúng hạn, tham gia họp nhóm'},
 {k:'col',t:'Hợp tác và giao tiếp',d:'Phối hợp, tôn trọng, hỗ trợ thành viên khác'}];
const LV=['','1 · Rất yếu','2 · Yếu','3 · Đạt','4 · Tốt','5 · Xuất sắc'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const n2=v=>v==null?'n/a':v.toFixed(2);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const fmtT=ms=>ms?new Date(ms).toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'}):'chưa đặt';
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
const b64e=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64d=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)))};
/* Mã kết quả: HMO1.<base64url JSON>. Mảng điểm = [rep,pre,res,col,nhận xét] */
let ENDAT=0;
function encodeResult(gid,rid,rname,scores,self){
  const arr=v=>[v.rep,v.pre,v.res,v.col,(v.comment||'').trim()];
  const s={};Object.keys(scores).forEach(k=>s[k]=arr(scores[k]));
  return 'HMO1.'+b64e(JSON.stringify({v:1,g:gid,r:rid,n:rname,t:Date.now(),e:ENDAT||0,s,f:arr(self)}));
}
function decodeResult(code){
  try{
    const o=JSON.parse(b64d(code.replace(/^HMO1\./,'')));
    if(o.v!==1||!o.g||!o.r||!o.s)return null;
    const obj=a=>({rep:+a[0],pre:+a[1],res:+a[2],col:+a[3],comment:String(a[4]||'')});
    const scores={};Object.keys(o.s).forEach(k=>scores[k]=obj(o.s[k]));
    const ok=v=>[v.rep,v.pre,v.res,v.col].every(x=>x>=1&&x<=5);
    if(!Object.values(scores).every(ok))return null;
    return{gid:o.g,raterId:o.r,raterName:o.n,submittedAt:o.t,endAt:+o.e||0,scores,self:o.f?obj(o.f):null};
  }catch(e){return null}
}
function isOpen(g){return g&&g.open!==false&&(!ENDAT||Date.now()<=ENDAT)&&(!g.deadline||Date.now()<=g.deadline)}
const mmss=ms=>{const s=Math.max(0,Math.ceil(ms/1000));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
/* ---------- tính điểm ---------- */
function calc(g,ratings){
  const rs=ratings.filter(r=>r.gid===g.id);
  const rows=g.members.map(m=>{
    const got=rs.filter(r=>r.raterId!==m.id&&r.scores&&r.scores[m.id]);
    const per=CRIT.map(c=>mean(got.map(r=>r.scores[m.id][c.k])));
    const all=mean(got.map(r=>mean(CRIT.map(c=>r.scores[m.id][c.k]))));
    const mineR=rs.find(r=>r.raterId===m.id&&r.self);
    const self=mineR?mean(CRIT.map(c=>mineR.self[c.k])):null;
    return{m,n:got.length,per,all,self};
  });
  const gavg=mean(rows.filter(r=>r.all!=null).map(r=>r.all));
  rows.forEach(r=>{r.raw=r.all!=null&&gavg?r.all/gavg:null;r.coef=r.raw==null?null:clamp(r.raw,0.8,1.1)});
  const submitted=new Set(rs.map(r=>r.raterId));
  const missing=g.members.filter(m=>!submitted.has(m.id));
  const flags=[];
  rs.forEach(r=>{
    const rn=r.raterName||r.raterId;
    const vals=[];g.members.forEach(m=>{if(m.id!==r.raterId&&r.scores&&r.scores[m.id])CRIT.forEach(c=>vals.push(r.scores[m.id][c.k]))});
    if(vals.length>=8&&vals.every(v=>v===vals[0]))flags.push({who:rn,t:'Chấm toàn một mức ('+vals[0]+' sao) cho mọi bạn'});
    const dl=r.endAt||g.deadline;
    if(dl&&r.submittedAt>dl+3000)flags.push({who:rn,t:'Nộp sau hạn ('+fmtT(r.submittedAt)+')'});
    g.members.forEach(m=>{
      if(m.id===r.raterId||!r.scores||!r.scores[m.id])return;
      const mine=mean(CRIT.map(c=>r.scores[m.id][c.k]));
      const others=rs.filter(x=>x!==r&&x.raterId!==m.id&&x.scores&&x.scores[m.id]).map(x=>mean(CRIT.map(c=>x.scores[m.id][c.k])));
      if(others.length>=2&&Math.abs(mine-mean(others))>=1.5)flags.push({who:rn,t:'Chấm '+m.name+' '+n2(mine)+', lệch nhiều so với '+n2(mean(others))+' của các bạn còn lại'});
    });
  });
  return{rows,gavg,missing,flags,rs};
}
