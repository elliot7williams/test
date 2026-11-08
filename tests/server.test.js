import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'nightcore-test-'));
process.env.NIGHTCORE_DATA_DIR = tmp;
const {startServer} = await import('../server.js');
const server = await startServer(0);
const address = `http://127.0.0.1:${server.address().port}`;

function smallWav() {
  const samples = 120, output = Buffer.alloc(44 + samples * 2);
  output.write('RIFF',0); output.writeUInt32LE(output.length-8,4); output.write('WAVEfmt ',8);
  output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(1,22);
  output.writeUInt32LE(44100,24);output.writeUInt32LE(88200,28);output.writeUInt16LE(2,32);
  output.writeUInt16LE(16,34);output.write('data',36);output.writeUInt32LE(samples*2,40);
  return output;
}

test('server health, static and public publishing flow', async(t)=>{
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(tmp,{recursive:true,force:true});});
  let response = await fetch(`${address}/api/health`);
  assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  response = await fetch(`${address}/`);
  assert.equal(response.status,200);assert.match(await response.text(),/NightcoreMaker/);
  response = await fetch(`${address}/api/tracks`);
  assert.deepEqual(await response.json(),[]);
  response = await fetch(`${address}/api/tracks`,{method:'POST',headers:{'x-track-name':'Not allowed','x-file-name':'test.wav','x-speed':'1.25'},body:smallWav()});
  assert.equal(response.status,400);
  const params={method:'POST',headers:{'content-type':'application/octet-stream','x-rights-confirmed':'yes','x-track-name':encodeURIComponent('Test Nightcore'),'x-artist-name':encodeURIComponent('Demo Creator'),'x-file-name':'test.wav','x-speed':'1.25'},body:smallWav()};
  response = await fetch(`${address}/api/tracks`,params);
  assert.equal(response.status,201);const published=await response.json();assert.ok(published.id);
  response = await fetch(`${address}/api/tracks`);
  const list=await response.json();assert.equal(list.length,1);assert.equal(list[0].speed,1.25);assert.equal(list[0].artist,'Demo Creator');
  response = await fetch(address+list[0].audioUrl,{headers:{Range:'bytes=0-23'}});
  assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,24);
  response = await fetch(`${address}/api/tracks`,{...params,headers:{...params.headers,'x-file-name':'x.mp3'}});
  assert.equal(response.status,400);assert.match((await response.json()).error,/content does not match/i);
  response = await fetch(`${address}/%2e%2e/server.js`);
  assert.notEqual(response.status,200);
});
