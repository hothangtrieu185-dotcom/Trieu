const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mmss=ms=>{ms=Math.max(0,Math.ceil(ms/1000));return String(Math.floor(ms/60)).padStart(2,'0')+':'+String(ms%60).padStart(2,'0')};
let OFF=0; // chênh lệch giờ máy chủ và giờ máy
const syncNow=n=>{OFF=n-Date.now()};
const nowS=()=>Date.now()+OFF;
async function api(path,opt={}){
  const h=Object.assign({'Content-Type':'application/json'},opt.headers||{});
  const r=await fetch(path,{method:opt.method||'GET',headers:h,body:opt.body});
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok){const e=new Error(j.error||('Lỗi '+r.status));e.status=r.status;throw e}
  return j;
}
