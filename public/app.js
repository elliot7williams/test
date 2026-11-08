const $ = (id) => document.getElementById(id);
const state = { file: null, decoded: null, objectURL: null, peaks: null, serverAvailable: false, published: null, speed: 1.25, volume: 1 };
const fileInput = $('audioFile');
const player = $('player');
const canvas = $('waveCanvas');
const ctx = canvas.getContext('2d');
let paintPending = false;

function notify(message, error = false, id = 'message') {
  const element = $(id); element.textContent = message; element.classList.toggle('error', error);
}
function safeName(name) { return (name || 'nightcore').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_. -]/gu, '_').trim().slice(0, 70) || 'nightcore'; }
function clock(time) { if (!Number.isFinite(time)) return '00:00'; const s = Math.floor(Math.max(0, time)); return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`; }
function playerSpeed(speed) {
  player.playbackRate = speed;
  // Nightcore changes pitch with speed, unlike tempo-preserving players.
  if ('preservesPitch' in player) player.preservesPitch = false;
  if ('webkitPreservesPitch' in player) player.webkitPreservesPitch = false;
  if ('mozPreservesPitch' in player) player.mozPreservesPitch = false;
}
function setSpeed(value) {
  state.speed = Number(value); $('speedRange').value = String(value);
  $('speedValue').textContent = `${state.speed.toFixed(2)}×`;
  playerSpeed(state.speed);
  document.querySelectorAll('.preset').forEach((button) => button.classList.toggle('active', Number(button.dataset.speed) === state.speed));
}
function setVolume(value) {
  state.volume = Number(value); $('volumeRange').value = String(value);
  $('volumeValue').textContent = `${Math.round(state.volume * 100)}%`;
  player.volume = Math.min(1, state.volume);
}
function calculatePeaks(buffer, count = 110) {
  const data = buffer.getChannelData(0), bucket = Math.max(1, Math.floor(data.length / count));
  const peaks = [];
  for (let x = 0; x < count; x++) { let maximum = 0; const start = x * bucket, end = Math.min(start + bucket, data.length); const stride = Math.max(1, Math.floor(bucket / 80)); for (let i = start; i < end; i += stride) maximum = Math.max(maximum, Math.abs(data[i])); peaks.push(maximum); }
  return peaks;
}
function drawWave() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || 600, height = canvas.clientHeight || 100;
  if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) { canvas.width = Math.floor(width * pixelRatio); canvas.height = Math.floor(height * pixelRatio); }
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const peaks = state.peaks || Array.from({length:110}, (_,i) => .15 + .09 * Math.sin(i * .5) ** 2);
  const duration = player.duration || state.decoded?.duration || 1;
  const fraction = Math.max(0, Math.min(1, (player.currentTime || 0) / duration));
  const gap = 3, barWidth = Math.max(2, width / peaks.length - gap);
  peaks.forEach((peak, index) => {
    const amplitude = Math.max(6, Math.min(75, peak * 86));
    ctx.fillStyle = (index / peaks.length < fraction) ? '#ff7eac' : '#675d89';
    const x = index / peaks.length * width, y = height / 2 - amplitude / 2;
    ctx.fillRect(x, y, barWidth, amplitude);
  });
}
function requestPaint() { if (paintPending) return; paintPending = true; requestAnimationFrame(() => { paintPending = false; drawWave(); }); }
async function loadFile(file, opts = {}) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { notify('This demo accepts source audio files up to 20 MB.', true); return; }
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  notify('Reading and decoding your track…');
  try {
    const buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration > 720) throw new Error('Please choose audio shorter than 12 minutes.');
    if (!buffer.duration) throw new Error('The file contains no audio.');
    if (state.objectURL) URL.revokeObjectURL(state.objectURL);
    state.file = file; state.decoded = buffer; state.objectURL = URL.createObjectURL(file); state.peaks = calculatePeaks(buffer); state.published = null;
    player.pause(); player.src = state.objectURL; player.load();
    const title = opts.title || safeName(file.name);
    $('fileTitle').textContent = title;
    $('fileSub').textContent = `${clock(buffer.duration)} · ${(file.size / 1024 / 1024).toFixed(1)} MB · ready to remix`;
    $('waveEmpty').style.display = 'none';
    $('trackName').value = `${title} (Nightcore)`;
    if (opts.artist) $('artistName').value = opts.artist;
    $('downloadBtn').disabled = false; $('shareToggle').disabled = false;
    $('publishBtn').disabled = !state.serverAvailable;
    if (opts.speed) setSpeed(opts.speed);
    else setSpeed(state.speed);
    $('timeText').textContent = `00:00 / ${clock(buffer.duration)}`;
    requestPaint(); notify('Track ready! Adjust the speed and press play, or export your mix.');
  } catch (err) { notify(`Could not read this audio file: ${err.message}`, true); }
  finally { await audioContext.close(); }
}
function wavEncode(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels), samples = buffer.length;
  const out = new ArrayBuffer(44 + samples * channels * 2), view = new DataView(out);
  function str(offset, text) { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); }
  str(0, 'RIFF'); view.setUint32(4, out.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples * channels * 2, true);
  const planes = Array.from({length: channels}, (_,i) => buffer.getChannelData(i));
  let cursor = 44;
  for (let i = 0; i < samples; i++) for (let c = 0; c < channels; c++) { const sample = Math.max(-1, Math.min(1, planes[c][i])); view.setInt16(cursor, sample < 0 ? sample * 32768 : sample * 32767, true); cursor += 2; }
  return new Blob([out], {type:'audio/wav'});
}
async function renderAudio() {
  if (!state.decoded) throw new Error('Choose an audio file first.');
  const src = state.decoded;
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error('Your browser does not support offline audio exporting.');
  const sampleRate = 44100, count = Math.ceil(src.duration / state.speed * sampleRate);
  const offline = new OfflineContext(Math.min(2, src.numberOfChannels), count, sampleRate);
  const source = offline.createBufferSource(), gain = offline.createGain();
  source.buffer = src; source.playbackRate.value = state.speed;
  gain.gain.value = state.volume;
  source.connect(gain); gain.connect(offline.destination); source.start(0);
  return offline.startRendering();
}
async function saveWav() {
  const button = $('downloadBtn'); button.disabled = true; button.textContent = 'Rendering…';
  notify('Creating your Nightcore WAV file…');
  try {
    const blob = wavEncode(await renderAudio()), url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${safeName($('trackName').value || state.file.name)}.wav`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify(`Your WAV is ready (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
  } catch (err) { notify(`Export failed: ${err.message}`, true); }
  finally { button.disabled = false; button.textContent = '↓ Export WAV'; }
}
function makeDemo() {
  const rate = 22050, seconds = 9, frames = rate * seconds;
  const audio = new AudioBuffer({length: frames, sampleRate:rate, numberOfChannels:2});
  const notes = [329.63,392,440,523.25,493.88,440,392,329.63,293.66,329.63,392,440,392,349.23,329.63,261.63];
  const left = audio.getChannelData(0), right = audio.getChannelData(1);
  for (let i=0; i<frames; i++) {
    const t = i/rate, beat = t/.48, seq = Math.min(notes.length-1, Math.floor(beat*2)), phase = t*notes[seq]*Math.PI*2;
    const notePhase = (beat*2)%1, env = Math.pow(1-notePhase,2.5), bass = Math.sin(Math.PI*2*notes[Math.floor(beat)%notes.length]/4*t)*.11;
    const lead = (Math.sin(phase)+.18*Math.sin(phase*2)+.11*Math.sin(phase*3))*env*.22;
    const kick = Math.sin(Math.PI*2*52*t)*Math.exp(-((beat%1)*11))*.19;
    const pad = Math.sin(Math.PI*2*164.81*t)*.037;
    const fade = Math.min(1,t/.2,(seconds-t)/.35);
    left[i] = (lead + kick + bass + pad)*fade;
    right[i] = (lead*.92 + kick + bass*.7 - pad)*fade;
  }
  return new File([wavEncode(audio)],'Stardust Demo Melody.wav',{type:'audio/wav'});
}
async function checkServer() {
  try { const response = await fetch('/api/health', {cache:'no-store'}); if (!response.ok) throw Error('offline'); const value = await response.json(); if (!value.ok) throw Error('offline'); state.serverAvailable = true;
    $('serverStatus').textContent = '● LIVE COMMUNITY'; $('publishInfo').textContent = 'Uploads are available for up to 24 hours and can be replaced as new songs arrive.';
  } catch { state.serverAvailable = false; $('serverStatus').textContent = '○ LOCAL PREVIEW'; $('publishInfo').textContent = 'You can convert and download locally. To publish publicly, start the included Node.js server.'; }
  $('publishBtn').disabled = !state.serverAvailable || !state.file;
  await refreshFeed();
}
function timeRemaining(iso) { const ms = new Date(iso).getTime() - Date.now(); if (ms <= 0) return 'expiring'; const hours = Math.floor(ms/3600000), mins = Math.ceil((ms%3600000)/60000); return hours > 0 ? `${hours}h left` : `${mins}m left`; }
async function refreshFeed() {
  const list = $('feedList');
  if (!state.serverAvailable) { $('trackCount').textContent = '0'; list.replaceChildren(emptyFeed('Local preview mode', 'Start the included server to see the public creations feed.')); return; }
  try {
    const response = await fetch('/api/tracks', {cache:'no-store'}); if (!response.ok) throw Error('Could not fetch tracks');
    const tracks = await response.json(); $('trackCount').textContent = tracks.length; list.replaceChildren();
    if (!tracks.length) { list.append(emptyFeed('Nothing here yet', 'Be the first to share a nightcore creation.')); return; }
    for (const track of tracks) {
      const row = document.createElement('div'); row.className = 'track-row';
      const play = document.createElement('button'); play.type='button';play.className='track-play';play.textContent='▶';play.title=`Load and play ${track.title}`;
      play.addEventListener('click',async()=>{ play.disabled = true;play.textContent='…';try{const result = await fetch(track.audioUrl);if(!result.ok)throw Error('Audio not found');const blob = await result.blob();const file = new File([blob],`${safeName(track.title)}.${track.extension||'mp3'}`,{type:track.mime});await loadFile(file,{title:track.title,artist:track.artist,speed:track.speed});await player.play();document.querySelector('#studio').scrollIntoView({behavior:'smooth'});}catch(err){notify(`Could not load shared track: ${err.message}`,true)}finally{play.disabled=false;play.textContent='▶'}});
      const main=document.createElement('div');main.className='track-main';const title=document.createElement('strong');title.textContent=track.title;const by=document.createElement('span');by.textContent=`by ${track.artist||'Anonymous DJ'}`;main.append(title,by);
      const speed=document.createElement('span');speed.className='track-speed';speed.textContent=`${Number(track.speed).toFixed(2)}×`;
      const time=document.createElement('span');time.className='track-time';time.textContent=timeRemaining(track.expiresAt);
      row.append(play,main,speed,time);list.append(row);
    }
  } catch { list.replaceChildren(emptyFeed('Feed unavailable', 'Try refreshing the page.')); }
}
function emptyFeed(title, sub) { const wrap=document.createElement('div');wrap.className='empty-feed';const icon=document.createElement('span');icon.textContent='♫';const strong=document.createElement('strong');strong.textContent=title;const p=document.createElement('p');p.textContent=sub;wrap.append(icon,strong,p);return wrap; }
async function publish(event) {
  event.preventDefault();
  if (!state.serverAvailable || !state.file) return notify('Load a song and start the server to share.', true, 'publishMessage');
  if (!$('rightsCheck').checked) return notify('You must confirm you have rights to share the audio.', true, 'publishMessage');
  const button=$('publishBtn');button.disabled=true;button.textContent='Uploading…';
  try {
    const response = await fetch('/api/tracks', {method:'POST',headers:{
      'Content-Type':'application/octet-stream','X-Track-Name':encodeURIComponent($('trackName').value.trim()),
      'X-Artist-Name':encodeURIComponent($('artistName').value.trim()||'Anonymous DJ'),
      'X-Speed':String(state.speed),'X-File-Name':encodeURIComponent(state.file.name),
      'X-Mime-Type':state.file.type||'application/octet-stream','X-Rights-Confirmed':'yes'
    },body:state.file});
    const result=await response.json().catch(()=>({error:'Unexpected server response'}));
    if (!response.ok) throw Error(result.error||`HTTP ${response.status}`);
    state.published=result;
    notify('Published! Your track will disappear within 24 hours or when new tracks replace it.',false,'publishMessage');
    $('rightsCheck').checked=false;
    await refreshFeed();$('creations').scrollIntoView({behavior:'smooth'});
  } catch(err){notify(`Could not publish: ${err.message}`,true,'publishMessage');}
  finally{button.disabled=false;button.innerHTML='Publish to recent creations <span>↗</span>';}
}
function attach() {
  $('dropZone').addEventListener('click',()=>fileInput.click());
  $('dropZone').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();fileInput.click();}});
  for (const name of ['dragenter','dragover']) $('dropZone').addEventListener(name,event=>{event.preventDefault();$('dropZone').classList.add('dragover')});
  for (const name of ['dragleave','drop']) $('dropZone').addEventListener(name,event=>{event.preventDefault();$('dropZone').classList.remove('dragover')});
  $('dropZone').addEventListener('drop',event=>loadFile(event.dataTransfer?.files?.[0]));
  fileInput.addEventListener('change',event=>loadFile(event.target.files?.[0]));
  $('demoBtn').addEventListener('click',()=>loadFile(makeDemo(),{title:'Stardust Demo Melody',artist:'NightcoreMaker Revival'}));
  $('speedRange').addEventListener('input',event=>setSpeed(event.target.value));
  $('volumeRange').addEventListener('input',event=>setVolume(event.target.value));
  document.querySelectorAll('.preset').forEach(b=>b.addEventListener('click',()=>setSpeed(b.dataset.speed)));
  $('downloadBtn').addEventListener('click',saveWav);
  $('shareToggle').addEventListener('click',()=>{$('sharePanel').scrollIntoView({behavior:'smooth'});$('trackName').focus({preventScroll:true});});
  $('shareForm').addEventListener('submit',publish);$('refreshBtn').addEventListener('click',refreshFeed);
  player.addEventListener('timeupdate',()=>{$('timeText').textContent=`${clock(player.currentTime)} / ${clock(player.duration)}`;requestPaint()});
  player.addEventListener('loadedmetadata',()=>{playerSpeed(state.speed);requestPaint()});
  canvas.addEventListener('click',event=>{if(!state.file||!Number.isFinite(player.duration))return;const rect=canvas.getBoundingClientRect();player.currentTime=Math.max(0,Math.min(player.duration,player.duration*(event.clientX-rect.left)/rect.width));requestPaint()});
  window.addEventListener('resize',requestPaint);
  setSpeed(1.25);setVolume(1);requestPaint();checkServer();
}
attach();

// Purely visual, optional nostalgia-inspired presentation.
// This does not claim to reconstruct the original site's exact appearance.
(function enableClassicView() {
  const toggle = document.getElementById('classicToggle');
  const banner = document.getElementById('classicBanner');
  if (!toggle || !banner) return;
  let selected = false;
  try { selected = localStorage.getItem('nightcoremaker.view') === 'classic'; } catch {}
  const apply = () => {
    document.body.classList.toggle('classic-mode', selected);
    banner.hidden = !selected;
    toggle.setAttribute('aria-pressed', String(selected));
    toggle.textContent = selected ? '◫ Modern view' : '◫ Classic view';
  };
  toggle.addEventListener('click', () => {
    selected = !selected;
    try { localStorage.setItem('nightcoremaker.view', selected ? 'classic' : 'modern'); } catch {}
    apply();
  });
  apply();
})();
