// Zero-dependency, self-hostable community feed. Requires Node.js 20+.
import http from 'node:http';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const STORAGE = path.resolve(process.env.NIGHTCORE_DATA_DIR || path.join(ROOT,'data'));
const INDEX = path.join(STORAGE, 'tracks.json');
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TRACKS = 40;
const EXPIRE_MS = 24 * 60 * 60 * 1000;
const supported = {
  mp3: {mime:'audio/mpeg', verify:buffer=>buffer.toString('ascii',0,3)==='ID3'||(buffer[0]===0xff&&(buffer[1]&0xe0)===0xe0)},
  wav: {mime:'audio/wav', verify:buffer=>buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WAVE'},
  ogg: {mime:'audio/ogg', verify:buffer=>buffer.toString('ascii',0,4)==='OggS'},
  flac: {mime:'audio/flac',verify:buffer=>buffer.toString('ascii',0,4)==='fLaC'},
  m4a: {mime:'audio/mp4', verify:buffer=>buffer.toString('ascii',4,8)==='ftyp'},
  aac: {mime:'audio/aac',verify:buffer=>buffer[0]===0xff&&(buffer[1]&0xf0)===0xf0}
};
const extFor = ext => ext === 'mp4' ? 'm4a' : ext;
let tracks = [];
let writeQueue = Promise.resolve();
const recent = new Map();
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml; charset=utf-8','.json':'application/json; charset=utf-8'};

function send(res, code, body, type='application/json; charset=utf-8') {
  res.writeHead(code, {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function userText(value, max) {
  try { return decodeURIComponent(String(value||'')).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max); }
  catch { return ''; }
}
function clientIp(req) { return req.socket.remoteAddress || 'unknown'; }
function throttle(req) {
  const ip=clientIp(req), now=Date.now(); let attempts=recent.get(ip)||[];
  attempts=attempts.filter(t=>t>now-60*60*1000);
  if(attempts.length>=10) return false;
  attempts.push(now);recent.set(ip,attempts);
  if(recent.size>1000) for(const [key,val] of recent) if(!val.some(t=>t>now-60*60*1000))recent.delete(key);
  return true;
}
async function persist() {
  const temp=INDEX+'.tmp';
  await fs.writeFile(temp,JSON.stringify(tracks,null,2),'utf8');
  await fs.rename(temp,INDEX);
}
function enqueuePersist() { writeQueue=writeQueue.then(persist); return writeQueue; }
async function prune() {
  const now=Date.now();let changed=false;
  const survivors=[];
  for(const track of tracks){
    if(new Date(track.expiresAt).getTime()<=now||survivors.length>=MAX_TRACKS){
      await fs.rm(path.join(STORAGE,track.filename),{force:true}).catch(()=>{});changed=true;
    } else survivors.push(track);
  }
  tracks=survivors;
  if(changed) await enqueuePersist();
}
async function setup() {
  await fs.mkdir(STORAGE,{recursive:true});
  try { const contents=JSON.parse(await fs.readFile(INDEX,'utf8')); if(Array.isArray(contents))tracks=contents; }
  catch { tracks=[]; }
  tracks.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  await prune();
}
async function staticFile(req,res,pathname) {
  let target;
  try { target=decodeURIComponent(pathname); } catch { return send(res,400,{error:'Malformed path'}); }
  if(target==='/')target='/index.html';
  if(!/^\/[a-zA-Z0-9_./-]+$/.test(target) || target.includes('..'))return send(res,404,{error:'Not found'});
  const full=path.resolve(PUBLIC,'.'+target);
  if(!full.startsWith(PUBLIC+path.sep))return send(res,404,{error:'Not found'});
  try {
    const info=await fs.stat(full);
    if(!info.isFile())return send(res,404,{error:'Not found'});
    const data=await fs.readFile(full);
    res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'application/octet-stream','Content-Length':data.length,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=300'});
    if(req.method==='HEAD')res.end();else res.end(data);
  } catch {send(res,404,{error:'Not found'});}
}
async function postTrack(req,res) {
  if(req.headers['x-rights-confirmed']!=='yes')return send(res,400,{error:'Confirm that you have permission to share this recording.'});
  if(!throttle(req))return send(res,429,{error:'Upload limit reached. Try again later.'});
  const len=Number(req.headers['content-length']);
  if(Number.isFinite(len)&&len>MAX_BYTES)return send(res,413,{error:'Audio exceeds the 20 MB limit.'});
  const title=userText(req.headers['x-track-name'],90),artist=userText(req.headers['x-artist-name'],60)||'Anonymous DJ';
  const originalName=userText(req.headers['x-file-name'],150),extension=extFor(path.extname(originalName).slice(1).toLowerCase());
  const speed=Number(req.headers['x-speed']);
  if(!title||!supported[extension]||!Number.isFinite(speed)||speed<.65||speed>1.75)return send(res,400,{error:'Valid title, audio file type and speed are required.'});
  const id=crypto.randomUUID(),filename=`${id}.${extension}`,filePath=path.join(STORAGE,filename);
  let size=0, firstBytes=Buffer.alloc(0), exceeded=false;
  try {
    const output=createWriteStream(filePath,{flags:'wx',mode:0o600});
    req.on('data',part=>{
      size+=part.length;
      if(firstBytes.length<16)firstBytes=Buffer.concat([firstBytes,part.subarray(0,16-firstBytes.length)]);
      if(size>MAX_BYTES){exceeded=true;req.destroy();}
    });
    await pipeline(req,output);
    if(exceeded||!size)throw Error('Audio too large or empty.');
    if(!supported[extension].verify(firstBytes))throw Error('Audio file content does not match its extension.');
    const createdAt=new Date(),expiresAt=new Date(createdAt.getTime()+EXPIRE_MS).toISOString();
    const track={id,title,artist,speed,createdAt:createdAt.toISOString(),expiresAt,filename,mime:supported[extension].mime,extension,size};
    tracks.unshift(track);
    await prune();await enqueuePersist();
    send(res,201,{id,expiresAt,message:'Uploaded'});
  } catch(err) { await fs.rm(filePath,{force:true}).catch(()=>{});if(!res.writableEnded&&!res.destroyed)send(res,400,{error:err.message||'Upload failed'}); }
}
async function audioFile(req,res,id) {
  await prune();
  const track=tracks.find(x=>x.id===id);
  if(!track)return send(res,404,{error:'Audio unavailable or expired'});
  try {
    const file=await fs.readFile(path.join(STORAGE,track.filename));
    // Some iOS audio players request byte ranges.
    const range=req.headers.range;
    let start=0,end=file.length-1,status=200;
    if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return send(res,416,{error:'Invalid range'});
      if(match[1])start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end);
      if(!match[1]&&match[2])start=Math.max(0,file.length-Number(match[2]));
      if(start>end||start>=file.length)return send(res,416,{error:'Range not satisfiable'});
      status=206;
    }
    const headers={'Content-Type':track.mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'};
    if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${file.length}`;
    res.writeHead(status,headers);if(req.method==='HEAD')res.end();else res.end(file.subarray(start,end+1));
  } catch {send(res,404,{error:'Audio missing'});}
}
export function createServer() {
  return http.createServer(async(req,res)=>{
    try {
      const {pathname}=new URL(req.url,'http://localhost');
      if(pathname==='/api/health'&&req.method==='GET')return send(res,200,{ok:true});
      if(pathname==='/api/tracks'&&req.method==='GET'){
        await prune();return send(res,200,tracks.map(({id,title,artist,speed,createdAt,expiresAt,mime,extension})=>({id,title,artist,speed,createdAt,expiresAt,mime,extension,audioUrl:`/api/audio/${id}`})));
      }
      if(pathname==='/api/tracks'&&req.method==='POST')return await postTrack(req,res);
      if(/^\/api\/audio\/[0-9a-f-]{36}$/.test(pathname)&&(req.method==='GET'||req.method==='HEAD'))return await audioFile(req,res,pathname.split('/').pop());
      if(pathname.startsWith('/api/'))return send(res,404,{error:'Unknown endpoint'});
      if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Method not allowed'});
      return await staticFile(req,res,pathname);
    } catch(err) {console.error(err);if(!res.headersSent)send(res,500,{error:'Server error'});}
  });
}
export async function startServer(port=Number(process.env.PORT)||3000) {
  await setup();const server=createServer();
  await new Promise(resolve=>server.listen(port,process.env.HOST||'127.0.0.1',resolve));
  console.log(`NightcoreMaker Revival running at http://${process.env.HOST||'127.0.0.1'}:${server.address().port}`);
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer().catch(err=>{console.error(err);process.exitCode=1});
