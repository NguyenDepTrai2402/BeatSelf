import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, openSync, writeSync, closeSync, unlinkSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export function createApp(db,data,cloud=null){
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS beats(id INTEGER PRIMARY KEY,title TEXT NOT NULL,genre TEXT NOT NULL,mood TEXT NOT NULL,bpm INTEGER NOT NULL,key_note TEXT NOT NULL,price INTEGER NOT NULL,art TEXT NOT NULL DEFAULT '',preview TEXT NOT NULL DEFAULT '',master TEXT NOT NULL DEFAULT '',published INTEGER NOT NULL DEFAULT 1,demo INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),beat_id INTEGER NOT NULL REFERENCES beats(id),license TEXT NOT NULL,amount INTEGER NOT NULL,ref TEXT UNIQUE NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP,paid_at TEXT);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),author_id INTEGER NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor_id INTEGER REFERENCES users(id),action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS permissions(user_id INTEGER NOT NULL REFERENCES users(id),permission TEXT NOT NULL,PRIMARY KEY(user_id,permission));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
`);
const q=(s,...a)=>db.prepare(s).all(...a), one=(s,...a)=>db.prepare(s).get(...a), run=(s,...a)=>db.prepare(s).run(...a);
const saltHash=p=>{const s=randomBytes(16).toString('hex');return s+':'+scryptSync(p,s,64).toString('hex')};
const verify=(p,h)=>{try{let [s,k]=h.split(':');return timingSafeEqual(Buffer.from(k,'hex'),scryptSync(p,s,64))}catch{return false}};
const hash=t=>createHash('sha256').update(t).digest('hex');
if(process.env.ADMIN_EMAIL&&(process.env.ADMIN_PASSWORD_HASH||process.env.ADMIN_PASSWORD?.length>=12)&&!one('SELECT id FROM users WHERE email=?',process.env.ADMIN_EMAIL.toLowerCase())) run('INSERT INTO users(email,name,password,role) VALUES(?,?,?,?)',process.env.ADMIN_EMAIL.toLowerCase(),'Admin',process.env.ADMIN_PASSWORD_HASH||saltHash(process.env.ADMIN_PASSWORD),'admin');
if(!one('SELECT id FROM beats LIMIT 1')) {const insert=db.prepare('INSERT INTO beats(title,genre,mood,bpm,key_note,price,art,demo) VALUES(?,?,?,?,?,?,?,1)');for(const b of [['SAIGON AFTER DARK','Trap','Dark',140,'F#m',399000,'violet'],['NO SIGNAL','R&B','Chill',92,'Am',349000,'blue'],['ĐÊM TRÔI','Lo-fi','Dreamy',85,'Dm',299000,'orange'],['HIGH TIDE','Drill','Hard',145,'Gm',449000,'green'],['RED EYE','Hip-hop','Dark',128,'Cm',399000,'red'],['SLOW BURN','R&B','Soulful',96,'Em',349000,'pink']])insert.run(...b)}
for(const b of q('SELECT id FROM beats WHERE demo=1')){const id=createHash('sha1').update('beatself-demo-'+b.id).digest('hex');const source=path.join(root,'public','demo',`${b.id}.wav`);if(cloud){run("UPDATE beats SET preview=? WHERE id=? AND preview=''",id,b.id)}else if(existsSync(source)){copyFileSync(source,path.join(data,'media',id));writeFileSync(path.join(data,'media',id+'.type'),'audio/wav');run("UPDATE beats SET preview=? WHERE id=? AND preview=''",id,b.id)}}
const defaultPerms=['beats.write','orders.read','chat.reply'];
const can=(u,p)=>u?.role==='admin'||(u?.role==='mod'&&(one('SELECT 1 ok FROM permissions WHERE user_id=? AND permission=?',u.id,p)?.ok===1));
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,permissions:u.role==='admin'?['*']:q('SELECT permission FROM permissions WHERE user_id=?',u.id).map(x=>x.permission)});
function actor(req){const tok=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);if(!tok)return null;return one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',hash(tok),Date.now())||null}
function audit(u,action,details){run('INSERT INTO audit(actor_id,action,details) VALUES(?,?,?)',u.id,action,JSON.stringify(details))}
const result=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data))};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
async function body(req){if(req.body!==undefined){if(typeof req.body==='object'&&!Buffer.isBuffer(req.body))return req.body;try{return JSON.parse(String(req.body))}catch{fail(400,'JSON không hợp lệ.')}}let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>12*1024*1024)fail(413,'File hoặc dữ liệu quá lớn (tối đa 9 MB/file).');chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{fail(400,'Dữ liệu không hợp lệ.')}}
const requireUser=u=>{if(!u)fail(401,'Vui lòng đăng nhập.');return u};
const requirePerm=(u,p)=>{requireUser(u);if(!can(u,p))fail(403,'Bạn không có quyền thực hiện thao tác này.')};
function storeFile(file,kind){if(!file)return '';const allowed=kind==='art'?['image/png','image/jpeg','image/webp']:['audio/mpeg','audio/wav','audio/x-wav','audio/ogg'];if(!allowed.includes(file.type))fail(400,'Định dạng file không hỗ trợ.');if(typeof file.data!=='string'||file.data.length>12*1024*1024)fail(400,'File quá lớn.');const buf=Buffer.from(file.data,'base64');if(!buf.length||buf.length>9*1024*1024)fail(400,'File quá lớn hoặc rỗng.');const sig=buf.subarray(0,12);const valid=file.type==='image/png'?sig.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):file.type==='image/jpeg'?sig[0]===255&&sig[1]===216:file.type==='image/webp'?sig.toString('ascii',0,4)==='RIFF'&&sig.toString('ascii',8,12)==='WEBP':file.type==='audio/ogg'?sig.toString('ascii',0,4)==='OggS':file.type.includes('wav')?sig.toString('ascii',0,4)==='RIFF'&&sig.toString('ascii',8,12)==='WAVE':sig.toString('ascii',0,3)==='ID3'||(sig[0]===255&&(sig[1]&224)===224);if(!valid)fail(400,'Nội dung file không khớp định dạng.');const id=randomBytes(20).toString('hex');writeFileSync(path.join(data,'media',id),buf);writeFileSync(path.join(data,'media',id+'.type'),file.type);return id}
function sniffFile(sig,kind){
 const text=(a,b)=>sig.subarray(a,b).toString('ascii');
 if(kind==='art'){
  if(sig.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
  if(sig[0]===255&&sig[1]===216&&sig[2]===255)return 'image/jpeg';
  if(text(0,4)==='RIFF'&&text(8,12)==='WEBP')return 'image/webp';
 }else{
  if((text(0,4)==='RIFF'||text(0,4)==='RF64')&&text(8,12)==='WAVE')return 'audio/wav';
  if(text(0,4)==='fLaC')return 'audio/flac';
  if(text(0,4)==='OggS')return 'audio/ogg';
  if(text(4,8)==='ftyp')return 'audio/mp4';
  if(text(0,3)==='ID3'||(sig[0]===255&&(sig[1]&224)===224))return 'audio/mpeg';
 }
 fail(400,kind==='art'?'Ảnh chưa được hỗ trợ. Chọn JPG, PNG hoặc WebP.':'File nhạc chưa được hỗ trợ hoặc bị hỏng. Chọn MP3, WAV, M4A, FLAC hoặc OGG.');
}
async function receiveUpload(req,u,kind){
 if(!['art','preview','master'].includes(kind))fail(400,'Loại file không hợp lệ.');
 const max=kind==='art'?10*1024*1024:100*1024*1024;
 const len=Number(req.headers['content-length']);if(Number.isFinite(len)&&len>max){req.resume();fail(413,`File vượt quá ${max/1024/1024} MB.`)}
 const id=randomBytes(20).toString('hex'),target=path.join(data,'media',id);let fd=openSync(target,'wx'),size=0,header=Buffer.alloc(0);
 try{
  for await(const chunk of req){size+=chunk.length;if(size>max)fail(413,`File vượt quá ${max/1024/1024} MB.`);if(header.length<32)header=Buffer.concat([header,chunk.subarray(0,32-header.length)]);let at=0;while(at<chunk.length)at+=writeSync(fd,chunk,at,chunk.length-at);}
  if(!size)fail(400,'File trống.');const type=sniffFile(header,kind);closeSync(fd);fd=null;writeFileSync(target+'.type',type);run('INSERT INTO uploads(id,user_id,kind,created_at) VALUES(?,?,?,?)',id,u.id,kind,Date.now());return {uploadId:id,size,type};
 }catch(e){if(fd!==null)closeSync(fd);try{unlinkSync(target)}catch{}try{unlinkSync(target+'.type')}catch{}throw e}
}
function resolveUpload(file,kind,u){if(!file)return '';if(typeof file.uploadId==='string'){
 const item=one('SELECT id FROM uploads WHERE id=? AND user_id=? AND kind=? AND claimed=0',file.uploadId,u.id,kind);if(!item)fail(400,'File tải lên không hợp lệ, đã được sử dụng hoặc không thuộc tài khoản này.');return item.id;
 }if(cloud)fail(400,'Cần tải file qua dashboard.');return storeFile(file,kind==='art'?'art':'audio');}
function claimUploads(b,u){for(const k of ['art','preview','master'])if(b[k]?.uploadId)run('UPDATE uploads SET claimed=1 WHERE id=? AND user_id=? AND kind=?',b[k].uploadId,u.id,k)}
const sget=k=>one('SELECT value FROM settings WHERE key=?',k)?.value||'';
const licenses={basic:{label:'Basic MP3',factor:1},premium:{label:'Premium WAV',factor:2},exclusive:{label:'Exclusive',factor:6}};
async function api(req,res,url){let u=actor(req);const method=req.method,p=url.pathname;
if(!['GET','HEAD'].includes(method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)fail(403,'Origin không hợp lệ.');
if(p==='/api/upload-url'&&method==='POST'){
 requirePerm(u,'beats.write');
 if(!cloud)return result(res,200,{local:true});
 const {kind,size}=await body(req);
 const limit=kind==='art'?10:100;
 if(!['art','preview','master'].includes(kind)||!Number.isSafeInteger(size)||size<1||size>limit*1024*1024)fail(400,'Dung lượng hoặc loại file không hợp lệ.');
 const id=randomBytes(20).toString('hex');
 const url=await cloud.uploadUrl(id,size);
 run('INSERT INTO uploads(id,user_id,kind,claimed,created_at) VALUES(?,?,?,-1,?)',id,u.id,kind,Date.now());
 return result(res,201,{id,url});
}
if(p==='/api/upload-finish'&&method==='POST'&&cloud){
 requirePerm(u,'beats.write');
 const {id}=await body(req);
 const item=one('SELECT kind FROM uploads WHERE id=? AND user_id=? AND claimed=-1',id,u.id);
 if(!item)fail(400,'Phiên tải file không hợp lệ.');
 const header=await cloud.header(id);
 const type=sniffFile(header,item.kind);
 run('INSERT INTO settings(key,value) VALUES(?,?)','mime:'+id,type);
 run('UPDATE uploads SET claimed=0 WHERE id=?',id);
 return result(res,200,{uploadId:id});
}
if(p==='/api/uploads'&&method==='POST'){requirePerm(u,'beats.write');if(cloud)fail(400,'Dùng luồng tải file của dashboard.');const uploaded=await receiveUpload(req,u,url.searchParams.get('kind'));return result(res,201,uploaded)}
if(p==='/api/session'&&method==='GET')return result(res,200,{user:u?publicUser(u):null});
if(p==='/api/register'&&method==='POST'){let b=await body(req),email=String(b.email||'').toLowerCase().trim(),name=String(b.name||'').trim(),password=String(b.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length<2||name.length>80||password.length<10||password.length>200)fail(400,'Kiểm tra tên, email và mật khẩu tối thiểu 10 ký tự.');try{run('INSERT INTO users(email,name,password) VALUES(?,?,?)',email,name,saltHash(password))}catch{fail(409,'Email đã được đăng ký.')}return result(res,201,{message:'Đăng ký thành công, hãy đăng nhập.'})}
if(p==='/api/login'&&method==='POST'){let b=await body(req);let person=one('SELECT * FROM users WHERE email=?',String(b.email||'').trim().toLowerCase());if(!person||!verify(String(b.password||''),person.password))fail(401,'Email hoặc mật khẩu không đúng.');let token=randomBytes(32).toString('hex');run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)',hash(token),person.id,Date.now()+86400e3*7);return result(res,200,{user:publicUser(person)},{'Set-Cookie':`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${(cloud||process.env.SECURE_COOKIES==='1')?'; Secure':''}`})}
if(p==='/api/logout'&&method==='POST'){let token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);if(token)run('DELETE FROM sessions WHERE token=?',hash(token));return result(res,200,{ok:true},{'Set-Cookie':'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})}
if(p==='/api/beats'&&method==='GET')return result(res,200,{beats:q('SELECT id,title,genre,mood,bpm,key_note,price,art,preview,demo,created_at FROM beats WHERE published=1 ORDER BY id DESC').reverse().map(b=>({...b,art:b.art&&b.art.length===40?`/media/${b.art}`:b.art,preview:b.preview?`/media/${b.preview}`:''}))});
if(p==='/api/beats'&&method==='POST'){requirePerm(u,'beats.write');let b=await body(req),title=String(b.title||'').trim(),genre=String(b.genre||'').trim(),mood=String(b.mood||'').trim(),key=String(b.key_note||'').trim(),bpm=Number(b.bpm),price=Number(b.price);if(!title||title.length>100||!genre||genre.length>30||!mood||mood.length>30||!key||key.length>12||!Number.isInteger(bpm)||bpm<40||bpm>250||!Number.isInteger(price)||price<1000||price>100000000)fail(400,'Thông tin beat không hợp lệ.');let art=resolveUpload(b.art,'art',u),preview=resolveUpload(b.preview,'preview',u),master=resolveUpload(b.master,'master',u);let r;db.exec('BEGIN');try{r=run('INSERT INTO beats(title,genre,mood,bpm,key_note,price,art,preview,master) VALUES(?,?,?,?,?,?,?,?,?)',title,genre,mood,bpm,key,price,art,preview,master);claimUploads(b,u);audit(u,'beat.create',{id:Number(r.lastInsertRowid),title});db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return result(res,201,{id:Number(r.lastInsertRowid)})}
let editMatch=p.match(/^\/api\/beats\/(\d+)$/);if(editMatch&&method==='PATCH'){requirePerm(u,'beats.write');let b=await body(req),id=Number(editMatch[1]),old=one('SELECT * FROM beats WHERE id=? AND demo=0',id);if(!old)fail(404,'Không tìm thấy beat.');let title=String(b.title||'').trim(),genre=String(b.genre||'').trim(),mood=String(b.mood||'').trim(),key=String(b.key_note||'').trim(),bpm=Number(b.bpm),price=Number(b.price);if(!title||title.length>100||!genre||genre.length>30||!mood||mood.length>30||!key||key.length>12||!Number.isInteger(bpm)||bpm<40||bpm>250||!Number.isInteger(price)||price<1000||price>100000000)fail(400,'Thông tin beat không hợp lệ.');let art=b.art?resolveUpload(b.art,'art',u):old.art,preview=b.preview?resolveUpload(b.preview,'preview',u):old.preview,master=b.master?resolveUpload(b.master,'master',u):old.master;db.exec('BEGIN');try{run('UPDATE beats SET title=?,genre=?,mood=?,bpm=?,key_note=?,price=?,art=?,preview=?,master=? WHERE id=?',title,genre,mood,bpm,key,price,art,preview,master,id);claimUploads(b,u);audit(u,'beat.update',{id,title,changedFiles:['art','preview','master'].filter(k=>!!b[k])});db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return result(res,200,{ok:true})}
if(p==='/api/orders'&&method==='POST'){requireUser(u);let b=await body(req),beat=one('SELECT id,price FROM beats WHERE id=? AND published=1 AND demo=0',Number(b.beatId)),lic=licenses[b.license];if(!beat||!lic||b.license==='exclusive')fail(400,'Beat hoặc giấy phép chưa hỗ trợ.');let ref='BS'+randomBytes(6).toString('hex').toUpperCase(),amount=beat.price*lic.factor;run('INSERT INTO orders(user_id,beat_id,license,amount,ref) VALUES(?,?,?,?,?)',u.id,beat.id,b.license,amount,ref);let bank=sget('bank'),account=sget('account'),holder=sget('holder');let qr=bank&&account?`https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(account)}-compact2.png?${new URLSearchParams({amount:String(amount),addInfo:ref,accountName:holder})}`:null;return result(res,201,{ref,amount,qr,bankConfigured:!!qr})}
if(p==='/api/orders'&&method==='GET'){requireUser(u);let all=can(u,'orders.read')&&url.searchParams.get('all')==='1';return result(res,200,{orders:all?q('SELECT o.*,b.title,u.email FROM orders o JOIN beats b ON b.id=o.beat_id JOIN users u ON u.id=o.user_id ORDER BY o.id DESC'):q('SELECT o.*,b.title FROM orders o JOIN beats b ON b.id=o.beat_id WHERE o.user_id=? ORDER BY o.id DESC',u.id)})}
let qrMatch=p.match(/^\/api\/orders\/(\d+)\/qr$/);if(qrMatch&&method==='GET'){requireUser(u);let o=one('SELECT * FROM orders WHERE id=? AND user_id=?',Number(qrMatch[1]),u.id),bank=sget('bank'),account=sget('account'),holder=sget('holder');if(!o||o.status!=='pending')fail(404,'Đơn không còn chờ thanh toán.');let qr=bank&&account?`https://img.vietqr.io/image/${encodeURIComponent(bank)}-${encodeURIComponent(account)}-compact2.png?${new URLSearchParams({amount:String(o.amount),addInfo:o.ref,accountName:holder})}`:null;return result(res,200,{qr,ref:o.ref,amount:o.amount})}
let m=p.match(/^\/api\/orders\/(\d+)\/confirm$/);if(m&&method==='POST'){requirePerm(u,'orders.confirm');let o=one('SELECT * FROM orders WHERE id=?',Number(m[1]));if(!o)fail(404,'Không tìm thấy đơn.');if(o.status!=='pending')fail(409,'Đơn không còn chờ xác nhận.');run("UPDATE orders SET status='paid',paid_at=CURRENT_TIMESTAMP WHERE id=?",o.id);audit(u,'order.confirm',{order:o.id,amount:o.amount,ref:o.ref});return result(res,200,{ok:true})}
m=p.match(/^\/api\/orders\/(\d+)\/download$/);if(m&&method==='GET'){requireUser(u);let o=one('SELECT o.*,b.master FROM orders o JOIN beats b ON b.id=o.beat_id WHERE o.id=? AND o.user_id=?',Number(m[1]),u.id);if(!o||o.status!=='paid'||!o.master)fail(404,'File chưa sẵn sàng.');return serveMedia(res,o.master,true)}
if(p==='/api/messages'&&method==='GET'){requireUser(u);let target=can(u,'chat.reply')?Number(url.searchParams.get('userId')||0):u.id;if(can(u,'chat.reply')&&!target)return result(res,200,{threads:q('SELECT DISTINCT u.id,u.name,u.email FROM messages m JOIN users u ON u.id=m.user_id ORDER BY u.id DESC')});return result(res,200,{messages:q('SELECT m.id,m.body,m.created_at,u.name,u.role FROM messages m JOIN users u ON u.id=m.author_id WHERE m.user_id=? ORDER BY m.id',target)})}
if(p==='/api/messages'&&method==='POST'){requireUser(u);let b=await body(req),message=String(b.body||'').trim(),target=can(u,'chat.reply')?Number(b.userId):u.id;if(!message||message.length>2000||!one('SELECT id FROM users WHERE id=?',target))fail(400,'Tin nhắn không hợp lệ.');run('INSERT INTO messages(user_id,author_id,body) VALUES(?,?,?)',target,u.id,message);if(u.role!=='customer')audit(u,'chat.reply',{target});return result(res,201,{ok:true})}
if(p==='/api/admin/users'&&method==='GET'){requirePerm(u,'users.manage');return result(res,200,{users:q('SELECT id,name,email,role,created_at FROM users ORDER BY id').map(x=>({...x,permissions:q('SELECT permission FROM permissions WHERE user_id=?',x.id).map(p=>p.permission)}))})}
m=p.match(/^\/api\/admin\/users\/(\d+)$/);if(m&&method==='PATCH'){requirePerm(u,'users.manage');let b=await body(req),id=Number(m[1]);if(id===u.id)fail(400,'Không thể sửa quyền chính mình.');let target=one('SELECT * FROM users WHERE id=?',id);if(!target||target.role==='admin'||!['mod','customer'].includes(b.role))fail(400,'Tài khoản hoặc vai trò không hợp lệ.');let allowed=['beats.write','orders.read','orders.confirm','chat.reply'],perms=Array.isArray(b.permissions)?b.permissions.filter(x=>allowed.includes(x)):defaultPerms;db.exec('BEGIN');try{run('UPDATE users SET role=? WHERE id=?',b.role,id);run('DELETE FROM permissions WHERE user_id=?',id);if(b.role==='mod')for(const x of new Set(perms))run('INSERT INTO permissions VALUES(?,?)',id,x);audit(u,'user.permissions',{id,role:b.role,permissions:perms});db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return result(res,200,{ok:true})}
if(p==='/api/admin/audit'&&method==='GET'){requirePerm(u,'audit.read');return result(res,200,{events:q('SELECT a.*,u.name,u.email FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200')})}
if(p==='/api/admin/settings'&&method==='GET'){requirePerm(u,'settings.manage');return result(res,200,{bank:sget('bank'),account:sget('account'),holder:sget('holder')})}
if(p==='/api/admin/settings'&&method==='POST'){requirePerm(u,'settings.manage');let b=await body(req);if(!/^[A-Za-z0-9]{2,20}$/.test(b.bank||'')||!/^\d{5,25}$/.test(b.account||'')||!String(b.holder||'').trim()||String(b.holder).length>100)fail(400,'Thông tin ngân hàng không hợp lệ.');for(const k of ['bank','account','holder'])run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k,String(b[k]));audit(u,'settings.bank.update',{bank:b.bank,accountLast4:String(b.account).slice(-4)});return result(res,200,{ok:true})}
fail(404,'Không tìm thấy API.');}
function serveMedia(res,id,download=false){if(cloud)return cloud.media(res,id,sget('mime:'+id),download);if(!/^[a-f0-9]{40}$/.test(id))fail(404,'Không tìm thấy file.');const filename=path.join(data,'media',id);if(!existsSync(filename))fail(404,'Không tìm thấy file.');res.writeHead(200,{'Content-Type':readFileSync(filename+'.type','utf8'),'X-Content-Type-Options':'nosniff',...(download?{'Content-Disposition':'attachment; filename="beat-audio"'}:{})});createReadStream(filename).pipe(res)}
return async(req,res)=>{try{let url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return await api(req,res,url);let m=url.pathname.match(/^\/media\/([a-f0-9]{40})$/);if(m){if(!one('SELECT id FROM beats WHERE published=1 AND (art=? OR preview=?)',m[1],m[1]))fail(404,'Không tìm thấy file.');return await serveMedia(res,m[1])}let files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/admin':'admin.html','/admin/':'admin.html','/admin.js':'admin.js','/admin.css':'admin.css'},f=files[url.pathname];if(!f)fail(404,'Không tìm thấy trang.');res.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data: https://img.vietqr.io; style-src 'self' 'unsafe-inline'; script-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(readFileSync(path.join(root,'public',f)))}catch(e){console.error(e.status?e.message:e);if(!res.headersSent)result(res,e.status||500,{error:e.status?e.message:'Lỗi máy chủ.'});else res.end()}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const data=process.env.DATA_DIR||path.join(root,'data');
 mkdirSync(path.join(data,'media'),{recursive:true});
 const db=new DatabaseSync(path.join(data,'beatself.sqlite'));
 http.createServer(createApp(db,data)).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('BeatSelf running'));
}
