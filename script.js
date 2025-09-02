// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app-check.js";
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDpntEY5iTfSU10pxXBvgjbjNRDFI3ZUlM",
  authDomain: "sturdy-dragon-470812-d0.firebaseapp.com",
  projectId: "sturdy-dragon-470812-d0",
  storageBucket: "sturdy-dragon-470812-d0.firebasestorage.app",
  messagingSenderId: "394864264450",
  appId: "1:394864264450:web:33f8f6293b998b18b7ae1b"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);

// You get this key when you register your site for reCAPTCHA v3 in the reCAPTCHA admin console.
const reCaptchaV3SiteKey = '6LfqWrsrAAAAAFThhOcgP_nA6_jBdCVyA-oBVT50';
// Initialize App Check
if (typeof self !== 'undefined' && self.hasOwnProperty('grecaptcha')) {
  // Pass your Firebase app instance and your reCAPTCHA v3 site key to initialize App Check.
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(reCaptchaV3SiteKey),
    isTokenAutoRefreshEnabled: true
  });
} else {
  // Fallback for environments where 'grecaptcha' might not be available
  console.warn("reCAPTCHA v3 script not loaded. App Check may not function correctly.");
  // Consider initializing with a debug provider for local development if needed:
  // initializeAppCheck(app, { provider: new AppCheckDebugProvider(), isTokenAutoRefreshEnabled: true });
}
console.log("Firebase App Check initialized with reCAPTCHA v3 provider.");
const db = getFirestore(app);


// --- Sovelluksen tila ---
const state = {
  players: [],
  totals: {},
  placementPoints: [],
  events: [],
  currentEventIndex: 0,
  timer: { running: false, startTs: 0, elapsedMs: 0, intervalId: null },
  started: false
};

// Dokumentin ID Firestoreen
let gameName = '';

// --- Apurit ---
const qs  = (s,r=document) => r.querySelector(s);
const qsa = (s,r=document) => Array.from(r.querySelectorAll(s));
const pad2 = n => String(n).padStart(2,'0');
const pad3 = n => String(n).padStart(3,'0');

function showToast(msg, type='') {
  const t = qs('#toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.hidden = false;
  setTimeout(() => t.hidden = true, 2200);
}

function isTimeFormat(v) { return /^\d{1,2}\.\d{2}\.\d{1,3}$/.test(v.trim()); }
function isIntegerStr(v) { return /^-?\d+$/.test(v.trim()); }
function timeToMs(str) {
  const [m,s,ms] = str.split('.').map(x=>parseInt(x,10));
  return (m||0)*60000 + (s||0)*1000 + (ms||0);
}
function msToDisplay(ms) {
  const m  = Math.floor(ms/60000);
  const s  = Math.floor((ms%60000)/1000);
  const mi = ms % 1000;
  return `${pad2(m)}.${pad2(s)}.${pad3(mi)}`;
}

// --- Tilankäsittely ja synkronointi ---
function updatePlacementPoints(){
  const n = state.players.length;
  state.placementPoints = Array.from({length:n}, (_,i)=>n - i);
}

function ensureTotalsForPlayers(){
  state.players.forEach(p=>{ if (!(p in state.totals)) state.totals[p] = 0; });
  Object.keys(state.totals).forEach(p=>{
    if (!state.players.includes(p)) delete state.totals[p];
  });
}

function syncEventsPlayers(){
  state.events.forEach(ev=>{
    state.players.forEach(p=>{
      if (!(p in ev.results)) ev.results[p] = '';
      if (!(p in ev.locks))   ev.locks[p]   = false;
    });
    Object.keys(ev.results).forEach(p=>{
      if (!state.players.includes(p)) {
        delete ev.results[p];
        delete ev.locks[p];
      }
    });
  });
}

function currentEvent() {
  return state.events[state.currentEventIndex];
}

// --- Firestore-synk: tägää local ↔ pilvi
async function syncWithFirestore(){
  if(!gameName) return;
  try {
    const docRef = doc(db, "games", gameName);
    const snap = await getDoc(docRef);

    if(!snap.exists()) {
      // 🔹 Peli poistettu Firestoresta → poista myös tältä laitteelta
      localStorage.removeItem('pistelaskuri');
      localStorage.removeItem('pistelaskuriGameName');
      gameName = '';
      resetAll(); // tämä vie etusivulle ja nollaa tilan
      showToast('Peli on poistettu', 'error');
      return;
    }
    const remote = JSON.stringify(snap.data());
    const local  = localStorage.getItem('pistelaskuri')||'';
    if(remote!==local){
      localStorage.setItem('pistelaskuri',remote);
      loadState();
      // päivitä UI jos ollaan auki
      if(state.started){
        renderSettings();
        renderEventsHeader();
        renderEventInputs();
        renderTimerSelectors();
        renderTotals();
      }
    }
  } catch(e){
    console.error('sync error',e);
  }
}

// --- Persistointi: localStorage + Firestore ---
async function saveState(){
  const payload={
    players:state.players, totals:state.totals,
    placementPoints:state.placementPoints,
    events:state.events,
    currentEventIndex:state.currentEventIndex,
    started:state.started
  };
  const raw=JSON.stringify(payload);
  localStorage.setItem('pistelaskuri',raw);
  localStorage.setItem('pistelaskuriGameName',gameName);

  if(gameName){
    try {
      await setDoc(doc(db, "games", gameName), payload);
    } catch (e) {
      console.error("save error", e);
      showToast("Virhe tallennuksessa", "error");
    }
  }
}

function loadState(){
  const raw=localStorage.getItem('pistelaskuri');
  if(!raw) return;
  try {
    const obj=JSON.parse(raw);
    state.players=obj.players||[];
    state.totals=obj.totals||{};
    state.placementPoints=obj.placementPoints||[];
    state.events=obj.events||[];
    state.currentEventIndex=obj.currentEventIndex||0;
    state.started=obj.started||false;
  } catch{}
}

// --- PELIN ALOITUS JA LOPETUS ---

async function startNewGame(){
  const name=qs('#gameNameInput').value.trim();
  if(!name){ showToast('Anna pelin nimi','error'); return; }

  try {
    const snap = await getDoc(doc(db, "games", name));
    if (snap.exists()) {
      showToast("Pelin nimi varattu", "error");
      return;
    }
  } catch (e) {
    console.error(e);
    showToast("Virhe tarkistuksessa", "error");
  }
  
  // Poista vanha peli Firestonesta
  if (gameName) {
    try {
      await deleteDoc(doc(db, "games", gameName));
    } catch (e) {
      console.warn("delete old game error", e);
    }
  }

  // Nollaa localStorage ja tila
  localStorage.removeItem('pistelaskuri');
  localStorage.removeItem('pistelaskuriGameName');
  gameName=name;
  Object.assign(state,{
    players:[], totals:{}, placementPoints:[],
    events:[], currentEventIndex:0, started:false
  });
  clearInterval(state.timer.intervalId);
  state.timer.running=false; state.timer.elapsedMs=0;

  ensureTotalsForPlayers();
  updatePlacementPoints();
  syncEventsPlayers();

  qs('#mainHeader').hidden=false;
  renderSettings();
  renderTotals();
  switchView('settingsView');
  showToast('Uusi peli aloitettu','success');
}

async function loadGame(){
  const name=qs('#gameNameInput').value.trim();
  if(!name){ showToast('Anna pelin nimi','error'); return; }
  gameName=name;

  let snap;
  try {
    snap = await getDoc(doc(db, "games", name));
  } catch (e) {
    console.error(e);
    showToast("Virhe latauksessa", "error");
  }

  if (!snap?.exists()) {
    showToast("Peliä ei löytynyt", "error");
    return;
  }

  // Päivitä localStoragesta
  const data=snap.data();
  localStorage.setItem('pistelaskuri',JSON.stringify(data));
  localStorage.setItem('pistelaskuriGameName',gameName);
  loadState();
  ensureTotalsForPlayers();
  updatePlacementPoints();
  syncEventsPlayers();

  // Kerro, että peli on nyt käynnissä
  state.started = true;

  // Näytä yläpalkki ja aktivoi nav-napit
  qs('#mainHeader').hidden = false;
  qsa('header .topnav button').forEach(b => {
    if (b.id !== 'endGameBtn') b.disabled = false;
  });

  // Renderöinnit ja näkymään siirtyminen
  renderSettings();
  renderEventsHeader();
  renderEventInputs();
  renderTimerSelectors();
  renderTotals();
  switchView('eventsView');
  showToast('Peli ladattu','success');
}

// Lopeta peli: poista pilvestä ja localStoragesta
async function endGame(){
  if (gameName) {
    try {
      await deleteDoc(doc(db, "games", gameName));
    } catch (e) {
      console.warn("delete error", e);
    }
  }
  localStorage.removeItem('pistelaskuri');
  localStorage.removeItem('pistelaskuriGameName');
  // resetAll kutsuu saveState->ei haluta pilvitallennusta
  gameName='';
  resetAll();
}

// --- UI Helpers ---
function resetAll() {
  state.players           = [];
  state.events            = [];
  state.totals            = {};
  state.currentEventIndex = 0;
  state.started           = false;
  clearInterval(state.timer.intervalId);
  state.timer.running     = false;
  state.timer.elapsedMs   = 0;

  ensureTotalsForPlayers();
  updatePlacementPoints();
  syncEventsPlayers();

  qs('#addPlayerBtn').disabled   = false;
  qs('#newPlayerName').disabled  = false;
  qs('#addEventBtn').disabled    = false;
  qs('#newEventName').disabled   = false;

  renderSettings();
  renderTotals();
  qsa('header .topnav button').forEach(b=> {
    if (b.id === 'endGameBtn') return;
    b.disabled = true;
  });
  qs('#mainHeader').hidden = true;
  switchView('homeView');
  saveState();
}

// --- Alustus ja event-sidonta ---

document.addEventListener('DOMContentLoaded', async ()=>{
  // Palauta gameName jos oli
  const savedName=localStorage.getItem('pistelaskuriGameName');
  if(savedName) gameName=savedName;

  // Lataa localState, synkkaa pilven kanssa
  loadState();
  await syncWithFirestore();
  loadState();

  if (state.started) {
    qs('#mainHeader').hidden = false;

    // Lukitaan lisäyspainikkeet
    qs('#addPlayerBtn').disabled  = true;
    qs('#newPlayerName').disabled = true;
    qs('#addEventBtn').disabled   = true;
    qs('#newEventName').disabled  = true;

    // Aktivoi nav-napit (paitsi Lopeta-nappi, se on aina aktivoitu)
    qsa('header .topnav button').forEach(b => {
      if (b.id !== 'endGameBtn') b.disabled = false;
    });

    // Ja suoraan Events-näkymään
    renderEventsHeader();
    renderEventInputs();
    renderTimerSelectors();
    renderTotals();
    switchView('eventsView');
  } else {
    switchView('homeView');
  }

  // KOTI-näkymän napit
  qs('#homeNewBtn').addEventListener('click', startNewGame);
  qs('#homeLoadBtn').addEventListener('click', loadGame);

  // NAV
  qsa('header .topnav button').forEach(btn=>{
    const v=btn.dataset.view;
    if(v && v!=='settingsView') btn.disabled=!state.started;
    btn.addEventListener('click',()=>{
      if(btn.id==='endGameBtn') return;
      if(v==='eventsView'){ renderEventsHeader(); renderEventInputs(); }
      else if(v==='timerView') renderTimerSelectors();
      else if(v==='totalsView') renderTotals();
      switchView(v);
    });
  });

  // PELIN LOPETUS-dialogi
  qs('#endGameBtn').addEventListener('click',()=>qs('#confirmOverlay').hidden=false);
  qs('#confirmYes').addEventListener('click',()=>{
    qs('#confirmOverlay').hidden=true;
    endGame();
  });
  qs('#confirmNo').addEventListener('click',()=>qs('#confirmOverlay').hidden=true);

  // ASETUKSET
  qs('#addPlayerBtn').addEventListener('click', addPlayer);
  qs('#newPlayerName').addEventListener('keypress', e=>{ if(e.key==='Enter') addPlayer(); });
  qs('#addEventBtn').addEventListener('click', addEvent);
  qs('#newEventName').addEventListener('keypress', e=>{ if(e.key==='Enter') addEvent(); });

  qs('#goToEventsBtn').addEventListener('click', ()=>{
    if(!state.players.length||!state.events.length){
      showToast('Lisää vähintään yksi pelaaja ja yksi tapahtuma','error');
      return;
    }
    state.started=true;
    ensureTotalsForPlayers();
    updatePlacementPoints();
    syncEventsPlayers();
    qs('#addPlayerBtn').disabled=true;
    qs('#newPlayerName').disabled=true;
    qs('#addEventBtn').disabled=true;
    qs('#newEventName').disabled=true;
    qsa('header .topnav button').forEach(b=>b.disabled=false);
    renderSettings();
    renderEventsHeader();
    renderEventInputs();
    renderTimerSelectors();
    saveState();
    switchView('eventsView');
  });

  // TAPAHTUMAT-nappien sidonta
  qs('#prevEventBtn').addEventListener('click',()=>jumpEvent(-1));
  qs('#nextEventBtn').addEventListener('click',()=>jumpEvent(1));
  qs('#orderSelect').addEventListener('change',()=>{
    currentEvent().order=qs('#orderSelect').value;
    renderEventInputs();
    saveState();
  });
  qs('#saveEventBtn').addEventListener('click', saveCurrentEvent);

  // Focusout tallennus
  qs('#eventInputs').addEventListener('focusout', e=>{
    if(!e.target.matches('input')) return;
    const ev=currentEvent(), p=e.target.dataset.player, v=e.target.value.trim();
    if(ev.locks[p]){
      e.target.value=ev.results[p]||'';
      showToast('Kenttä jo lukittu','error');
    } else {
      ev.results[p]=v;
      saveState();
    }
    renderEventInputs();
  });

  // SEKUNTIKELLO
  qs('#startTimerBtn').addEventListener('click',   startTimer);
  qs('#stopTimerBtn').addEventListener('click',    stopTimer);
  qs('#resetTimerBtn').addEventListener('click',   resetTimer);
  qs('#timerEventSelect').addEventListener('change',resetTimer);
  qs('#timerPlayerSelect').addEventListener('change',resetTimer);

  // UI
  renderSettings();
  renderTotals();

  if(state.started) switchView('eventsView');
  else            switchView('homeView');
});

function switchView(viewId) {
  qsa('.view').forEach(v => v.hidden = true);
  const el = qs(`#${viewId}`);
  if (el) el.hidden = false;
}

// --- ASETUKSET ---
function addPlayer() {
  const val = qs('#newPlayerName').value.trim();
  if (!val) return;
  if (state.players.includes(val)) {
    showToast('Pelaaja jo olemassa','error');
    return;
  }
  state.players.push(val);
  qs('#newPlayerName').value = '';
  ensureTotalsForPlayers();
  updatePlacementPoints();
  syncEventsPlayers();
  renderSettings();
  saveState();
}

function removePlayer(name) {
  state.players = state.players.filter(p => p!==name);
  delete state.totals[name];
  ensureTotalsForPlayers();
  updatePlacementPoints();
  syncEventsPlayers();
  renderSettings();
  renderTotals();
  saveState();
}

function addEvent() {
  const val = qs('#newEventName').value.trim() || `Tapahtuma ${state.events.length+1}`;
  state.events.push({
    name: val,
    results: Object.fromEntries(state.players.map(p=>[p,''])),
    locks:   Object.fromEntries(state.players.map(p=>[p,false])),
    order:   'desc',
    committed:false,
    points: {}
  });
  qs('#newEventName').value = '';
  renderSettings();
  saveState();
}

function renameEvent(i) {
  const old = state.events[i]?.name || `Tapahtuma ${i+1}`;
  const nu  = prompt('Uusi nimi:', old);
  if (nu) {
    state.events[i].name = nu.trim();
    renderSettings();
    renderEventsHeader();
    saveState();
  }
}

function deleteEvent(i) {
  state.events.splice(i,1);
  state.currentEventIndex = Math.min(state.currentEventIndex, state.events.length-1);
  renderSettings();
  renderEventsHeader();
  saveState();
}

function renderSettings(){
  // Lukitse lisäyspainikkeet jos peli on aloitettu
  qs('#addPlayerBtn').disabled  = state.started;
  qs('#newPlayerName').disabled = state.started;
  qs('#addEventBtn').disabled   = state.started;
  qs('#newEventName').disabled  = state.started;

  const disableEdit = state.started;
  const disableOpen = !state.started;

  // Pelaajat
  const pl = qs('#playersList');
  pl.innerHTML = '';
  state.players.forEach(p=>{
    const d=document.createElement('div'); d.className='item';
    d.innerHTML = `<span class="name">${p}</span>
      <button class="ghost" data-action="remove">Poista</button>`;
    const btn = d.querySelector('[data-action="remove"]');
    btn.disabled = disableEdit;
    btn.addEventListener('click',()=>removePlayer(p));
    pl.append(d);
  });

  // Tapahtumat
  const evl = qs('#eventNamesList');
  evl.innerHTML = '';
  state.events.forEach((ev,i)=>{
    const d=document.createElement('div'); d.className='item';
    d.innerHTML = `
      <button class="ghost event-name" data-action="open">${ev.name}</button>
      <div class="event-actions">
        <button class="ghost" data-action="rename">Nimeä uudelleen</button>
        <button class="ghost" data-action="delete">Poista</button>
      </div>
    `;

    // Avaa-painike (kiinni ennen aloitusta)
    const openBtn = d.querySelector('[data-action="open"]');
    openBtn.disabled = disableOpen;
    openBtn.addEventListener('click', ()=>{
      if (!state.started) return;
      state.currentEventIndex = i;
      renderEventsHeader();
      renderEventInputs();
      switchView('eventsView');
    });

    const rbtn = d.querySelector('[data-action="rename"]');
    rbtn.disabled = disableEdit;
    rbtn.addEventListener('click',()=>renameEvent(i));

    const dbtn = d.querySelector('[data-action="delete"]');
    dbtn.disabled = disableEdit;
    dbtn.addEventListener('click',()=>deleteEvent(i));

    evl.append(d);
  });
}

// --- TAPAHTUMAT ---
function renderEventsHeader(){
  const title     = qs('#eventTitle');
  const saveBtn   = qs('#saveEventBtn');
  const prevBtn   = qs('#prevEventBtn');
  const nextBtn   = qs('#nextEventBtn');
  const orderSel  = qs('#orderSelect');
  const ev        = currentEvent();

  if (!state.events.length){
    title.textContent = 'Ei tapahtumia';
    prevBtn.disabled  = true;
    nextBtn.disabled  = true;
    saveBtn.disabled  = true;
    orderSel.disabled = true;
    qs('#eventStatus').textContent = '';
    return;
  }

  title.textContent = ev.name;
  prevBtn.disabled  = state.currentEventIndex === 0;
  nextBtn.disabled  = state.currentEventIndex >= state.events.length - 1;
  saveBtn.disabled  = ev.committed;
  orderSel.disabled = ev.committed;
  qs('#eventStatus').textContent = ev.committed ? 'Tallennettu' : '';
}

function jumpEvent(delta){
  if (!state.events.length) return;
  state.currentEventIndex = Math.max(0,
    Math.min(state.events.length-1, state.currentEventIndex+delta)
  );
  renderEventsHeader();
  renderEventInputs();
  saveState();
}

function renderEventInputs(){
  const c = qs('#eventInputs');
  c.innerHTML = '';
  const ev = currentEvent();
  if (!ev) {
    c.innerHTML = '<p class="hint">Lisää tapahtumia.</p>';
    return;
  }

  const sorted = [...state.players].sort((a,b)=>{
    const ra = ev.results[a]||'', rb = ev.results[b]||'';
    const ha = ra!=='', hb = rb!=='';
    if(!ha&&!hb) return 0;
    if(!ha) return 1;
    if(!hb) return -1;
    const va = isTimeFormat(ra)?timeToMs(ra):parseFloat(ra,10);
    const vb = isTimeFormat(rb)?timeToMs(rb):parseFloat(rb,10);
    return ev.order==='asc'?va-vb:vb-va;
  });

  updatePlacementPoints();

  sorted.forEach(p=>{
    const rid = `evt${state.currentEventIndex}_${p.replace(/\s+/g,'_')}`;
    const lbl = document.createElement('label');
    lbl.setAttribute('for',rid);
    lbl.textContent = p;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const inp  = document.createElement('input');
    inp.type        = 'text';
    inp.id          = rid;
    inp.name        = rid;
    inp.placeholder = 'mm.ss.mmm tai luku';
    inp.value       = ev.results[p] || '';
    inp.readOnly    = !!ev.locks[p];
    inp.dataset.player = p;

    const lockTag = document.createElement('span');
    lockTag.className = 'locktag';
    lockTag.textContent = 'Lukittu';
    lockTag.style.display = ev.locks[p] ? 'inline-block' : 'none';

    const pt = document.createElement('span');
    pt.className = 'pointtag';
    if (ev.committed && p in ev.points) {
      pt.textContent = `+${ev.points[p]}`;
      pt.style.display = 'inline-block';
    } else {
      pt.style.display = 'none';
    }

    wrap.append(inp, lockTag, pt);
    c.append(lbl, wrap);
  });
}

function saveCurrentEvent(){
  const ev = currentEvent();
  if (!ev || ev.committed) {
    if (ev?.committed) showToast('Tapahtuma on jo tallennettu','error');
    return;
  }

  const vals = state.players.map(p=>(ev.results[p]||'').trim());
  if (vals.some(v=>!v||'0123456789'.indexOf(v[0])<0)) {
    showToast('Kelvottomat arvot','error');
    return;
  }

  const types = vals.map(v=>isTimeFormat(v)?'time':isIntegerStr(v)?'int':'invalid');
  if (types.includes('invalid')) {
    showToast('Muoto väärä','error');
    return;
  }
  if (new Set(types).size > 1) {
    showToast('Ei yhtenäinen muoto','error');
    return;
  }

  const isTime = types[0] === 'time';
  const dir    = ev.order === 'asc' ? 1 : -1;
  const rows   = state.players.map(p=>({
    p,
    score: isTime? timeToMs(ev.results[p]): parseFloat(ev.results[p],10)
  })).sort((a,b)=>(a.score - b.score)*dir);

  updatePlacementPoints();
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && rows[j].score === rows[i].score) {
      j++;
    }
    // sijoitukset i...j-1 ovat tasoissa
    const totalPoints = state.placementPoints
      .slice(i, j)
      .reduce((sum, p) => sum + p, 0);
    const avgPoints = totalPoints / (j - i);

    for (let k = i; k < j; k++) {
      ev.points[rows[k].p] = avgPoints;
      state.totals[rows[k].p] = (state.totals[rows[k].p] || 0) + avgPoints;
    }
    i = j;
  }
  ev.committed = true;

  renderEventsHeader();
  renderEventInputs();
  renderTotals();
  saveState();
  showToast('Tallennettu','success');
}

function renderTotals(){
  const tb = qs('#leaderboardBodyTotals');
  tb.innerHTML = '';
  ensureTotalsForPlayers();
  const allDone = state.events.length > 0 && state.events.every(e=>e.committed);
  const sorted = Object.entries(state.totals).sort((a,b)=>b[1]-a[1]);

  const colors = ['gold', 'silver', 'bronze'];
let currentColorIndex = 0;
let lastPoints = null;
let rank = 0;

sorted.forEach(([p, pts], idx) => {
  const tr = document.createElement('tr');
  if (allDone && currentColorIndex < colors.length) {
    if (lastPoints === null) {
      // ensimmäinen pelaaja
      tr.classList.add(colors[currentColorIndex]);
      lastPoints = pts;
      rank++;
    } else if (pts === lastPoints) {
      // sama pistemäärä kuin edellisellä → sama väri
      tr.classList.add(colors[currentColorIndex]);
    } else {
      // uusi pistemäärä → siirry seuraavaan väriin
      currentColorIndex = rank; // rank kertoo monesko sija
      if (currentColorIndex < colors.length) {
        tr.classList.add(colors[currentColorIndex]);
      }
      lastPoints = pts;
      rank++;
    }
  }
    tr.innerHTML = `<td>${p}</td><td>${pts}</td>`;
    tb.append(tr);
  });
}

// --- Sekuntikello ---
function renderTimerSelectors(){
  const evSel = qs('#timerEventSelect'),
        plSel = qs('#timerPlayerSelect');

  evSel.innerHTML = '';
  state.events.forEach((ev,i)=> evSel.append(new Option(ev.name,i)));

  plSel.innerHTML = '';
  state.players.forEach(p => plSel.append(new Option(p,p)));

  // 🔹 Palauta tallennetut valinnat
  const savedEventIndex = localStorage.getItem('timerSelectedEvent');
  const savedPlayer = localStorage.getItem('timerSelectedPlayer');

  if (savedEventIndex !== null && state.events[savedEventIndex]) {
    evSel.value = savedEventIndex;
  } else {
    evSel.value = state.currentEventIndex;
  }

  if (savedPlayer && state.players.includes(savedPlayer)) {
    plSel.value = savedPlayer;
  }
}

qs('#timerEventSelect').addEventListener('change', e => {
  localStorage.setItem('timerSelectedEvent', e.target.value);
  resetTimer();
});

qs('#timerPlayerSelect').addEventListener('change', e => {
  localStorage.setItem('timerSelectedPlayer', e.target.value);
  resetTimer();
});

function updateTimerDisplay(){
  qs('#timerDisplay').textContent = msToDisplay(state.timer.elapsedMs);
}

function startTimer(){
  if (state.timer.running) return;
  state.timer.running = true;
  state.timer.startTs = performance.now() - state.timer.elapsedMs;
  state.timer.intervalId = setInterval(()=>{
    state.timer.elapsedMs = Math.floor(performance.now() - state.timer.startTs);
    updateTimerDisplay();
  }, 16);
}

function stopTimer(){
  if (!state.timer.running) return;
  clearInterval(state.timer.intervalId);
  state.timer.running = false;

  const eIdx = parseInt(qs('#timerEventSelect').value, 10),
        pl   = qs('#timerPlayerSelect').value;
  if (isNaN(eIdx) || !state.events[eIdx]) {
    qs('#timerNotice').textContent = 'Valitse tapahtuma';
    return;
  }
  if (!pl) {
    qs('#timerNotice').textContent = 'Valitse pelaaja';
    return;
  }

  const t  = msToDisplay(state.timer.elapsedMs),
        ev = state.events[eIdx];
  ev.results[pl] = t;
  ev.locks[pl]   = true;

  renderEventInputs();
  qs('#timerNotice').textContent = `${pl}: ${t}`;
  saveState();
  showToast('Aika tallennettu','success');
}

function resetTimer(){
  clearInterval(state.timer.intervalId);
  state.timer.running   = false;
  state.timer.elapsedMs = 0;
  updateTimerDisplay();
  qs('#timerNotice').textContent = '';
}
