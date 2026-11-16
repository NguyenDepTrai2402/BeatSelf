import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { get, head, put, presignUrl, issueSignedToken } from '@vercel/blob';
import { createApp } from '../server.mjs';

const snapshot='database/beatself-v1.sqlite';
const demo=new Map(Array.from({length:6},(_,i)=>[createHash('sha1').update('beatself-demo-'+(i+1)).digest('hex'),i+1]));

async function signed(id,operation,limits={}){
  const pathname='media/'+id;
  const validUntil=Date.now()+15*60*1000;
  const token=await issueSignedToken({pathname,operations:[operation],validUntil,...limits});
  const options={pathname,operation,access:'private',validUntil};
  if(operation==='put')Object.assign(options,limits,{allowOverwrite:false,addRandomSuffix:false});
  return (await presignUrl(token,options)).presignedUrl;
}
const cloud={
  uploadUrl:(id,size)=>signed(id,'put',{maximumSizeInBytes:size}),
  async header(id){
    const response=await fetch(await signed(id,'get'),{headers:{Range:'bytes=0-31'}});
    if(response.status!==206){await response.body?.cancel();throw Object.assign(new Error('Không đọc được đầu file.'),{status:400})}
    return Buffer.from(await response.arrayBuffer());
  },
  async media(res,id,type,download){
    if(demo.has(id))return res.writeHead(302,{Location:'/demo/'+demo.get(id)+'.wav'}).end();
    if(!type)return res.writeHead(404).end();
    const headers={};
    if(res.req.headers.range)headers.Range=res.req.headers.range;
    const media=await fetch(await signed(id,'get'),{headers});
    if(!media.ok)return res.writeHead(media.status).end();
    const out={'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
    for(const key of ['content-range','content-length'])if(media.headers.has(key))out[key]=media.headers.get(key);
    if(download)out['Content-Disposition']='attachment; filename="beat-audio"';
    res.writeHead(media.status,out);
    const {pipeline}=await import('node:stream/promises');
    await pipeline(media.body,res);
  }
};

export default async function handler(req,res){
  const dir=await mkdtemp(path.join(tmpdir(),'beatself-'));
  const file=path.join(dir,'state.sqlite');
  let db;
  try{
    let writeVersion;
    if(!['GET','HEAD'].includes(req.method)){
      try{writeVersion=(await head(snapshot)).etag}
      catch(e){if(e.name!=='BlobNotFoundError'&&!/not found|does not exist/i.test(e.message))throw e}
    }
    const previous=await get(snapshot,{access:'private',useCache:false});
    if(previous)await writeFile(file,Buffer.from(await new Response(previous.stream).arrayBuffer()));
    db=new DatabaseSync(file);
    const app=createApp(db,dir,cloud);
    const isRead=['GET','HEAD'].includes(req.method);
    // Only release a successful mutation (including its session cookie) after durable commit.
    const pending={writeHead(status,headers){this.status=status;this.headers=headers;return this},end(body){this.body=body}};
    if(!previous||!isRead){
      if(!isRead)await app(req,pending);
      if(!previous||pending.status<400){
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        const data=await readFile(file);
        const opts=previous?{allowOverwrite:true,ifMatch:writeVersion||previous.blob.etag.replace(/^"|"$/g,'')}:{allowOverwrite:false};
        try{await put(snapshot,data,{access:'private',addRandomSuffix:false,...opts})}
        catch(e){if(!previous&&isRead&&/already exists|precondition/i.test(e.name+' '+e.message))return await handler(req,res);if(/precondition|already exists|etag mismatch/i.test(e.name+' '+e.message))return res.status(409).json({error:'Dữ liệu vừa thay đổi. Vui lòng thử lại.'});throw e}
      }
      if(!isRead)return res.writeHead(pending.status,pending.headers).end(pending.body);
    }
    await app(req,res);
  }catch(error){
    console.error('BeatSelf handler',error.name,error.message);
    if(!res.headersSent)res.status(503).json({error:'Không thể truy cập kho dữ liệu.'});
    else res.end();
  }finally{db?.close();await rm(dir,{recursive:true,force:true})}
}
