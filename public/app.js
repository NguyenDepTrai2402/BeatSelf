const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('vi-VN')+' ₫';
const state={user:null,beats:[],genre:'all',filter:'',sort:'default',favorites:JSON.parse(localStorage.getItem('beatself-favorites')||'[]'),current:null,selectedThread:null};
const audio=$('#audio');audio.volume=.8;
async function api(url,options={}){const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},body:options.body?JSON.stringify(options.body):undefined});let j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Có lỗi xảy ra.');return j}
let toastTimer;function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500)}
function show(html,wide=false){$('#modal-content').innerHTML=html;$('.modal').classList.toggle('wide',wide);$('#modal-wrap').classList.remove('hidden');$('#modal-content input, #modal-content button')?.focus()}
function close(){$('#modal-wrap').classList.add('hidden');$('.modal').classList.remove('wide')}
$('#modal-close').onclick=close;$('#modal-wrap').onclick=e=>{if(e.target.id==='modal-wrap')close()};document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
function art(b){return b.art?.startsWith('/media/')?`style="background-image:url('${esc(b.art)}')"`:''}
function coverClass(b){return b.art?.startsWith('/media/')?'has-image':esc(b.art||'violet')}
function render(){let beats=state.beats.filter(b=>(state.genre==='all'||b.genre===state.genre)&&(state.filter===''||`${b.title} ${b.genre} ${b.mood} ${b.key_note}`.toLowerCase().includes(state.filter)));if(state.genre==='favorites')beats=state.beats.filter(b=>state.favorites.includes(b.id));if(state.sort==='price')beats.sort((a,b)=>a.price-b.price);if(state.sort==='bpm')beats.sort((a,b)=>a.bpm-b.bpm);state.visible=beats;$('#track-count').textContent=String(beats.length).padStart(2,'0');$('#fav-count').textContent=state.favorites.length;$('#empty').classList.toggle('hidden',beats.length>0);$('#track-list').innerHTML=beats.map(b=>`<div class="track" data-track="${b.id}"><div class="track-main"><div class="cover ${coverClass(b)}" ${art(b)}><button class="cover-play" data-play="${b.id}" aria-label="Nghe ${esc(b.title)}">▶</button></div><div><button class="track-name" data-details="${b.id}">${esc(b.title)}</button><div class="track-by">${b.demo?'Bản mẫu · không bán':'BeatSelf Studio'}</div></div></div><span class="track-info">${esc(b.genre)}</span><span class="track-info">${b.bpm} <span style="color:#696970">/</span> ${esc(b.key_note)}</span><span class="track-mood">${esc(b.mood)}</span><span class="price">${money(b.price)}</span><div class="track-actions"><button class="heart ${state.favorites.includes(b.id)?'liked':''}" data-fav="${b.id}" aria-label="Yêu thích">${state.favorites.includes(b.id)?'♥':'♡'}</button>${b.demo?'<span class="status">DEMO</span>':`<button class="buy" data-buy="${b.id}">Mua ↗</button>`}</div></div>`).join('');$('#auth-button').innerHTML=state.user?`${esc(state.user.name)} <span>↗</span>`:'Đăng nhập <span>↗</span>';$('#admin-nav').classList.toggle('hidden',!state.user||state.user.role==='customer');}
function toggleFav(id){state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];localStorage.setItem('beatself-favorites',JSON.stringify(state.favorites));render();$('#player-fav').classList.toggle('liked',state.favorites.includes(state.current));$('#player-fav').textContent=state.favorites.includes(state.current)?'♥':'♡'}
function queue(){ return (state.visible || []).filter(b=>b.preview) }
function currentBeat(){ return state.beats.find(b=>b.id===state.current) }
function details(id){
  const b=state.beats.find(item=>item.id===id);
  if(!b)return;
  show(`<div class="section-kicker">CHI TIẾT BEAT</div><h2 id="modal-title">${esc(b.title)}</h2>
    <p>${esc(b.genre)} · ${b.bpm} BPM · ${esc(b.key_note)} · ${esc(b.mood)}</p>
    <p>${b.demo?'Giá tham khảo':'Giá từ'} <strong>${money(b.price)}</strong></p>
    ${b.preview?`<button class="button-small" data-play="${id}">Nghe / tạm dừng</button>`:''}
    <button class="primary-btn" data-buy="${id}">${b.demo?'Xem thử thanh toán':'Chọn giấy phép & thanh toán'} ↗</button>`);
}
function play(id,toggle=true){
  const b=state.beats.find(x=>x.id===id);
  if(!b?.preview)return toast('Chưa có bản nghe thử.');
  if(state.current===id && !audio.paused && toggle){audio.pause();return}
  if(state.current!==id){
    audio.src=b.preview;
    state.current=id;
    $('#now-title').textContent=b.title;
    $('#now-subtitle').textContent=`${b.genre} · ${b.bpm} BPM`;
    $('#now-art').style.backgroundImage=b.art?.startsWith('/media/')?`url("${b.art}")`:'';
    $('#now-art').textContent=b.art?.startsWith('/media/')?'':'♫';
    $('#seek').disabled=true;
    updateTime();
  }else if(!toggle){audio.currentTime=0}
  $('#player-fav').classList.toggle('liked',state.favorites.includes(id));
  $('#player-fav').textContent=state.favorites.includes(id)?'♥':'♡';
  audio.play().catch(err=>{if(err.name!=='AbortError')toast('Không thể phát file âm thanh này.')});
}
function step(delta){
  const tracks=queue();
  if(!tracks.length)return toast('Danh sách hiện tại chưa có bản nghe thử.');
  const i=tracks.findIndex(b=>b.id===state.current);
  const index=i<0?(delta>0?0:tracks.length-1):(i+delta+tracks.length)%tracks.length;
  play(tracks[index].id,false);
}
audio.onplay=()=>$('#play-toggle').textContent='❚❚';
audio.onpause=()=>$('#play-toggle').textContent='▶';
audio.onended=()=>step(1);
const fmt=n=>Number.isFinite(n)?`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`:'0:00';
function updateTime(){
  const ready=Number.isFinite(audio.duration)&&audio.duration>0;
  $('#duration').textContent=fmt(audio.duration);
  $('#current-time').textContent=fmt(audio.currentTime);
  $('#seek').disabled=!ready;
  $('#seek').value=ready?100*audio.currentTime/audio.duration:0;
}
audio.ondurationchange=audio.ontimeupdate=updateTime;
$('#seek').oninput=e=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*e.target.value/100};
$('#volume').oninput=e=>audio.volume=e.target.value/100;
$('#play-toggle').onclick=()=>state.current?play(state.current):step(1);
$('#prev').onclick=()=>step(-1);
$('#next').onclick=()=>step(1);
$('#player-details').onclick=()=>{
  const beat=currentBeat()||queue()[0];
  if(beat)details(beat.id);else toast('Danh sách hiện tại chưa có beat.');
};
$('#player-fav').onclick=()=>{const b=currentBeat()||queue()[0];if(b)toggleFav(b.id)};
$('#search').oninput=e=>{state.filter=e.target.value.trim().toLowerCase();render()};$('#sort').onchange=e=>{state.sort=e.target.value;render()};$('#genres').onclick=e=>{const g=e.target.closest('[data-genre]');if(!g)return;state.genre=g.dataset.genre;$$('.chip').forEach(c=>c.classList.toggle('active',c===g));render()};
function auth(reg=false,afterLogin=null){show(`<div class="section-kicker"><span></span> BEATSELF ACCOUNT</div><h2 style="margin-top:12px">${reg?'Tạo tài khoản':'Chào mừng trở lại.'}</h2><p>${reg?'Bắt đầu hành trình âm nhạc của bạn.':'Đăng nhập để mua beat và trò chuyện với studio.'}</p><form id="auth-form">${reg?'<label class="field">Tên hiển thị<input name="name" minlength="2" maxlength="80" required></label>':''}<label class="field">Email<input name="email" type="email" required autocomplete="email"></label><label class="field">Mật khẩu<input name="password" type="password" minlength="10" required autocomplete="${reg?'new-password':'current-password'}"></label><button class="primary-btn">${reg?'Tạo tài khoản':'Đăng nhập'} ↗</button></form><p>${reg?'Đã có tài khoản?':'Chưa có tài khoản?'} <button class="link-btn" id="auth-switch">${reg?'Đăng nhập':'Đăng ký'}</button></p>`);$('#auth-switch').onclick=()=>auth(!reg,afterLogin);$('#auth-form').onsubmit=async e=>{e.preventDefault();try{let data=Object.fromEntries(new FormData(e.target));let j=await api(reg?'/api/register':'/api/login',{method:'POST',body:data});if(reg){toast(j.message);auth(false,afterLogin);return}state.user=j.user;render();close();toast('Đăng nhập thành công.');afterLogin?.()}catch(err){toast(err.message)}}}
function account(){show(`<h2>Xin chào, ${esc(state.user.name)}.</h2><p>${esc(state.user.email)} · ${esc(state.user.role)}</p><button class="button-small" id="logout">Đăng xuất</button>`);$('#logout').onclick=async()=>{await api('/api/logout',{method:'POST',body:{}});state.user=null;render();close();toast('Đã đăng xuất.')};}
function requireLogin(){if(!state.user){auth();return false}return true}
function chooseLicense(id){let b=state.beats.find(x=>x.id===id);if(!b)return;show(`<div class="section-kicker"><span></span> CHỌN GIẤY PHÉP</div><h2 style="margin-top:12px">${esc(b.title)}</h2><p>Giá dưới đây là cấu hình mẫu. Nội dung và điều khoản giấy phép cần được chủ cửa hàng hoàn thiện trước khi kinh doanh.</p>${[['basic','Basic MP3',1,'Giấy phép cơ bản'],['premium','Premium WAV',2,'Giấy phép mở rộng']].map(([k,n,f,d])=>`<div class="modal-row"><div><strong>${n}</strong><small>${d}</small></div><button class="button-small" data-license="${k}" data-id="${id}">${money(b.price*f)} ↗</button></div>`).join('')}`)}
async function createOrder(id,license){
  const beat=state.beats.find(b=>b.id===id);
  if(!beat)return;
  if(beat.demo){
    show(`<h2>Thanh toán thử</h2><p>${esc(beat.title)} · ${license==='premium'?'Premium WAV':'Basic MP3'}</p><p>Tổng mẫu <strong>${money(beat.price*(license==='premium'?2:1))}</strong></p><p>Beat mẫu chỉ dùng để trải nghiệm. Không tạo đơn và không thu tiền.</p><button class="button-small" data-details="${id}">Quay lại beat</button>`);
    return;
  }
  if(!state.user)return auth(false,()=>chooseLicense(id));
  try{let o=await api('/api/orders',{method:'POST',body:{beatId:id,license}});show(`<div class="section-kicker"><span></span> THANH TOÁN CHUYỂN KHOẢN</div><h2 style="margin-top:12px">Đơn ${esc(o.ref)}</h2><p>Giá trị đơn: <strong style="color:white">${money(o.amount)}</strong></p>${o.qr?`<img class="qr" src="${esc(o.qr)}" alt="Mã QR chuyển khoản"><p>Quét mã và giữ nguyên nội dung chuyển khoản <strong>${esc(o.ref)}</strong>. Đơn chỉ hoàn tất sau khi cửa hàng kiểm tra tiền nhận được.</p>`:'<p>Chủ cửa hàng chưa cấu hình tài khoản nhận tiền. Đơn đang chờ; vui lòng liên hệ cửa hàng trước khi chuyển khoản.</p>'}<button class="primary-btn" id="see-orders">Xem đơn hàng ↗</button>`);$('#see-orders').onclick=orders}catch(e){toast(e.message)}}
async function orders(){if(!requireLogin())return;try{let r=await api('/api/orders');show(`<h2>Đơn hàng của bạn</h2><p>File chỉ tải được sau khi đơn được xác nhận thanh toán và cửa hàng đã tải file gốc lên.</p>${r.orders.length?r.orders.map(o=>`<div class="modal-row"><div><strong>${esc(o.title)}</strong><small>${esc(o.ref)} · ${esc(o.license)} · ${money(o.amount)}</small></div><span class="status ${o.status}">${o.status==='paid'?'Đã thanh toán':'Chờ xác nhận'}</span>${o.status==='paid'?`<a class="button-small" href="/api/orders/${o.id}/download">Tải file</a>`:`<button class="button-small" data-qr="${o.id}">Xem QR</button>`}</div>`).join(''):'<p>Bạn chưa có đơn hàng nào.</p>'}`)}catch(e){toast(e.message)}}
async function showQR(id){try{let o=await api(`/api/orders/${id}/qr`);show(`<h2>Đơn ${esc(o.ref)}</h2><p>Giá trị đơn: <strong>${money(o.amount)}</strong></p>${o.qr?`<img class="qr" src="${esc(o.qr)}" alt="Mã QR chuyển khoản"><p>Giữ nguyên nội dung <strong>${esc(o.ref)}</strong>. Đơn sẽ chờ cửa hàng xác nhận tiền.</p>`:'<p>Cửa hàng chưa cấu hình tài khoản nhận tiền.</p>'}<button class="button-small" id="back-orders">← Đơn hàng</button>`);$('#back-orders').onclick=orders}catch(e){toast(e.message)}}
async function chat(thread=null){if(!requireLogin())return;try{let isStaff=state.user.role!=='customer';if(isStaff&&!thread){let r=await api('/api/messages');return show(`<h2>Hộp thư</h2><p>Chọn một khách hàng để trả lời.</p>${(r.threads||[]).map(x=>`<div class="modal-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.email)}</small></div><button class="button-small" data-thread="${x.id}">Mở hội thoại</button></div>`).join('')||'<p>Chưa có hội thoại.</p>'}`)}let r=await api('/api/messages'+(thread?`?userId=${thread}`:''));show(`<h2>Trò chuyện với ${isStaff?'khách hàng':'BeatSelf'}.</h2><p>Để lại lời nhắn, cửa hàng sẽ phản hồi tại đây.</p><div class="chat-list">${r.messages.map(m=>`<div class="bubble ${m.role===state.user.role?'mine':''}"><small>${esc(m.name)} · ${esc(m.created_at)}</small>${esc(m.body)}</div>`).join('')||'<p>Chưa có tin nhắn.</p>'}</div><form id="chat-form"><label class="field">Tin nhắn<input name="message" maxlength="2000" required placeholder="Viết lời nhắn..."></label><button class="primary-btn">Gửi tin nhắn ↗</button></form>${isStaff?'<p><button class="link-btn" id="back-threads">← Tất cả hội thoại</button></p>':''}`);if(isStaff)$('#back-threads').onclick=()=>chat();$('#chat-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/messages',{method:'POST',body:{body:new FormData(e.target).get('message'),userId:thread}});chat(thread)}catch(err){toast(err.message)}};$('.chat-list').scrollTop=$('.chat-list').scrollHeight}catch(e){toast(e.message)}}
document.addEventListener('click',async e=>{let x=e.target.closest('button');if(!x){const row=e.target.closest('[data-track]');if(row)details(Number(row.dataset.track));return}if(x.dataset.details)return details(Number(x.dataset.details));if(x.dataset.scroll){document.getElementById(x.dataset.scroll)?.scrollIntoView();return}if(x.dataset.play)return play(Number(x.dataset.play));if(x.dataset.fav)return toggleFav(Number(x.dataset.fav));if(x.dataset.buy)return chooseLicense(Number(x.dataset.buy));if(x.dataset.license)return createOrder(Number(x.dataset.id),x.dataset.license);if(x.dataset.qr)return showQR(Number(x.dataset.qr));if(x.dataset.thread)return chat(Number(x.dataset.thread));switch(x.dataset.action){case'login':state.user?account():auth();break;case'orders':orders();break;case'chat':chat();break;case'admin':location.href='/admin';break;case'favorites':state.genre='favorites';$$('.chip').forEach(c=>c.classList.remove('active'));render();$('#tracks').scrollIntoView();break}});
async function loadBeats(){state.beats=(await api('/api/beats')).beats;render()}
Promise.all([api('/api/session'),api('/api/beats')]).then(([s,b])=>{state.user=s.user;state.beats=b.beats;render()}).catch(e=>toast(e.message));
