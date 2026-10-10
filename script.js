/* ── RK Sports Wear — Salary System JS ───────────────────── */
"use strict";

/* ═══════════════════════════════════════════════════════════
   STORAGE KEYS
════════════════════════════════════════════════════════════ */
const MASTER_KEY       = 'rk_emp_master';
const HISTORY_KEY      = 'rk_salary_history';
const SETTINGS_KEY     = 'rk_settings';
const PHOTOS_KEY       = 'rk_emp_photos';
const ATTENDANCE_KEY   = 'rk_attendance';
const MONTHLY_SAL_KEY  = 'rk_monthly_sal';
const SESSION_KEY      = 'rk_session';
const FB_CONFIG_KEY    = 'rk_firebase_config';
const ADVANCES_KEY     = 'rk_advances';

/* ═══════════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════════════ */
const employees = [];
let employeeMaster = {};
let salaryHistory  = {};
let appSettings    = {};
let empPhotos      = {};
let attendance     = {};
let monthlySal     = {};
let advances       = {};   // empId -> [{id, date, amount, note, remaining}]
let ddIndex        = -1;
let editIndex      = -1;
let currentRole    = null;
let currentEmpId   = null;
let historyMode    = 'admin';
let historySelectedWeek = null;
let historyType    = 'weekly'; // 'weekly' | 'monthly'

/* ═══════════════════════════════════════════════════════════
   FIREBASE CLOUD SYNC
════════════════════════════════════════════════════════════ */
let _fbApp = null;
let _fbDb  = null;
let _fbRef = null;
let _fbConnected = false;
const FB_ROOT = 'rk_sports_wear';

function initFirebase(config) {
  try {
    if (typeof firebase === 'undefined') { console.warn('Firebase not loaded'); return false; }
    if (firebase.apps && firebase.apps.length) {
      _fbApp = firebase.apps[0];
    } else {
      _fbApp = firebase.initializeApp(config);
    }
    _fbDb  = firebase.database(_fbApp);
    _fbRef = _fbDb.ref(FB_ROOT);
    _fbConnected = true;
    setSyncStatus('connected', '☁ Synced');
    return true;
  } catch(err) {
    console.error('Firebase init:', err);
    _fbConnected = false;
    setSyncStatus('error', '⚠ Error');
    return false;
  }
}

function setSyncStatus(state, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if (dot) dot.className = 'sync-dot-indicator sync-' + state;
  if (lbl) lbl.textContent = label;
}

async function fbPushAll() {
  if (!_fbConnected || !_fbRef) return;
  try {
    setSyncStatus('syncing', '↑ Saving…');
    const payload = { employeeMaster, salaryHistory, appSettings, attendance, monthlySal, advances, updatedAt: Date.now() };
    // employees array stored separately
    payload.employees = employees.map(e => ({...e}));
    // Photos are base64 — store in separate node to avoid 10MB limit issues
    await _fbRef.child('data').set(payload);
    // Store photos separately (they can be large)
    await _fbRef.child('photos').set(empPhotos || {});
    setSyncStatus('connected', '☁ Synced');
  } catch(err) {
    console.error('fbPushAll:', err);
    setSyncStatus('error', '⚠ Failed');
    showToast('⚠️ Cloud save failed — data saved locally.');
  }
}

async function fbPullAll() {
  if (!_fbConnected || !_fbRef) return false;
  try {
    setSyncStatus('syncing', '↓ Loading…');
    const snap = await _fbRef.once('value');
    const root = snap.val();
    if (!root) { setSyncStatus('connected', '☁ Synced'); return false; }
    const data = root.data || {};
    if (data.employeeMaster) employeeMaster = data.employeeMaster;
    if (data.salaryHistory)  salaryHistory  = data.salaryHistory;
    if (data.appSettings)    appSettings    = { ...appSettings, ...data.appSettings };
    if (data.attendance)     attendance     = data.attendance;
    if (data.monthlySal)     monthlySal     = data.monthlySal;
    if (data.advances)       advances       = data.advances;
    if (Array.isArray(data.employees)) {
      employees.length = 0;
      data.employees.forEach(e => employees.push(e));
    }
    if (root.photos)         empPhotos      = root.photos;
    mirrorToLocal();
    setSyncStatus('connected', '☁ Synced');
    return true;
  } catch(err) {
    console.error('fbPullAll:', err);
    setSyncStatus('error', '⚠ Error');
    return false;
  }
}

function mirrorToLocal() {
  try { localStorage.setItem(MASTER_KEY,      JSON.stringify(employeeMaster)); } catch(_){}
  try { localStorage.setItem(HISTORY_KEY,     JSON.stringify(salaryHistory));  } catch(_){}
  try { localStorage.setItem(SETTINGS_KEY,    JSON.stringify(appSettings));    } catch(_){}
  try { localStorage.setItem(PHOTOS_KEY,      JSON.stringify(empPhotos));      } catch(_){}
  try { localStorage.setItem(ATTENDANCE_KEY,  JSON.stringify(attendance));     } catch(_){}
  try { localStorage.setItem(MONTHLY_SAL_KEY, JSON.stringify(monthlySal));     } catch(_){}
  try { localStorage.setItem(ADVANCES_KEY,    JSON.stringify(advances));        } catch(_){}
}

/* ═══════════════════════════════════════════════════════════
   PERSISTENCE — localStorage + optional Firebase
════════════════════════════════════════════════════════════ */
function loadAll() {
  try { const r=localStorage.getItem(MASTER_KEY);    if(r) employeeMaster=JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem(HISTORY_KEY);   if(r) salaryHistory =JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem(SETTINGS_KEY);  if(r) appSettings   =JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem(PHOTOS_KEY);    if(r) empPhotos     =JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem(ATTENDANCE_KEY);if(r) attendance    =JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem(MONTHLY_SAL_KEY);if(r)monthlySal   =JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem(ADVANCES_KEY);   if(r)advances     =JSON.parse(r); } catch(e){}
  if (!appSettings.adminPass)    appSettings.adminPass    = 'admin123';
  if (!appSettings.empPasswords) appSettings.empPasswords = {};
  if (appSettings.ejsPubKey && window.emailjs) {
    try { window.emailjs.init({ publicKey: appSettings.ejsPubKey }); } catch(_){}
  }
  // Auto-connect Firebase if config saved
  try {
    const fbCfg = localStorage.getItem(FB_CONFIG_KEY);
    if (fbCfg && typeof firebase !== 'undefined') {
      const cfg = JSON.parse(fbCfg);
      if (cfg && cfg.databaseURL) initFirebase(cfg);
    }
  } catch(_){}
}

function saveMaster()    { try{localStorage.setItem(MASTER_KEY,    JSON.stringify(employeeMaster));}catch(e){} fbPushAll(); }
function saveHistory()   { try{localStorage.setItem(HISTORY_KEY,   JSON.stringify(salaryHistory)); }catch(e){} fbPushAll(); }
function saveSettings()  { try{localStorage.setItem(SETTINGS_KEY,  JSON.stringify(appSettings));   }catch(e){} fbPushAll(); }
function savePhotos()    { try{localStorage.setItem(PHOTOS_KEY,    JSON.stringify(empPhotos));     }catch(e){} fbPushAll(); }
function saveAttendance(){ try{localStorage.setItem(ATTENDANCE_KEY,JSON.stringify(attendance));    }catch(e){} fbPushAll(); }
function saveMonthlySal(){ try{localStorage.setItem(MONTHLY_SAL_KEY,JSON.stringify(monthlySal));  }catch(e){} fbPushAll(); }
function saveAdvances()  { try{localStorage.setItem(ADVANCES_KEY,    JSON.stringify(advances));     }catch(e){} fbPushAll(); }
function saveEmployees() { fbPushAll(); }

function saveSession()   { try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({role:currentRole,empId:currentEmpId}));}catch(e){} }
function clearSession()  { try{sessionStorage.removeItem(SESSION_KEY);}catch(e){} }
function loadSession()   { try{const r=sessionStorage.getItem(SESSION_KEY);return r?JSON.parse(r):null;}catch(e){return null;} }

/* ═══════════════════════════════════════════════════════════
   SYNC SETUP UI
════════════════════════════════════════════════════════════ */
function openSyncSetup() {
  const modal = document.getElementById('sync-setup-modal');
  if (!modal) return;
  const saved = localStorage.getItem(FB_CONFIG_KEY);
  if (saved) {
    const inp = document.getElementById('firebase-config-input');
    if (inp) inp.value = saved;
  }
  const disBtn = document.getElementById('sync-disconnect-btn');
  const frcBtn = document.getElementById('sync-force-btn');
  if (disBtn) disBtn.style.display = saved ? '' : 'none';
  if (frcBtn) frcBtn.style.display = _fbConnected ? '' : 'none';
  updateSyncBanner();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSyncSetup() {
  const m = document.getElementById('sync-setup-modal');
  if (m) m.classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}
function closeSyncSetupOutside(e) {
  if (e.target === document.getElementById('sync-setup-modal')) closeSyncSetup();
}
function updateSyncBanner() {
  const b = document.getElementById('sync-status-banner');
  if (!b) return;
  if (_fbConnected) {
    b.style.cssText = 'display:block;padding:10px 14px;border-radius:10px;font-size:12px;font-weight:600;margin-bottom:16px;background:#e8f5e9;border:1px solid #a5d6a7;color:#1a5c2a;';
    b.textContent = '✅ Connected to Firebase — all changes sync across devices in real time.';
  } else {
    b.style.cssText = 'display:block;padding:10px 14px;border-radius:10px;font-size:12px;font-weight:600;margin-bottom:16px;background:#fff8e6;border:1px solid #f0d080;color:#7a5000;';
    b.textContent = '⚠️ Local mode — data is only on this device. Connect Firebase to share across devices via link.';
  }
}
async function connectFirebase() {
  const input = document.getElementById('firebase-config-input');
  if (!input || !input.value.trim()) { showMsg('Config Required','Please paste your Firebase config JSON.','warn'); return; }
  let cfg;
  try {
    let raw = input.value.trim();
    const match = raw.match(/\{[\s\S]+\}/);
    if (match) raw = match[0];
    cfg = JSON.parse(raw);
  } catch(_) { showMsg('Invalid JSON','The config is not valid JSON. Copy it again from Firebase console.','warn'); return; }
  if (!cfg.databaseURL) { showMsg('Missing databaseURL','Your config needs a <strong>databaseURL</strong>.<br>Enable Realtime Database in Firebase console first.','warn'); return; }
  localStorage.setItem(FB_CONFIG_KEY, JSON.stringify(cfg));
  const ok = initFirebase(cfg);
  if (!ok) { showMsg('Connection Failed','Could not connect. Check config and try again.','block'); return; }
  const hadData = await fbPullAll();
  if (hadData) {
    renderTable(); renderEmpProfileGrid(); renderSettingsEmpList();
    showToast('☁️ Connected! Employee data loaded from cloud.');
  } else {
    await fbPushAll();
    showToast('☁️ Connected! Your data pushed to cloud.');
  }
  document.getElementById('sync-disconnect-btn').style.display = '';
  document.getElementById('sync-force-btn').style.display = '';
  updateSyncBanner();
  closeSyncSetup();
}
function disconnectFirebase() {
  localStorage.removeItem(FB_CONFIG_KEY);
  _fbConnected = false; _fbRef = null; _fbApp = null;
  setSyncStatus('local', 'Local');
  showToast('🔌 Disconnected from Firebase.');
  closeSyncSetup();
}
async function forceSyncNow() {
  if (!_fbConnected) { showMsg('Not Connected','Connect to Firebase first.','warn'); return; }
  setSyncStatus('syncing', '↕ Syncing…');
  const ok = await fbPullAll();
  if (ok) { renderTable(); renderEmpProfileGrid(); showToast('✅ Synced from cloud.'); }
  closeSyncSetup();
}

function upsertMaster(emp) {
  const existing = employeeMaster[emp.empId] || {};
  employeeMaster[emp.empId] = {
    empId:        emp.empId,
    name:         emp.name,
    dob:          emp.dob          || existing.dob          || '',
    joiningDate:  emp.joiningDate  || existing.joiningDate  || '',
    phone:        emp.phone,
    addr:         emp.addr,
    rate:         emp.rate,
    shiftsPerDay: Number(emp.shiftsPerDay || existing.shiftsPerDay || 2),
    salaryType:   emp.salaryType   || existing.salaryType   || 'weekly',
    inactive:     existing.inactive || false
  };
  saveMaster();
}

/* Persist current week's employees to history */
function persistWeekToHistory() {
  if (!employees.length) return;
  const weekStr = getWeekStr();
  const weekKey = weekStr.replace(/\s/g,'_');
  const existing = salaryHistory[weekKey] || { weekStr, weekKey, entries: [] };
  // merge / overwrite entries
  employees.forEach(e => {
    const idx = existing.entries.findIndex(x => x.empId === e.empId);
    if (idx >= 0) existing.entries[idx] = { ...e };
    else existing.entries.push({ ...e });
  });
  salaryHistory[weekKey] = existing;
  saveHistory();
}

/* ═══════════════════════════════════════════════════════════
   PHOTO UTILITIES
════════════════════════════════════════════════════════════ */

/* Compress & crop image to a square, max 220px, JPEG 0.82 quality */
function compressPhoto(file, maxPx = 400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = ev => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const size = Math.min(img.width, img.height);
        const sx   = (img.width  - size) / 2;
        const sy   = (img.height - size) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = Math.min(size, maxPx);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Render the photo preview inside a picker widget */
function renderPhotoPicker(wrapperId, previewId, empId) {
  const preview = document.getElementById(previewId);
  if (!preview) return;
  const photo = empPhotos[empId];
  if (photo) {
    preview.style.backgroundImage = `url(${photo})`;
    preview.classList.add('has-photo');
    const label = document.getElementById(wrapperId + '-label');
    if (label) label.textContent = 'Change Photo';
  } else {
    preview.style.backgroundImage = '';
    preview.classList.remove('has-photo');
    const label = document.getElementById(wrapperId + '-label');
    if (label) label.textContent = 'Upload Photo';
  }
}

/* Handle file input change — compress and store temporarily */
async function handlePhotoChange(inputEl, previewId, wrapperId) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showMsg('Invalid File', 'Please choose an image file (JPG, PNG, etc.).', 'warn');
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    showMsg('File Too Large', 'Please choose an image under 6 MB.', 'warn');
    return;
  }
  try {
    const compressed = await compressPhoto(file);
    // Store temporarily on the wrapper element for saving later
    const wrapper = document.getElementById(wrapperId);
    if (wrapper) wrapper._pendingPhoto = compressed;
    // Update preview
    const preview = document.getElementById(previewId);
    if (preview) {
      preview.style.backgroundImage = `url(${compressed})`;
      preview.classList.add('has-photo');
    }
    const label = document.getElementById(wrapperId + '-label');
    if (label) label.textContent = 'Change Photo';
  } catch(e) {
    showMsg('Upload Error', 'Could not process the image. Please try another file.', 'warn');
  }
}

/* Save pending photo for an empId */
function commitPhoto(wrapperId, empId) {
  const wrapper = document.getElementById(wrapperId);
  if (wrapper && wrapper._pendingPhoto) {
    empPhotos[empId] = wrapper._pendingPhoto;
    savePhotos();
    wrapper._pendingPhoto = null;
    return true;
  }
  return false;
}

/* Build avatar HTML — photo if available, else initials */
function avatarHtml(empId, name, size = 56, classes = '') {
  const photo = empPhotos[empId];
  const initials = (name || empId || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  if (photo) {
    return `<div class="emp-view-avatar ${classes}" style="width:${size}px;height:${size}px;background-image:url(${photo});background-size:cover;background-position:center;border:2.5px solid rgba(255,255,255,.35);"></div>`;
  }
  return `<div class="emp-view-avatar ${classes}" style="width:${size}px;height:${size}px;">${initials}</div>`;
}

/* ═══════════════════════════════════════════════════════════
   SIMPLE PASSWORD HASHING (SHA-256 via subtle crypto)
   Falls back to plain comparison if SubtleCrypto unavailable
════════════════════════════════════════════════════════════ */
async function hashPass(plain) {
  if (window.crypto && window.crypto.subtle) {
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  return plain; // fallback plain
}

async function checkPass(plain, stored) {
  const h = await hashPass(plain);
  return h === stored || plain === stored; // allow plain match for legacy
}

/* ═══════════════════════════════════════════════════════════
   LOGIN / LOGOUT
════════════════════════════════════════════════════════════ */
let loginRole = 'admin';
function setLoginRole(role) {
  loginRole = role;
  document.getElementById('role-admin-btn').classList.toggle('active', role==='admin');
  document.getElementById('role-emp-btn').classList.toggle('active',   role==='employee');
  document.getElementById('login-empid-field').style.display = role==='employee' ? '' : 'none';
  document.getElementById('login-pass-label').textContent = role==='employee' ? 'Password' : 'Admin Password';
  document.getElementById('login-hint-admin').style.display = role==='admin' ? '' : 'none';
  document.getElementById('login-hint-emp').style.display   = role==='employee' ? '' : 'none';
  document.getElementById('login-error').style.display = 'none';
  // hide employee preview when switching away
  const preview = document.getElementById('login-emp-preview');
  if (preview) preview.style.display = 'none';
  if (role === 'employee') {
    const empId = (document.getElementById('login-empid').value || '').trim().toUpperCase();
    if (empId) updateLoginEmpPreview(empId);
  }
}

/* Show employee photo + name on login card when a valid ID is typed */
function updateLoginEmpPreview(rawId) {
  const previewEl = document.getElementById('login-emp-preview');
  const avatarEl  = document.getElementById('login-emp-avatar');
  const nameEl    = document.getElementById('login-emp-name');
  const idLabelEl = document.getElementById('login-emp-id-label');
  if (!previewEl) return;

  const empId = (rawId || '').trim().toUpperCase();
  if (!empId) { previewEl.style.display = 'none'; return; }

  // Case-insensitive lookup
  const masterKey = Object.keys(employeeMaster).find(k => k.toUpperCase() === empId);
  const m = masterKey ? employeeMaster[masterKey] : null;

  if (!m) { previewEl.style.display = 'none'; return; }

  // Build avatar — photo or initials
  const photo    = empPhotos[masterKey];
  const initials = m.name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  if (photo) {
    avatarEl.style.backgroundImage = `url(${photo})`;
    avatarEl.style.backgroundSize  = 'cover';
    avatarEl.style.backgroundPosition = 'center';
    avatarEl.textContent = '';
    avatarEl.classList.add('has-photo');
  } else {
    avatarEl.style.backgroundImage = '';
    avatarEl.textContent = initials;
    avatarEl.classList.remove('has-photo');
  }

  nameEl.textContent    = m.name;
  idLabelEl.textContent = masterKey;

  previewEl.style.display = '';
  // Animate in
  previewEl.classList.remove('login-preview-anim');
  void previewEl.offsetWidth; // reflow
  previewEl.classList.add('login-preview-anim');
}

async function doLogin() {
  const pass    = document.getElementById('login-pass').value;
  const empIdIn = document.getElementById('login-empid').value.trim().toUpperCase();
  const errEl   = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (loginRole === 'admin') {
    if (!pass) { errEl.textContent = 'Please enter the admin password.'; errEl.style.display=''; return; }
    // If no admin password set yet, accept default 'admin123'
    if (!appSettings.adminPass) {
      if (pass !== 'admin123') {
        errEl.textContent = 'Default password is admin123. Please login and set a new password in Settings.';
        errEl.style.display=''; return;
      }
    } else {
      const ok = await checkPass(pass, appSettings.adminPass);
      if (!ok) { errEl.textContent = 'Incorrect password. Please try again.'; errEl.style.display=''; return; }
    }
    currentRole  = 'admin';
    currentEmpId = null;
    showApp();
  } else {
    if (!empIdIn) { errEl.textContent = 'Please enter your Employee ID.'; errEl.style.display=''; return; }
    if (!pass)    { errEl.textContent = 'Please enter your password.'; errEl.style.display=''; return; }

    // Case-insensitive employee ID lookup
    const masterKey = Object.keys(employeeMaster).find(k => k.toUpperCase() === empIdIn);
    const m = masterKey ? employeeMaster[masterKey] : null;

    if (!m) { errEl.textContent = 'Employee ID "' + empIdIn + '" not found. Check with your admin.'; errEl.style.display=''; return; }
    if (m.inactive) { errEl.textContent = 'This employee account is inactive. Contact your admin.'; errEl.style.display=''; return; }

    // Look up password using the exact stored key
    const storedPass = appSettings.empPasswords[masterKey] || appSettings.empPasswords[empIdIn];
    if (!storedPass) { errEl.textContent = 'No password set for this account. Please contact your admin.'; errEl.style.display=''; return; }

    const ok = await checkPass(pass, storedPass);
    if (!ok) { errEl.textContent = 'Incorrect password. Please try again.'; errEl.style.display=''; return; }

    currentRole  = 'employee';
    currentEmpId = masterKey; // use exact stored key
    showApp();
  }
}

function showApp() {
  try {
  saveSession();   // persist role across refresh
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = '';
  // logos
  if (window.RK_LOGO_B64) {
    ['header-logo-img','modal-logo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.src = window.RK_LOGO_B64; el.style.display = 'block'; }
    });
  }
  document.getElementById('week-str-text').textContent = getWeekStr();

  // Safety-net: hide the week badge immediately for employees, before any
  // rendering below could throw and leave it visible by accident.
  const weekBadgeEarly = document.getElementById('week-str');
  if (weekBadgeEarly) weekBadgeEarly.style.display = (currentRole === 'admin') ? '' : 'none';

  if (currentRole === 'admin') {
    document.getElementById('admin-view').style.display    = '';
    document.getElementById('employee-view').style.display = 'none';
    const weekBadge = document.getElementById('week-str');
    if (weekBadge) weekBadge.style.display = '';
    document.getElementById('header-user-badge').textContent = '🛡 Admin';
    try { renderTable(); } catch(e) { console.error('renderTable',e); }
    try { renderEmpProfileGrid(); } catch(e) { console.error('renderEmpProfileGrid',e); }
    msMonth  = new Date().getMonth();
    msYear   = new Date().getFullYear();
    msSelEmp = '';
    wsSelEmp = '';
    try { renderWeeklyPicker(); } catch(e) { console.error('renderWeeklyPicker',e); }
    try { renderSettingsEmpList(); } catch(e) { console.error('renderSettingsEmpList',e); }
  } else {
    document.getElementById('admin-view').style.display    = 'none';
    document.getElementById('employee-view').style.display = '';
    const weekBadge = document.getElementById('week-str');
    if (weekBadge) weekBadge.style.display = 'none';
    const m = employeeMaster[currentEmpId];
    document.getElementById('header-user-badge').textContent = '👤 ' + currentEmpId;
    document.getElementById('emp-view-name').textContent  = m ? m.name : currentEmpId;
    document.getElementById('emp-view-meta').textContent  = (m && m.phone ? '+91 '+m.phone : '') + (m && m.addr ? (m.phone ? ' · ' : '') + m.addr : '');
    const idBadge = document.getElementById('emp-id-badge-hero');
    if (idBadge) idBadge.textContent = currentEmpId;
    const avatarWrap = document.getElementById('emp-avatar-wrap');
    if (avatarWrap) {
      const photo    = empPhotos[currentEmpId];
      const initials = m ? m.name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase() : currentEmpId.slice(0,2).toUpperCase();
      if (photo) {
        avatarWrap.innerHTML = `<div class="emp-view-avatar emp-avatar-photo" style="background-image:url(${photo});background-size:cover;background-position:center;font-size:0;"></div>`;
      } else {
        avatarWrap.innerHTML = `<div class="emp-view-avatar">${initials}</div>`;
      }
    }
    try { renderEmployeeReceipts(); } catch(e) { console.error('renderEmployeeReceipts',e); }
    try { renderEmpAdvanceLedger(); } catch(e) { console.error('renderEmpAdvanceLedger',e); }
  }
  } catch(err) {
    // If showApp crashes, still show the app screen so user is not stuck on login
    console.error('showApp crash:', err);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display   = '';
    const weekBadgeCatch = document.getElementById('week-str');
    if (currentRole === 'admin') {
      document.getElementById('admin-view').style.display    = '';
      document.getElementById('employee-view').style.display = 'none';
      if (weekBadgeCatch) weekBadgeCatch.style.display = '';
    } else {
      document.getElementById('admin-view').style.display    = 'none';
      document.getElementById('employee-view').style.display = '';
      if (weekBadgeCatch) weekBadgeCatch.style.display = 'none';
    }
  }
}

function doLogout() {
  clearSession();
  currentRole  = null;
  currentEmpId = null;
  document.getElementById('app-screen').style.display   = 'none';
  document.getElementById('login-screen').style.display = '';
  document.getElementById('login-pass').value  = '';
  document.getElementById('login-empid').value = '';
  document.getElementById('login-error').style.display = 'none';
  const preview = document.getElementById('login-emp-preview');
  if (preview) preview.style.display = 'none';
}

function togglePassVis(inputId, btn, inputEl) {
  const inp  = inputEl || document.getElementById(inputId);
  if (!inp) return;
  const show = btn.querySelector('.eye-icon-show');
  const hide = btn.querySelector('.eye-icon-hide');
  if (inp.type === 'password') {
    inp.type = 'text';
    if (show) show.style.display = 'none';
    if (hide) hide.style.display = '';
  } else {
    inp.type = 'password';
    if (show) show.style.display = '';
    if (hide) hide.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════════════════════
   WEEK / NUMBER HELPERS
════════════════════════════════════════════════════════════ */
function getWeekStr() {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() - ((day+6)%7));
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  const fmt = d => d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  return fmt(mon)+' – '+fmt(sun);
}
function inr(n)  { return '₹'+Number(n).toLocaleString('en-IN'); }
function calcNet(e) { return Math.max(0,e.days*e.rate-e.adv-e.oldAdv); }
function numberToWords(n) {
  const a=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const b=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  if(n===0)return'Zero'; if(n<0)return'Minus '+numberToWords(-n);
  let s='';
  if(Math.floor(n/10000000)){s+=numberToWords(Math.floor(n/10000000))+' Crore ';n%=10000000;}
  if(Math.floor(n/100000)){s+=numberToWords(Math.floor(n/100000))+' Lakh ';n%=100000;}
  if(Math.floor(n/1000)){s+=numberToWords(Math.floor(n/1000))+' Thousand ';n%=1000;}
  if(Math.floor(n/100)){s+=numberToWords(Math.floor(n/100))+' Hundred ';n%=100;}
  if(n>=20){s+=b[Math.floor(n/10)]+(n%10?' '+a[n%10]:'');}else if(n>0){s+=a[n];}
  return s.trim();
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* Decimal-safe sanitizer for text-type numeric inputs (Days Worked, Salary/Day,
   Advance, Old Advance, etc). These fields use type="text" + inputmode="decimal"
   instead of type="number" specifically because a type="number" input silently
   drops an in-progress trailing decimal point (e.g. "5.") whenever script
   reassigns .value on every keystroke — "5." isn't a valid number per the HTML
   spec, so the browser clears/truncates it, and the next digit typed just
   appends to the integer part (5.5 → 55). Keeps digits and a single dot. */
function sanitizeDecimalInput(el) {
  if (!el) return;
  let v = el.value.replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  el.value = v;
}

/* Employee ID sanitizer — New Employee form (id="ne-id").
   Rules: letters are forced UPPERCASE as you type, digits are allowed,
   and a safe set of ID-style special characters is allowed: _ - . / #
   Anything else (spaces, quotes, &, <, >, etc.) is dropped silently,
   since the ID is used as an object key, a URL-shareable receipt label,
   and inside onclick attribute strings throughout the app. */
const EMP_ID_ALLOWED = /[^A-Z0-9_\-./#]/g;
function sanitizeEmpIdInput(el) {
  if (!el) return;
  const before = el.value;
  const after  = before.toUpperCase().replace(EMP_ID_ALLOWED, '');
  if (after !== before) {
    const atEnd = el.selectionStart === before.length;
    el.value = after;
    if (atEnd) { try { el.setSelectionRange(after.length, after.length); } catch(_){} }
  }
}

/* Employee Name sanitizer — New Employee form (id="ne-name") and the Edit
   Employee form (id="me-name"). Forces UPPERCASE as you type, and only
   allows letters and spaces (names shouldn't contain digits/symbols). */
const EMP_NAME_ALLOWED = /[^A-Z\s]/g;
function sanitizeNameInput(el) {
  if (!el) return;
  const before = el.value;
  const after  = before.toUpperCase().replace(EMP_NAME_ALLOWED, '');
  if (after !== before) {
    const atEnd = el.selectionStart === before.length;
    el.value = after;
    if (atEnd) { try { el.setSelectionRange(after.length, after.length); } catch(_){} }
  }
}

/* ═══════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  loadAll();
  if (window.RK_LOGO_B64) {
    const li = document.getElementById('login-logo-img');
    if (li) { li.src = window.RK_LOGO_B64; li.style.display='block'; }
  }

  // Restore session if page was refreshed
  const sess = loadSession();
  if (sess && sess.role) {
    currentRole  = sess.role;
    currentEmpId = sess.empId || null;
    showApp();
  } else {
    setLoginRole('admin');
  }

  document.addEventListener('click', e => {
    const dd  = document.getElementById('id-dropdown');
    const inp = document.getElementById('f-id');
    if (dd && inp && !dd.contains(e.target) && e.target !== inp) closeIdDropdown();
  });
});

/* ═══════════════════════════════════════════════════════════
   STYLED MESSAGE BOX
════════════════════════════════════════════════════════════ */
function showMsg(title, msg, type, focusId) {
  const ov=document.getElementById('msgbox-overlay');
  const icons={warn:'⚠️',block:'🚫',info:'ℹ️',success:'✅'};
  document.getElementById('msgbox-icon').className='confirm-icon icon-'+(type||'warn');
  document.getElementById('msgbox-icon').textContent=icons[type]||'⚠️';
  document.getElementById('msgbox-title').textContent=title;
  document.getElementById('msgbox-msg').innerHTML=msg;
  ov.classList.add('open');
  document.body.style.overflow='hidden';
  ov._focusId=focusId||null;
  document.getElementById('msgbox-ok').focus();
}
function closeMsgBox() {
  const ov=document.getElementById('msgbox-overlay');
  ov.classList.remove('open');
  if(!document.querySelector('.modal-overlay.open')) document.body.style.overflow='';
  if(ov._focusId){ const el=document.getElementById(ov._focusId); if(el) setTimeout(()=>el.focus(),50); ov._focusId=null; }
}

/* ═══════════════════════════════════════════════════════════
   AUTOCOMPLETE — Employee ID
════════════════════════════════════════════════════════════ */
function onIdFocus()      { showIdDropdown(document.getElementById('f-id').value.trim()); }
function onIdInput(val)   { ddIndex=-1; showIdDropdown(val); }
function onIdKeydown(e) {
  const items=document.getElementById('id-dropdown').querySelectorAll('.id-item');
  if(!items.length) return;
  if(e.key==='ArrowDown'){e.preventDefault();ddIndex=Math.min(ddIndex+1,items.length-1);updateDdActive(items);}
  else if(e.key==='ArrowUp'){e.preventDefault();ddIndex=Math.max(ddIndex-1,0);updateDdActive(items);}
  else if(e.key==='Enter'){if(ddIndex>=0&&items[ddIndex])items[ddIndex].click();}
  else if(e.key==='Escape'){closeIdDropdown();}
}
function updateDdActive(items) {
  items.forEach((el,i)=>{el.classList.toggle('active',i===ddIndex);if(i===ddIndex)el.scrollIntoView({block:'nearest'});});
}
function showIdDropdown(query) {
  const dd=document.getElementById('id-dropdown');
  const back=document.getElementById('dropdown-backdrop');
  const q=(query||'').toLowerCase();
  const masterList=Object.values(employeeMaster).filter(m=>!m.inactive);
  const filtered=q?masterList.filter(m=>m.empId.toLowerCase().includes(q)||m.name.toLowerCase().includes(q)):masterList;
  if(!filtered.length){
    if(!masterList.length){closeIdDropdown();return;}
    dd.innerHTML=`<div class="id-no-results">No match found</div>`;
    dd.style.display='block'; back.style.display='block'; return;
  }
  dd.innerHTML=`<div class="id-dropdown-hint">Saved Employees — tap to auto-fill</div>`+
    filtered.map(m=>{
      const photo    = empPhotos[m.empId];
      const initials = (m.name||m.empId).trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
      const thumbHtml = photo
        ? `<span style="width:34px;height:34px;border-radius:50%;background:url(${photo}) center/cover;border:2px solid var(--border);flex-shrink:0;display:inline-block;"></span>`
        : `<span style="width:34px;height:34px;border-radius:50%;background:var(--navy);color:#fff;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</span>`;
      return `<div class="id-item" onclick="selectEmployee('${escHtml(m.empId)}')">
        ${thumbHtml}
        <span class="id-item-info">
          <span style="display:flex;align-items:center;gap:6px;">
            <span class="id-item-badge" style="padding:2px 7px;font-size:9px;">${escHtml(m.empId)}</span>
            <span class="id-item-name">${escHtml(m.name)}</span>
          </span>
          <span class="id-item-sub">${m.phone?'+91 '+escHtml(m.phone):'—'}${m.addr?' · '+escHtml(m.addr):''}</span>
        </span>
        <span class="id-item-rate">₹${Number(m.rate).toLocaleString('en-IN')}/day</span>
      </div>`;
    }).join('');
  dd.style.display='block'; back.style.display='block'; ddIndex=-1;
}
function selectEmployee(empId) {
  const m = employeeMaster[empId];
  if (!m) return;

  document.getElementById('f-id').value    = m.empId;
  document.getElementById('f-name').value  = m.name;
  document.getElementById('f-phone').value = m.phone || '';
  document.getElementById('f-addr').value  = m.addr  || '';
  document.getElementById('f-rate').value  = m.rate  || '';

  // Build detail panel with photo
  const photo    = empPhotos[empId];
  const initials = m.name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const avatarHtmlStr = photo
    ? `<div style="width:42px;height:42px;border-radius:50%;background:url(${photo}) center/cover;border:2px solid var(--border);flex-shrink:0;"></div>`
    : `<div style="width:42px;height:42px;border-radius:50%;background:var(--navy);color:#fff;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>`;

  const detailAvatarEl = document.getElementById('detail-avatar');
  if (detailAvatarEl) detailAvatarEl.innerHTML = avatarHtmlStr;

  document.getElementById('detail-name').textContent  = m.name  || '—';
  document.getElementById('detail-phone').textContent = m.phone ? '+91 ' + m.phone : '—';
  document.getElementById('detail-addr').textContent  = m.addr  || '—';
  document.getElementById('detail-rate').textContent  = '₹' + Number(m.rate).toLocaleString('en-IN') + '/day';

  const ds = document.getElementById('emp-details-section');
  ds.style.display = 'block';

  if (m.inactive) {
    ds.style.borderColor = 'rgba(229,0,58,.4)';
    ds.style.background  = '#fff0f3';
    document.getElementById('btn-add').disabled = true;
    document.getElementById('btn-add').title = 'This employee has left the organisation';
    showToast('⚠️ ' + m.name + ' has left — salary blocked.');
  } else {
    ds.style.borderColor = '';
    ds.style.background  = '';
  }

  checkAddSalaryBtn();
  closeIdDropdown();

  // Auto-fill days worked from attendance
  if ((m.salaryType || 'weekly') === 'weekly') {
    autoFillDaysWorked(m.empId);
  }

  // Auto-switch salary mode based on employee's salary type
  const empSalType = m.salaryType || 'weekly';
  if (empSalType === 'monthly') {
    switchSalaryMode('monthly');
    msPick(m.empId);
  } else {
    switchSalaryMode('weekly');
    document.getElementById('f-days').focus();
  }
}

function closeIdDropdown() {
  document.getElementById('id-dropdown').style.display='none';
  document.getElementById('dropdown-backdrop').style.display='none';
  ddIndex=-1;
}

/* ── Days Worked + Rate validation → enable/disable Add Salary ─── */
function validateDaysInput() { checkAddSalaryBtn(); }
function checkAddSalaryBtn() {
  const empId  = document.getElementById('f-id').value.trim();
  const days   = document.getElementById('f-days').value.trim();
  const rate   = document.getElementById('f-rate').value.trim();
  const btn    = document.getElementById('btn-add');
  const daysEl = document.getElementById('f-days');
  const hasEmp  = !!empId;
  const hasDays = days !== '' && parseFloat(days) >= 0;
  const hasRate = rate !== '' && parseFloat(rate) > 0;

  // Only enable if employee selected AND days filled AND rate is present
  const canAdd = hasEmp && hasDays && hasRate;
  btn.disabled = !canAdd;

  // Highlight days field only if employee selected but no days yet
  daysEl.classList.toggle('days-missing', hasEmp && !hasDays);

  // Show/hide the hint text under days field
  const hint = document.getElementById('days-hint-text');
  if (hint) hint.classList.toggle('show', hasEmp && !hasDays);

  // Update button tooltip to guide user
  if (!hasEmp)        btn.title = 'Select an Employee ID first';
  else if (!hasDays)  btn.title = 'Enter Days Worked to enable';
  else if (!hasRate)  btn.title = 'Salary Rate is missing — check employee profile';
  else                btn.title = '';
}

/* ═══════════════════════════════════════════════════════════
   ENTRY CRUD
════════════════════════════════════════════════════════════ */
function addEntry() {
  const get=id=>document.getElementById(id).value.trim();
  const empId  = get('f-id');
  const name   = get('f-name');
  const phone  = get('f-phone');
  const addr   = get('f-addr');
  const days   = parseFloat(get('f-days'))  || 0;
  const rate   = parseFloat(get('f-rate'))  || 0;
  const adv    = parseFloat(get('f-adv'))   || 0;
  const oldAdv = parseFloat(get('f-oldadv'))|| 0;

  if (!empId) { showMsg('Employee ID Required','Please select an <strong>Employee ID</strong>.','warn','f-id'); return; }
  if (!name)  { showMsg('Employee Not Found','Please select an employee from the dropdown.','warn','f-id'); return; }
  if (get('f-days')==='') { showMsg('Days Worked Required','Please enter <strong>Days Worked</strong> before adding salary.','warn','f-days'); return; }
  if (!rate)  { showMsg('Salary Rate Required','Please enter <strong>Salary Per Day</strong>.','warn','f-rate'); return; }

  const masterEntry=employeeMaster[empId];
  if(masterEntry&&masterEntry.inactive){
    showMsg('Employee Has Left','<strong>'+escHtml(name)+'</strong> has left the organisation.<br>Cannot add salary for inactive employees.','block','f-id');
    return;
  }

  if(editIndex<0){
    const existingIdx = employees.findIndex(e => e.empId === empId);
    if (existingIdx >= 0) {
      showMsg('Already Added This Week','Salary for <strong>'+escHtml(name)+'</strong> has already been entered for this week.<br>Edit the existing entry from the salary sheet instead.','block','f-id');
      return;
    }
  }

  upsertMaster({empId,name,phone,addr,rate});

  // Capture previous adv/oldAdv (for delta calc against Advance Ledger)
  const prevAdv    = editIndex>=0 ? Number(employees[editIndex].adv||0)    : 0;
  const prevOldAdv = editIndex>=0 ? Number(employees[editIndex].oldAdv||0) : 0;

  if(editIndex>=0){
    const orig=employees[editIndex];
    employees[editIndex]={empId,name,phone,addr,days,rate,adv,oldAdv,_dateKey:orig._dateKey};
    showToast(`✅ ${name} updated successfully.`);
    editIndex=-1;
    setEditMode(false);
  } else {
    const today=new Date().toDateString();
    employees.push({empId,name,phone,addr,days,rate,adv,oldAdv,_dateKey:empId+'::'+today});
    showToast(`✅ ${name} salary added.`);
  }

  // Apply the change in Advance/Old Advance to the Advance Ledger's deducted totals
  applyWeeklyAdvanceDeduction(empId, adv - prevAdv, false);
  applyWeeklyAdvanceDeduction(empId, oldAdv - prevOldAdv, true);
  if (document.getElementById('advance-ledger-modal')?.classList.contains('open')) renderAdvanceLedgerModal();

  persistWeekToHistory();
  renderTable();
  wsClearPick();
}

/* Apply a +/- delta to the Advance Ledger's deducted amounts for an employee.
   preferOld=true targets entries dated before this week first (Old Advance);
   preferOld=false targets entries within this week first (This Week). */
function applyWeeklyAdvanceDeduction(empId, delta, preferOld) {
  if (!delta || !advances[empId] || !advances[empId].length) return;
  const { start: weekStart } = getWeekRange();
  const all = advances[empId];
  const preferred = all.filter(a => preferOld ? a.date < weekStart : a.date >= weekStart);
  const rest       = all.filter(a => !preferred.includes(a));
  const ordered = [...preferred, ...rest].sort((a,b) => a.date.localeCompare(b.date));

  let remaining = Math.abs(delta);
  const sign = delta > 0 ? 1 : -1;
  for (const entry of ordered) {
    if (remaining <= 0) break;
    const original = advances[empId].find(x => x.id === entry.id);
    if (!original) continue;
    if (sign > 0) {
      const maxDeduct = Number(original.amount) - Number(original.deducted||0);
      const apply = Math.min(remaining, maxDeduct);
      original.deducted = Number(original.deducted||0) + apply;
      remaining -= apply;
    } else {
      const apply = Math.min(remaining, Number(original.deducted||0));
      original.deducted = Number(original.deducted||0) - apply;
      remaining -= apply;
    }
  }
  saveAdvances();
}

function editEntry(i) {
  const e=employees[i];
  editIndex=i;
  wsSelEmp = e.empId;
  const pickerCard = document.getElementById('ws-picker-card');
  const formCard    = document.getElementById('ws-form-card');
  if (pickerCard) pickerCard.style.display = 'none';
  if (formCard)   formCard.style.display   = 'block';

  document.getElementById('f-id').value     = e.empId;
  document.getElementById('f-name').value   = e.name;
  document.getElementById('f-phone').value  = e.phone||'';
  document.getElementById('f-addr').value   = e.addr||'';
  document.getElementById('f-days').value   = e.days;
  document.getElementById('f-rate').value   = e.rate;
  document.getElementById('f-adv').value    = e.adv||'';
  document.getElementById('f-oldadv').value = e.oldAdv||'';

  document.getElementById('detail-name').textContent  = e.name  || '—';
  document.getElementById('detail-phone').textContent = e.phone ? '+91 ' + e.phone : '—';
  document.getElementById('detail-addr').textContent  = e.addr  || '—';
  document.getElementById('detail-rate').textContent  = '₹' + Number(e.rate).toLocaleString('en-IN') + '/day';

  // Show photo in detail panel
  const photo    = empPhotos[e.empId];
  const initials = e.name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const detailAvatarEl = document.getElementById('detail-avatar');
  if (detailAvatarEl) {
    detailAvatarEl.innerHTML = photo
      ? `<div style="width:42px;height:42px;border-radius:50%;background:url(${photo}) center/cover;border:2px solid var(--border);flex-shrink:0;"></div>`
      : `<div style="width:42px;height:42px;border-radius:50%;background:var(--navy);color:#fff;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>`;
  }
  const ds=document.getElementById('emp-details-section');
  ds.style.display='block'; ds.style.borderColor=''; ds.style.background='';

  const btn=document.getElementById('btn-add');
  btn.disabled=false; btn.title='';

  setEditMode(true);
  closeIdDropdown();
  document.getElementById('ws-form-card')?.scrollIntoView({behavior:'smooth',block:'start'});
  document.getElementById('f-days').focus();
}

function cancelEdit() { editIndex=-1; setEditMode(false); wsClearPick(); }

function setEditMode(on) {
  const card=document.getElementById('ws-form-card');
  const title=document.getElementById('form-title');
  const addBtn=document.getElementById('btn-add');
  const cancelBtn=document.getElementById('btn-cancel-edit');
  const eb=document.getElementById('edit-banner');
  if(on){
    card.classList.add('editing');
    title.textContent='Edit Salary Entry';
    addBtn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Update Salary`;
    addBtn.disabled=false;
    cancelBtn.style.display='inline-flex';
    eb.style.display='flex';
    eb.textContent=`✏️ Editing row ${editIndex+1} — make changes and tap Update`;
  } else {
    card.classList.remove('editing');
    title.textContent='Add Salary';
    addBtn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Salary`;
    cancelBtn.style.display='none';
    eb.style.display='none';
  }
}

function clearForm() {
  ['f-id','f-name','f-phone','f-addr','f-days','f-rate','f-adv','f-oldadv'].forEach(id=>{document.getElementById(id).value='';});
  const ds=document.getElementById('emp-details-section');
  if(ds){ds.style.display='none';ds.style.borderColor='';ds.style.background='';}
  const btn=document.getElementById('btn-add');
  if(btn){btn.disabled=true;btn.title='';}
  document.getElementById('f-days').classList.remove('days-missing');
  const hint = document.getElementById('days-hint-text');
  if (hint) hint.classList.remove('show');
  document.getElementById('f-id').focus();
  closeIdDropdown();
}

function removeEntry(i) {
  const e=employees[i];
  showConfirm({type:'delete',empId:e.empId,empName:e.name,onYes:()=>{
    if(editIndex===i){editIndex=-1;setEditMode(false);clearForm();}
    employees.splice(i,1);
    persistWeekToHistory();
    renderTable();
    showToast(`🗑️ ${e.name} removed from sheet.`);
  }});
}

/* ── Toast ─────────────────────────────────────────────── */
function showToast(msg) {
  const t=document.getElementById('toast');
  if(!t) return;
  t.textContent=msg; t.style.display='block';
  clearTimeout(t._tid); t._tid=setTimeout(()=>{t.style.display='none';},3000);
}

/* ── Render table ───────────────────────────────────────── */
function renderTable() {
  const tbody=document.getElementById('sal-body');
  const tfoot=document.getElementById('sal-foot');
  const table=document.getElementById('sal-table');
  const empty=document.getElementById('empty-state');
  if(!employees.length){table.style.display='none';empty.style.display='block';updateStats();return;}
  table.style.display='table';empty.style.display='none';
  tbody.innerHTML=employees.map((e,i)=>{
    const gross=e.days*e.rate;const net=calcNet(e);
    return `<tr${i===editIndex?' class="row-editing"':''}>
      <td><span class="emp-badge">${e.empId}</span></td>
      <td style="font-weight:600;white-space:nowrap;">${e.name}</td>
      <td class="hide-sm">${e.phone?'+91 '+e.phone:'—'}</td>
      <td class="hide-sm" style="max-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.addr||'—'}</td>
      <td>${e.days}</td>
      <td class="hide-xs">${inr(e.rate)}</td>
      <td class="hide-xs">${inr(gross)}</td>
      <td class="hide-xs">${inr(e.adv)}</td>
      <td class="hide-xs">${inr(e.oldAdv)}</td>
      <td class="net-pay">${inr(net)}</td>
      <td><div class="row-actions">
        <button class="btn btn-edit" onclick="editEntry(${i})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>
        <button class="btn btn-wa" onclick="shareWhatsApp(${i})"><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.004 2.003c-5.514 0-9.997 4.486-9.997 9.997 0 1.762.461 3.419 1.268 4.859L2 22l5.234-1.237A9.953 9.953 0 0012.004 22c5.514 0 9.996-4.483 9.996-9.997s-4.482-9.997-9.996-9.997z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>WA</button>
        <button class="btn btn-pdf" onclick="dlIndividual(${i})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>PDF</button>
        <button class="del-btn" onclick="removeEntry(${i})">✕</button>
      </div></td></tr>`;
  }).join('');
  const tG=employees.reduce((s,e)=>s+e.days*e.rate,0);
  const tA=employees.reduce((s,e)=>s+e.adv,0);
  const tO=employees.reduce((s,e)=>s+e.oldAdv,0);
  const tN=employees.reduce((s,e)=>s+calcNet(e),0);
  tfoot.innerHTML=`<tr><td colspan="5">Total — ${employees.length} emp${employees.length>1?'s':''}</td><td class="hide-xs">${inr(tG)}</td><td class="hide-xs">${inr(tA)}</td><td class="hide-xs">${inr(tO)}</td><td>${inr(tN)}</td><td></td></tr>`;
  updateStats();
  renderEmpProfileGrid();
}
function updateStats() {
  const elEmp = document.getElementById('s-emp');
  const elPay = document.getElementById('s-pay');
  const elAdv = document.getElementById('s-adv');
  if (elEmp) elEmp.textContent = employees.length;
  if (elPay) elPay.textContent = inr(employees.reduce((s,e)=>s+calcNet(e),0));
  if (elAdv) elAdv.textContent = inr(employees.reduce((s,e)=>s+e.adv+e.oldAdv,0));
}

/* ═══════════════════════════════════════════════════════════
   EMPLOYEE VIEW — receipts list
════════════════════════════════════════════════════════════ */
function renderEmployeeReceipts() {
  const listEl    = document.getElementById('emp-receipts-list');
  const emptyEl   = document.getElementById('emp-receipts-empty');
  const countEl   = document.getElementById('emp-receipt-count');
  const statsEl   = document.getElementById('emp-stats-row');
  const m         = employeeMaster[currentEmpId];
  const isMonthly = m && m.salaryType === 'monthly';

  if (isMonthly) {
    // ── Monthly employee: show monthly salary receipts ──────
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    // Gather all saved monthly entries for this employee
    const records = [];
    Object.keys(monthlySal).forEach(key => {
      if (key.startsWith(currentEmpId + '::')) {
        const [, ym] = key.split('::');
        const [yr, mm] = ym.split('-').map(Number);
        const saved = monthlySal[key];
        records.push({ key, yr, mm, monthName: monthNames[mm-1] + ' ' + yr, ...saved });
      }
    });
    records.sort((a,b) => b.key.localeCompare(a.key));
    window._empRecords = records;

    const totalNet = records.reduce((s,r) => s + Number(r.netAmt||0), 0);
    const totalSal = records.reduce((s,r) => s + Number(r.salMonth||0), 0);
    if (statsEl) statsEl.innerHTML = `
      <div class="emp-stat-card"><div class="emp-stat-icon">📋</div><div class="emp-stat-label">Total Months</div><div class="emp-stat-val gold">${records.length}</div></div>
      <div class="emp-stat-card"><div class="emp-stat-icon">💰</div><div class="emp-stat-label">Total Earned</div><div class="emp-stat-val green">${inr(totalNet)}</div></div>
      <div class="emp-stat-card"><div class="emp-stat-icon">📅</div><div class="emp-stat-label">Gross Total</div><div class="emp-stat-val">${inr(totalSal)}</div></div>`;

    if (!records.length) {
      emptyEl.style.display = 'block';
      listEl.innerHTML = '';
      if (countEl) countEl.textContent = '';
    } else {
      emptyEl.style.display = 'none';
      if (countEl) countEl.textContent = records.length + ' record' + (records.length > 1 ? 's' : '');
      listEl.innerHTML = records.map((r, i) => {
        const net    = Number(r.netAmt  || 0);
        const sal    = Number(r.salMonth|| 0);
        const adv    = Number(r.advance || 0);
        const oldAdv = Number(r.oldAdv  || 0);
        return `
        <div class="receipt-card">
          <div class="receipt-card-header">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="receipt-week-label">📅 ${escHtml(r.monthName)}</span>
            </div>
            <button class="receipt-dl-btn" onclick="empMonthlyPdf(${i})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              Download PDF
            </button>
          </div>
          <div class="receipt-card-body">
            <div class="receipt-grid">
              <div class="receipt-stat"><span class="receipt-stat-label">Monthly Salary</span><span class="receipt-stat-val">${inr(sal)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Advance</span><span class="receipt-stat-val red">${inr(adv)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Old Advance</span><span class="receipt-stat-val red">${inr(oldAdv)}</span></div>
            </div>
            <div class="receipt-net-bar">
              <div>
                <div class="receipt-net-label">Net Payable</div>
                <div class="receipt-net-words">${numberToWords(net)} Only</div>
              </div>
              <div class="receipt-net-amount">${inr(net)}</div>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  } else {
    // ── Weekly employee: existing logic ────────────────────
    const records = [];
    Object.values(salaryHistory).forEach(wk => {
      wk.entries.forEach(e => {
        if (e.empId === currentEmpId) records.push({...e, weekStr: wk.weekStr});
      });
    });
    employees.forEach(e => {
      if (e.empId === currentEmpId) {
        const wk = getWeekStr();
        if (!records.find(r => r.weekStr === wk && r.empId === currentEmpId))
          records.push({...e, weekStr: wk, _isCurrent: true});
      }
    });
    records.sort((a, b) => b.weekStr.localeCompare(a.weekStr));
    window._empRecords = records;

    if (statsEl) {
      const totalNet  = records.reduce((s, e) => s + calcNet(e), 0);
      const totalDays = records.reduce((s, e) => s + Number(e.days||0), 0);
      statsEl.innerHTML = `
        <div class="emp-stat-card"><div class="emp-stat-icon">📋</div><div class="emp-stat-label">Total Weeks</div><div class="emp-stat-val gold">${records.length}</div></div>
        <div class="emp-stat-card"><div class="emp-stat-icon">💰</div><div class="emp-stat-label">Total Earned</div><div class="emp-stat-val green">${inr(totalNet)}</div></div>
        <div class="emp-stat-card"><div class="emp-stat-icon">📅</div><div class="emp-stat-label">Days Worked</div><div class="emp-stat-val">${totalDays}</div></div>`;
    }

    if (!records.length) {
      emptyEl.style.display = 'block';
      listEl.innerHTML = '';
      if (countEl) countEl.textContent = '';
    } else {
      emptyEl.style.display = 'none';
      if (countEl) countEl.textContent = records.length + ' record' + (records.length > 1 ? 's' : '');
      listEl.innerHTML = records.map((e, i) => {
        const gross = Number(e.days) * Number(e.rate);
        const net   = calcNet(e);
        const isCur = !!e._isCurrent;
        return `
        <div class="receipt-card">
          <div class="receipt-card-header">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="receipt-week-label">📅 ${escHtml(e.weekStr)}</span>
              ${isCur ? '<span style="background:rgba(212,168,67,.25);color:var(--gold);font-size:9px;font-weight:800;padding:2px 7px;border-radius:999px;letter-spacing:.3px;">CURRENT</span>' : ''}
            </div>
            <button class="receipt-dl-btn" onclick="dlIndividualByData(${i})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              Download PDF
            </button>
          </div>
          <div class="receipt-card-body">
            <div class="receipt-grid">
              <div class="receipt-stat"><span class="receipt-stat-label">Days Worked</span><span class="receipt-stat-val">${e.days} <span style="font-size:10px;font-weight:500;color:var(--muted);">days</span></span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Rate / Day</span><span class="receipt-stat-val">${inr(e.rate)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Gross Salary</span><span class="receipt-stat-val">${inr(gross)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Advance (Week)</span><span class="receipt-stat-val red">${inr(e.adv||0)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Old Advance</span><span class="receipt-stat-val red">${inr(e.oldAdv||0)}</span></div>
            </div>
            <div class="receipt-net-bar">
              <div>
                <div class="receipt-net-label">Net Payable</div>
                <div class="receipt-net-words">${numberToWords(net)} Only</div>
              </div>
              <div class="receipt-net-amount">${inr(net)}</div>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Always render advance ledger regardless of salary type
  renderEmpAdvanceLedger();
}

function empMonthlyPdf(i) {
  if (!window._empRecords || !window._empRecords[i]) return;
  const r   = window._empRecords[i];
  const prev = msSelEmp;
  const prevMonth = msMonth;
  const prevYear  = msYear;
  msSelEmp = currentEmpId;
  msMonth  = r.mm - 1;
  msYear   = r.yr;
  buildMonthlySalPdf();
  msSelEmp = prev;
  msMonth  = prevMonth;
  msYear   = prevYear;
}

function renderEmpAdvanceLedger() {
  const card    = document.getElementById('emp-advance-card');
  const listEl  = document.getElementById('emp-advance-list');
  const emptyEl = document.getElementById('emp-advance-empty');
  const badge   = document.getElementById('emp-adv-outstanding-badge');
  if (!card || !listEl) return;

  if (!currentEmpId) { card.style.display = 'none'; return; }

  // Look up advances using both the object key AND the stored empId field
  // (they might differ in case or format)
  const m    = employeeMaster[currentEmpId];
  const key1 = currentEmpId;
  const key2 = m ? m.empId : null;
  let ledger = (advances[key1] || []);
  if (!ledger.length && key2 && key2 !== key1) ledger = (advances[key2] || []);
  ledger = ledger.slice().sort((a,b) => b.date.localeCompare(a.date));

  // Always show the card — hide only if no empId
  card.style.display = 'block';

  if (!ledger.length) {
    if (emptyEl) { emptyEl.style.display = 'block'; }
    listEl.innerHTML = '';
    if (badge) {
      badge.textContent = 'Outstanding: ₹0';
      badge.style.cssText = 'font-size:12px;font-weight:800;padding:4px 12px;border-radius:999px;background:#e8f5e9;color:var(--green);border:1px solid #a5d6a7;';
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  const totalGiven    = ledger.reduce((s,a) => s + Number(a.amount||0), 0);
  const totalDeducted = ledger.reduce((s,a) => s + Number(a.deducted||0), 0);
  const outstanding   = Math.max(0, totalGiven - totalDeducted);

  if (badge) {
    badge.textContent = 'Outstanding: ' + inr(outstanding);
    badge.style.cssText = `font-size:12px;font-weight:800;padding:4px 12px;border-radius:999px;background:${outstanding>0?'#ffebee':'#e8f5e9'};color:${outstanding>0?'var(--accent)':'var(--green)'};border:1px solid ${outstanding>0?'#ffcdd2':'#a5d6a7'};`;
  }

  listEl.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:var(--navy);color:#fff;">
            <th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;">Date</th>
            <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;">Given</th>
            <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;">Deducted</th>
            <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;">Balance</th>
            <th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:700;">Note</th>
          </tr>
        </thead>
        <tbody>
          ${ledger.map((a, i) => {
            const bal = Math.max(0, Number(a.amount) - Number(a.deducted||0));
            const bg  = i % 2 === 0 ? '#fff' : '#f8f9fc';
            return `<tr style="background:${bg};border-bottom:1px solid #eaedf3;">
              <td style="padding:9px 12px;font-weight:600;">${escHtml(a.date)}</td>
              <td style="padding:9px 12px;text-align:right;color:#e5003a;font-weight:700;">${inr(a.amount)}</td>
              <td style="padding:9px 12px;text-align:right;color:#0e6b3a;font-weight:700;">${inr(a.deducted||0)}</td>
              <td style="padding:9px 12px;text-align:right;font-weight:800;color:${bal>0?'#e5003a':'#0e6b3a'};">${inr(bal)}</td>
              <td style="padding:9px 12px;color:#8892a4;font-size:12px;">${escHtml(a.note||'—')}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#f0f2f8;font-weight:800;border-top:2px solid #d6dce8;">
            <td style="padding:9px 12px;color:#0e1e3c;">Total</td>
            <td style="padding:9px 12px;text-align:right;color:#e5003a;">${inr(totalGiven)}</td>
            <td style="padding:9px 12px;text-align:right;color:#0e6b3a;">${inr(totalDeducted)}</td>
            <td style="padding:9px 12px;text-align:right;font-weight:800;color:${outstanding>0?'#e5003a':'#0e6b3a'};">${inr(outstanding)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

function dlIndividualByData(i) {
  if(!window._empRecords||!window._empRecords[i]) return;
  buildIndividualPdf(window._empRecords[i], window._empRecords[i].weekStr);
}

/* ═══════════════════════════════════════════════════════════
   SALARY HISTORY MODAL (date-wise view)
════════════════════════════════════════════════════════════ */
function openSalaryHistoryModal(mode) {
  historyMode = mode;
  window._histSelEmpId = mode === 'employee' ? currentEmpId : null;

  const wBtn = document.getElementById('hist-tab-weekly');
  const mBtn = document.getElementById('hist-tab-monthly');

  if (mode === 'employee') {
    // Employee view: only show the tab matching THEIR OWN salary type
    const m = employeeMaster[currentEmpId];
    const empSalType = (m && m.salaryType === 'monthly') ? 'monthly' : 'weekly';
    historyType = empSalType;

    if (wBtn) {
      wBtn.style.display = empSalType === 'weekly' ? '' : 'none';
      wBtn.classList.toggle('hist-type-active', empSalType === 'weekly');
    }
    if (mBtn) {
      mBtn.style.display = empSalType === 'monthly' ? '' : 'none';
      mBtn.classList.toggle('hist-type-active', empSalType === 'monthly');
    }
  } else {
    // Admin view: show both tabs, default to weekly
    historyType = 'weekly';
    if (wBtn) { wBtn.style.display = ''; wBtn.classList.add('hist-type-active'); }
    if (mBtn) { mBtn.style.display = ''; mBtn.classList.remove('hist-type-active'); }
  }

  // Set All Employees tile label
  const allTileLabel = document.getElementById('hist-all-tile-label');
  if (allTileLabel) allTileLabel.textContent = historyType === 'monthly' ? 'All Monthly Employees' : 'All Weekly Employees';

  // Reset content area
  document.getElementById('history-empty').style.display      = 'block';
  document.getElementById('history-table-wrap').style.display = 'none';
  document.getElementById('history-footer').style.display     = 'none';

  const label = document.getElementById('history-modal-label');
  if (label) label.textContent = mode === 'employee' ? 'My Salary History' : 'Salary History';

  document.getElementById('history-modal').classList.add('open');
  document.body.style.overflow = 'hidden';

  if (mode === 'employee') {
    // Employee: skip picker, go straight to period selector
    document.getElementById('hist-emp-picker-wrap').style.display = 'none';
    document.getElementById('hist-sel-emp-bar').style.display     = 'flex';
    document.getElementById('hist-period-wrap').style.display     = 'block';
    const m = employeeMaster[currentEmpId];
    const lbl = document.getElementById('hist-sel-emp-label');
    if (lbl) lbl.textContent = (m ? m.name : currentEmpId) + ' (' + currentEmpId + ')';
    histPopulatePeriods(currentEmpId);
  } else {
    // Admin: show employee picker
    document.getElementById('hist-emp-picker-wrap').style.display = 'block';
    document.getElementById('hist-sel-emp-bar').style.display     = 'none';
    document.getElementById('hist-period-wrap').style.display     = 'none';
    const search = document.getElementById('hist-emp-search');
    if (search) search.value = '';
    renderHistoryEmpPicker();
  }
}

function switchHistoryType(type) {
  historyType = type;
  const wBtn = document.getElementById('hist-tab-weekly');
  const mBtn = document.getElementById('hist-tab-monthly');
  if (wBtn) wBtn.classList.toggle('hist-type-active', type === 'weekly');
  if (mBtn) mBtn.classList.toggle('hist-type-active', type === 'monthly');

  // Update All Employees tile label
  const allTileLabel = document.getElementById('hist-all-tile-label');
  if (allTileLabel) allTileLabel.textContent = type === 'weekly' ? 'All Weekly Employees' : 'All Monthly Employees';

  // Reset content
  document.getElementById('history-empty').style.display      = 'block';
  document.getElementById('history-table-wrap').style.display = 'none';
  document.getElementById('history-footer').style.display     = 'none';

  if (window._histSelEmpId) {
    // Employee already selected — re-populate periods for new type
    histPopulatePeriods(window._histSelEmpId);
  } else {
    // Back to picker — re-render with new type filter
    document.getElementById('hist-emp-picker-wrap').style.display = 'block';
    document.getElementById('hist-sel-emp-bar').style.display     = 'none';
    document.getElementById('hist-period-wrap').style.display     = 'none';
    const search = document.getElementById('hist-emp-search');
    if (search) search.value = '';
    renderHistoryEmpPicker();
  }
}

function renderHistoryEmpPicker() {
  const grid = document.getElementById('hist-emp-grid');
  if (!grid) return;
  const q = (document.getElementById('hist-emp-search')?.value || '').trim().toLowerCase();

  // Filter employees by salary type matching current tab
  const empList = Object.values(employeeMaster).filter(m => {
    if (m.inactive) return false;
    const typeMatch = historyType === 'weekly'
      ? (m.salaryType || 'weekly') === 'weekly'
      : m.salaryType === 'monthly';
    if (!typeMatch) return false;
    if (q) return m.name.toLowerCase().includes(q) || m.empId.toLowerCase().includes(q);
    return true;
  }).sort((a,b) => a.empId.localeCompare(b.empId));

  if (!empList.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--muted);font-size:13px;">No ${historyType} salary employees found.</div>`;
    return;
  }

  grid.innerHTML = empList.map(e => {
    const photo    = empPhotos[e.empId] || '';
    const initials = e.name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const av = photo
      ? `<div style="width:38px;height:38px;border-radius:50%;background-image:url(${photo});background-size:cover;background-position:center;border:2px solid var(--border);flex-shrink:0;"></div>`
      : `<div style="width:38px;height:38px;border-radius:50%;background:var(--navy);color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>`;
    return `<div onclick="histPickEmp('${escHtml(e.empId)}')"
      style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:2px solid var(--border);border-radius:10px;cursor:pointer;"
      onmouseover="this.style.borderColor='var(--navy)';this.style.background='var(--offwhite)';"
      onmouseout="this.style.borderColor='var(--border)';this.style.background='#fff';">
      ${av}
      <div style="min-width:0;">
        <div style="font-weight:700;font-size:13px;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(e.name)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:1px;">${escHtml(e.empId)}</div>
      </div>
    </div>`;
  }).join('');
}

function histPickEmp(empId) {
  window._histSelEmpId = empId;
  const m = employeeMaster[empId];
  document.getElementById('hist-emp-picker-wrap').style.display = 'none';
  document.getElementById('hist-sel-emp-bar').style.display     = 'flex';
  document.getElementById('hist-period-wrap').style.display     = 'block';
  const lbl = document.getElementById('hist-sel-emp-label');
  if (lbl) lbl.innerHTML = `<span class="emp-badge">${escHtml(empId)}</span> ${escHtml(m ? m.name : empId)}`;
  histPopulatePeriods(empId);
  // Reset content
  document.getElementById('history-empty').style.display      = 'block';
  document.getElementById('history-table-wrap').style.display = 'none';
  document.getElementById('history-footer').style.display     = 'none';
}

function histClearEmp() {
  window._histSelEmpId = null;
  document.getElementById('hist-emp-picker-wrap').style.display = 'block';
  document.getElementById('hist-sel-emp-bar').style.display     = 'none';
  document.getElementById('hist-period-wrap').style.display     = 'none';
  document.getElementById('history-empty').style.display        = 'block';
  document.getElementById('history-table-wrap').style.display   = 'none';
  document.getElementById('history-footer').style.display       = 'none';
  const search = document.getElementById('hist-emp-search');
  if (search) search.value = '';
  renderHistoryEmpPicker();
}

function histPickAll() {
  window._histSelEmpId = '__all';
  const label = historyType === 'weekly' ? 'All Weekly Employees' : 'All Monthly Employees';
  document.getElementById('hist-emp-picker-wrap').style.display = 'none';
  document.getElementById('hist-sel-emp-bar').style.display     = 'flex';
  document.getElementById('hist-period-wrap').style.display     = 'block';
  const lbl = document.getElementById('hist-sel-emp-label');
  if (lbl) lbl.innerHTML = `<span style="background:var(--navy);color:#fff;font-size:11px;font-weight:800;padding:2px 10px;border-radius:999px;">ALL</span> &nbsp;${label}`;
  histPopulateAllPeriods();
  document.getElementById('history-empty').style.display      = 'block';
  document.getElementById('history-table-wrap').style.display = 'none';
  document.getElementById('history-footer').style.display     = 'none';
}

function histPopulateAllPeriods() {
  const sel = document.getElementById('hist-period-select');
  const lbl = document.getElementById('hist-period-label');
  if (!sel) return;

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  if (historyType === 'weekly') {
    if (lbl) lbl.textContent = 'Select Week';
    sel.innerHTML = '<option value="">— Choose a week —</option>';
    const weekKeys = new Set();
    // Add current week if any weekly employee has entries this week
    const weeklyEmps = Object.values(employeeMaster).filter(m => (m.salaryType||'weekly')==='weekly');
    if (employees.length > 0) weekKeys.add('__current');
    Object.keys(salaryHistory).forEach(k => {
      const wk = salaryHistory[k];
      if (wk.entries.some(e => {
        const em = employeeMaster[e.empId];
        return !em || (em.salaryType||'weekly') === 'weekly';
      })) weekKeys.add(k);
    });
    Array.from(weekKeys).sort().reverse().forEach(k => {
      const isCur = k === '__current';
      const weekStr = isCur ? getWeekStr() : (salaryHistory[k]?.weekStr || k.replace(/_/g,' '));
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = weekStr + (isCur ? ' (Current Week)' : '');
      sel.appendChild(opt);
    });
  } else {
    if (lbl) lbl.textContent = 'Select Month';
    sel.innerHTML = '<option value="">— Choose a month —</option>';
    const months = new Set();
    Object.keys(monthlySal).forEach(key => {
      const [eId, ym] = key.split('::');
      const em = employeeMaster[eId];
      if (em && em.salaryType === 'monthly' && ym) months.add(ym);
    });
    Array.from(months).sort().reverse().forEach(ym => {
      const [yr, mm] = ym.split('-');
      const opt = document.createElement('option');
      opt.value = ym;
      opt.textContent = monthNames[parseInt(mm)-1] + ' ' + yr;
      sel.appendChild(opt);
    });
  }
}

function loadHistoryAllPeriod(period) {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  if (historyType === 'weekly') {
    const isCurrent = period === '__current';
    let entries, weekStr;
    if (isCurrent) {
      entries = employees
        .filter(e => { const em = employeeMaster[e.empId]; return !em || (em.salaryType||'weekly')==='weekly'; })
        .map(e => ({...e, weekStr: getWeekStr(), _isCurrent: true}));
      weekStr = getWeekStr();
    } else {
      const wk = salaryHistory[period];
      entries = wk ? wk.entries.filter(e => {
        const em = employeeMaster[e.empId];
        return !em || (em.salaryType||'weekly') === 'weekly';
      }) : [];
      weekStr = wk ? wk.weekStr : period.replace(/_/g,' ');
    }
    historySelectedWeek = period;
    renderHistoryContent(entries, weekStr, false);
  } else {
    // Monthly — all employees for this month
    const [yr, mm] = period.split('-');
    const monthLabel = monthNames[parseInt(mm)-1] + ' ' + yr;
    const entries = [];
    Object.values(employeeMaster).filter(m => m.salaryType === 'monthly').forEach(m => {
      const key = m.empId + '::' + period;
      const saved = monthlySal[key];
      if (!saved) return;
      entries.push({
        empId: m.empId, name: m.name||m.empId, phone: m.phone||'', addr: m.addr||'',
        salMonth: Number(saved.salMonth||0), advance: Number(saved.advance||0),
        oldAdv: Number(saved.oldAdv||0), netAmt: Number(saved.netAmt||0),
        monthName: monthLabel, key, mm: parseInt(mm), yr: parseInt(yr),
        savedAt: saved.savedAt
      });
    });
    historySelectedWeek = period;
    renderHistoryContent(entries, monthLabel, true);
  }
}

function histPopulatePeriods(empId) {
  const sel = document.getElementById('hist-period-select');
  const lbl = document.getElementById('hist-period-label');
  if (!sel) return;

  if (historyType === 'weekly') {
    if (lbl) lbl.textContent = 'Select Week';
    sel.innerHTML = '<option value="">— Choose a week —</option>';
    const weekKeys = new Set();
    Object.keys(salaryHistory).forEach(k => {
      if (salaryHistory[k].entries.some(e => e.empId === empId)) weekKeys.add(k);
    });
    if (employees.some(e => e.empId === empId)) {
      weekKeys.add('__current');
    }
    Array.from(weekKeys).sort().reverse().forEach(k => {
      const isCur  = k === '__current';
      const weekStr = isCur ? getWeekStr() : (salaryHistory[k]?.weekStr || k.replace(/_/g,' '));
      const opt    = document.createElement('option');
      opt.value    = k;
      opt.textContent = weekStr + (isCur ? ' (Current Week)' : '');
      sel.appendChild(opt);
    });
  } else {
    if (lbl) lbl.textContent = 'Select Month';
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    sel.innerHTML = '<option value="">— Choose a month —</option>';
    const months = new Set();
    Object.keys(monthlySal).forEach(key => {
      const [eId, ym] = key.split('::');
      if (eId === empId && ym) months.add(ym);
    });
    Array.from(months).sort().reverse().forEach(ym => {
      const [yr, mm] = ym.split('-');
      const opt = document.createElement('option');
      opt.value = ym;
      opt.textContent = monthNames[parseInt(mm)-1] + ' ' + yr;
      sel.appendChild(opt);
    });
  }
}

function loadHistoryPeriod() {
  const sel = document.getElementById('hist-period-select');
  if (!sel || !sel.value) return;
  const empId = window._histSelEmpId;
  if (!empId) return;

  if (empId === '__all') {
    loadHistoryAllPeriod(sel.value);
    return;
  }

  if (historyType === 'weekly') {
    historySelectedWeek = sel.value;
    loadHistoryWeekForEmp(empId, sel.value);
  } else {
    loadHistoryMonthForEmp(empId, sel.value);
  }
}

function loadHistoryWeekForEmp(empId, key) {
  const isCurrent = key === '__current';
  let entries, weekStr;

  if (isCurrent) {
    entries = employees.filter(e => e.empId === empId).map(e => ({...e, weekStr: getWeekStr(), _isCurrent: true}));
    weekStr = getWeekStr();
  } else {
    const wk = salaryHistory[key];
    entries = wk ? wk.entries.filter(e => e.empId === empId) : [];
    weekStr = wk ? wk.weekStr : key.replace(/_/g,' ');
  }

  historySelectedWeek = key;
  renderHistoryContent(entries, weekStr, false);
}

function loadHistoryMonthForEmp(empId, ym) {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const [yr, mm] = ym.split('-');
  const monthLabel = monthNames[parseInt(mm)-1] + ' ' + yr;
  const key = empId + '::' + ym;
  const saved = monthlySal[key];
  const m = employeeMaster[empId] || {};
  const entries = saved ? [{
    empId, name: m.name||empId, phone: m.phone||'', addr: m.addr||'',
    salMonth: Number(saved.salMonth||0), advance: Number(saved.advance||0),
    oldAdv: Number(saved.oldAdv||0), netAmt: Number(saved.netAmt||0),
    monthName: monthLabel, key, mm: parseInt(mm), yr: parseInt(yr),
    savedAt: saved.savedAt
  }] : [];
  historySelectedWeek = key;
  renderHistoryContent(entries, monthLabel, true);
}

// Keep old functions as aliases for backward compat
function loadHistoryWeek() { loadHistoryPeriod(); }
function loadHistoryMonth() { loadHistoryPeriod(); }

/* ── Render the Salary History content area (cards + totals footer) ──
   entries: array of weekly ({empId,name,phone,addr,days,rate,adv,oldAdv,_isCurrent?})
            or monthly ({empId,name,phone,addr,salMonth,advance,oldAdv,netAmt,mm,yr})
   periodStr: display label for the week/month
   isMonthly: true for monthly entries, false for weekly              */
function renderHistoryContent(entries, periodStr, isMonthly) {
  window._historyCurrentEntries = entries || [];
  window._historyCurrentWeekStr = periodStr || '';

  const emptyEl = document.getElementById('history-empty');
  const wrapEl  = document.getElementById('history-table-wrap');
  const footEl  = document.getElementById('history-footer');
  if (!emptyEl || !wrapEl) return;

  if (!entries || !entries.length) {
    emptyEl.innerHTML = `<div class="empty-icon">📅</div>No salary records found for <strong>${escHtml(periodStr||'this period')}</strong>.`;
    emptyEl.style.display = 'block';
    wrapEl.style.display  = 'none';
    if (footEl) footEl.style.display = 'none';
    wrapEl.innerHTML = '';
    return;
  }

  emptyEl.style.display = 'none';
  wrapEl.style.display  = 'block';

  wrapEl.innerHTML = '<div style="padding:4px 20px 0;">' + entries.map((e, i) => {
    const empIdSafe = escHtml(e.empId).replace(/'/g, "\\'");
    if (isMonthly) {
      const net = Number(e.netAmt !== undefined ? e.netAmt : Math.max(0, Number(e.salMonth||0)-Number(e.advance||0)-Number(e.oldAdv||0)));
      return `
      <div class="receipt-card" style="margin-bottom:12px;">
        <div class="receipt-card-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="emp-badge">${escHtml(e.empId)}</span>
            <span style="font-weight:800;color:var(--navy);font-size:13px;">${escHtml(e.name)}</span>
          </div>
          <div class="row-actions">
            <button class="btn btn-edit" onclick="histEditMonthly('${empIdSafe}',${e.mm},${e.yr})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
            <button class="btn btn-pdf" onclick="histDlMonthlyPdf('${empIdSafe}',${e.mm},${e.yr})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              PDF
            </button>
          </div>
        </div>
        <div class="receipt-card-body">
          <div class="receipt-grid">
            <div class="receipt-stat"><span class="receipt-stat-label">Salary / Month</span><span class="receipt-stat-val">${inr(e.salMonth)}</span></div>
            <div class="receipt-stat"><span class="receipt-stat-label">Advance</span><span class="receipt-stat-val red">${inr(e.advance)}</span></div>
            <div class="receipt-stat"><span class="receipt-stat-label">Old Advance</span><span class="receipt-stat-val red">${inr(e.oldAdv)}</span></div>
          </div>
          <div class="receipt-net-bar">
            <div><div class="receipt-net-label">Net Payable</div><div class="receipt-net-words">${numberToWords(Math.round(net))} Only</div></div>
            <div class="receipt-net-amount">${inr(net)}</div>
          </div>
        </div>
      </div>`;
    }

    const gross = Number(e.days||0) * Number(e.rate||0);
    const net   = calcNet(e);
    return `
    <div class="receipt-card" style="margin-bottom:12px;">
      <div class="receipt-card-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="emp-badge">${escHtml(e.empId)}</span>
          <span style="font-weight:800;color:var(--navy);font-size:13px;">${escHtml(e.name)}</span>
          ${e._isCurrent ? '<span style="background:rgba(212,168,67,.25);color:var(--gold);font-size:9px;font-weight:800;padding:2px 7px;border-radius:999px;letter-spacing:.3px;">CURRENT</span>' : ''}
        </div>
        <div class="row-actions">
          <button class="btn btn-edit" onclick="openHistoryEdit(${i})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <button class="btn btn-wa" onclick="shareHistoryWhatsApp(${i})">
            <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
            WA
          </button>
          <button class="btn btn-pdf" onclick="histDlWeeklyPdf(${i})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
            PDF
          </button>
        </div>
      </div>
      <div class="receipt-card-body" id="hist-body-${i}">
        <div class="receipt-grid">
          <div class="receipt-stat"><span class="receipt-stat-label">Days Worked</span><span class="receipt-stat-val">${e.days}</span></div>
          <div class="receipt-stat"><span class="receipt-stat-label">Rate / Day</span><span class="receipt-stat-val">${inr(e.rate)}</span></div>
          <div class="receipt-stat"><span class="receipt-stat-label">Gross Salary</span><span class="receipt-stat-val">${inr(gross)}</span></div>
          <div class="receipt-stat"><span class="receipt-stat-label">Advance (Week)</span><span class="receipt-stat-val red">${inr(e.adv||0)}</span></div>
          <div class="receipt-stat"><span class="receipt-stat-label">Old Advance</span><span class="receipt-stat-val red">${inr(e.oldAdv||0)}</span></div>
        </div>
        <div class="receipt-net-bar">
          <div><div class="receipt-net-label">Net Payable</div><div class="receipt-net-words">${numberToWords(net)} Only</div></div>
          <div class="receipt-net-amount">${inr(net)}</div>
        </div>
      </div>
      <div class="hist-edit-form" id="hist-edit-${i}" style="display:none;padding:0 16px 16px;">
        <div class="hist-edit-grid">
          <div class="field" style="margin:0;"><label style="font-size:10px;">Days Worked</label><input type="number" id="hedit-days-${i}" value="${e.days}" step="0.5" min="0" style="height:36px;"/></div>
          <div class="field" style="margin:0;"><label style="font-size:10px;">Rate / Day (₹)</label><input type="number" id="hedit-rate-${i}" value="${e.rate}" min="0" style="height:36px;"/></div>
          <div class="field" style="margin:0;"><label style="font-size:10px;">Advance (₹)</label><input type="number" id="hedit-adv-${i}" value="${e.adv||0}" min="0" style="height:36px;"/></div>
          <div class="field" style="margin:0;"><label style="font-size:10px;">Old Advance (₹)</label><input type="number" id="hedit-oldadv-${i}" value="${e.oldAdv||0}" min="0" style="height:36px;"/></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn btn-primary" style="height:34px;font-size:12px;" onclick="saveHistoryEdit(${i})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><path d="M20 6L9 17l-5-5"/></svg>
            Save Changes
          </button>
          <button class="btn btn-ghost" style="height:34px;font-size:12px;" onclick="cancelHistoryEdit(${i})">Cancel</button>
        </div>
      </div>
    </div>`;
  }).join('') + '</div>';

  // Overall totals footer
  if (footEl) {
    let tGross=0, tAdv=0, tOld=0, tNet=0;
    entries.forEach(e => {
      if (isMonthly) {
        tGross += Number(e.salMonth||0);
        tAdv   += Number(e.advance||0);
        tOld   += Number(e.oldAdv||0);
        tNet   += Number(e.netAmt !== undefined ? e.netAmt : Math.max(0, Number(e.salMonth||0)-Number(e.advance||0)-Number(e.oldAdv||0)));
      } else {
        tGross += Number(e.days||0) * Number(e.rate||0);
        tAdv   += Number(e.adv||0);
        tOld   += Number(e.oldAdv||0);
        tNet   += calcNet(e);
      }
    });
    footEl.style.display = 'flex';
    footEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;padding:14px 20px;background:var(--offwhite);border-top:1px solid var(--border);';
    footEl.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--navy);">${entries.length} record${entries.length>1?'s':''} &nbsp;·&nbsp; ${escHtml(periodStr||'')}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <div style="font-size:11px;color:var(--muted);">Gross&nbsp;<strong style="color:var(--navy);">${inr(tGross)}</strong></div>
        <div style="font-size:11px;color:var(--muted);">Advance&nbsp;<strong style="color:var(--accent);">${inr(tAdv)}</strong></div>
        <div style="font-size:11px;color:var(--muted);">Old&nbsp;Adv&nbsp;<strong style="color:var(--accent);">${inr(tOld)}</strong></div>
        <div style="font-size:11px;color:var(--muted);">Net&nbsp;Pay&nbsp;<strong style="color:var(--green);">${inr(tNet)}</strong></div>
      </div>
      <button class="btn btn-pdf" onclick="dlHistoryPdf()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
        Overall PDF
      </button>`;
  }
}

/* Jump straight to the week/month that contains a picked calendar date.
   Resolves the date to the matching week (Mon–Sun) or month and loads it,
   for whichever scope (All Employees / a single employee) is active. */
function histJumpToDate(dateStr) {
  if (!dateStr) return;
  const picked = new Date(dateStr + 'T00:00:00');
  if (isNaN(picked)) return;

  const scope = window._histSelEmpId; // '__all' | empId | null

  if (historyType === 'weekly') {
    const day = picked.getDay();
    const mon = new Date(picked); mon.setDate(picked.getDate() - ((day+6)%7));
    const sun = new Date(mon);    sun.setDate(mon.getDate()+6);
    const fmt = d => d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
    const weekStr = fmt(mon)+' – '+fmt(sun);
    const period  = (weekStr === getWeekStr()) ? '__current' : weekStr.replace(/\s/g,'_');

    const sel = document.getElementById('hist-period-select');
    if (sel) { const opt = Array.from(sel.options).find(o => o.value === period); sel.value = opt ? period : ''; }

    if (scope === '__all')      { loadHistoryAllPeriod(period); }
    else if (scope)             { historySelectedWeek = period; loadHistoryWeekForEmp(scope, period); }
    else                        { histPickAll(); loadHistoryAllPeriod(period); }
  } else {
    const yr = picked.getFullYear();
    const mm = String(picked.getMonth()+1).padStart(2,'0');
    const ym = yr+'-'+mm;

    const sel = document.getElementById('hist-period-select');
    if (sel) { const opt = Array.from(sel.options).find(o => o.value === ym); sel.value = opt ? ym : ''; }

    if (scope === '__all')      { loadHistoryAllPeriod(ym); }
    else if (scope)             { loadHistoryMonthForEmp(scope, ym); }
    else                        { histPickAll(); loadHistoryAllPeriod(ym); }
  }
}

/* Edit a monthly history entry — hands off to the Monthly Salary calculator
   pre-loaded with the right employee/month, same as the sheet's Edit button. */
function histEditMonthly(empId, mm, yr) {
  closeHistoryModal();
  switchSalaryMode('monthly');
  msMonth = mm - 1;
  msYear  = yr;
  const sel = document.getElementById('ms-emp-select');
  if (sel) sel.value = empId;
  msPick(empId);
  document.getElementById('monthly-salary-section')?.scrollIntoView({behavior:'smooth', block:'start'});
}

/* Download an individual monthly PDF for a specific (possibly past) month,
   without disturbing whatever month/employee the Monthly Salary page is on. */
function histDlMonthlyPdf(empId, mm, yr) {
  const prevSel = msSelEmp, prevM = msMonth, prevY = msYear;
  msSelEmp = empId; msMonth = mm - 1; msYear = yr;
  buildMonthlySalPdf();
  msSelEmp = prevSel; msMonth = prevM; msYear = prevY;
}

/* Download an individual weekly PDF for a history row (uses the entries
   currently rendered in the Salary History modal, not the live sheet). */
function histDlWeeklyPdf(i) {
  const entries = window._historyCurrentEntries;
  if (!entries || !entries[i]) return;
  buildIndividualPdf(entries[i], window._historyCurrentWeekStr || entries[i].weekStr || getWeekStr());
}

/* WhatsApp share for a history row (weekly). */
function shareHistoryWhatsApp(i) {
  const entries = window._historyCurrentEntries;
  if (!entries || !entries[i]) return;
  const e = entries[i];
  const gross = Number(e.days||0) * Number(e.rate||0);
  const net   = calcNet(e);
  const phone = (e.phone||'').replace(/\D/g,'');
  const displayPhone = e.phone ? '+91 ' + e.phone : '—';
  const week = window._historyCurrentWeekStr || getWeekStr();
  const msg = `*RK SPORTS WEAR*\n_Sports is Our Identity_\nSri Complex, Udhayam Theatre, Manapparai – 621 306\n📞 +91 99528 89854\n\n━━━━━━━━━━━━━━━━━━━━━━\n       *SALARY RECEIPT*\n━━━━━━━━━━━━━━━━━━━━━━\n*Week:* ${week}\n\n*Employee ID  :* ${e.empId}\n*Name          :* ${e.name}\n*Phone          :* ${displayPhone}\n*Address        :* ${e.addr||'—'}\n\n━━━━━━━━━━━━━━━━━━━━━━\n*Days Worked    :* ${e.days} days\n*Rate Per Day   :* ₹${Number(e.rate).toLocaleString('en-IN')}\n*Gross Salary   :* ₹${gross.toLocaleString('en-IN')}\n*Advance (Week) :* ₹${Number(e.adv||0).toLocaleString('en-IN')}\n*Old Advance    :* ₹${Number(e.oldAdv||0).toLocaleString('en-IN')}\n━━━━━━━━━━━━━━━━━━━━━━\n*NET PAYABLE    :* ₹${net.toLocaleString('en-IN')}\n━━━━━━━━━━━━━━━━━━━━━━\n_Indian Rupee ${numberToWords(net)} Only_\n\n_This is a computer-generated salary receipt._`;
  const url = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}


function closeHistoryModal() {
  document.getElementById('history-modal').classList.remove('open');
  if(!document.querySelector('.modal-overlay.open')) document.body.style.overflow='';
}
function closeHistoryOutside(e) { if(e.target===document.getElementById('history-modal')) closeHistoryModal(); }

/* ── History Inline Edit ────────────────────────────────────── */
function openHistoryEdit(i) {
  // Hide body, show edit form
  const body = document.getElementById('hist-body-'+i);
  const form = document.getElementById('hist-edit-'+i);
  if (body) body.style.display = 'none';
  if (form) form.style.display = 'block';
  document.getElementById('hedit-days-'+i)?.focus();
}

function cancelHistoryEdit(i) {
  const body = document.getElementById('hist-body-'+i);
  const form = document.getElementById('hist-edit-'+i);
  if (body) body.style.display = '';
  if (form) form.style.display = 'none';
}

function saveHistoryEdit(i) {
  const entries = window._historyCurrentEntries;
  const weekStr = window._historyCurrentWeekStr;
  if (!entries || !entries[i]) return;

  const days   = parseFloat(document.getElementById('hedit-days-'+i)?.value) || 0;
  const rate   = parseFloat(document.getElementById('hedit-rate-'+i)?.value) || 0;
  const adv    = parseFloat(document.getElementById('hedit-adv-'+i)?.value)  || 0;
  const oldAdv = parseFloat(document.getElementById('hedit-oldadv-'+i)?.value) || 0;

  // Update in-memory entry
  entries[i].days   = days;
  entries[i].rate   = rate;
  entries[i].adv    = adv;
  entries[i].oldAdv = oldAdv;

  // Persist to salaryHistory or current week employees[]
  const key = historySelectedWeek;
  if (key === '__current') {
    // Update current week employees array
    const empIdx = employees.findIndex(e => e.empId === entries[i].empId);
    if (empIdx >= 0) {
      employees[empIdx].days   = days;
      employees[empIdx].rate   = rate;
      employees[empIdx].adv    = adv;
      employees[empIdx].oldAdv = oldAdv;
    }
    renderTable();
  } else if (salaryHistory[key]) {
    // Update saved history entry
    const hIdx = salaryHistory[key].entries.findIndex(e => e.empId === entries[i].empId);
    if (hIdx >= 0) {
      salaryHistory[key].entries[hIdx].days   = days;
      salaryHistory[key].entries[hIdx].rate   = rate;
      salaryHistory[key].entries[hIdx].adv    = adv;
      salaryHistory[key].entries[hIdx].oldAdv = oldAdv;
    }
    saveHistory();
  }

  showToast('✅ Salary record updated — employee view reflects this change.');

  // Re-render this week to show updated values
  loadHistoryWeek();
}

function editHistoryAttendance() {
  // Figure out which month/year the selected week falls in
  const entries = window._historyCurrentEntries;
  const weekStr = window._historyCurrentWeekStr;
  if (!entries || !entries.length) return;

  // Parse year/month from weekStr (format: "15 Jun – 21 Jun 2026")
  let attMonth = new Date().getMonth();
  let attYr    = new Date().getFullYear();
  try {
    const parts = weekStr.split(/[–\-]/);
    const lastPart = parts[parts.length-1].trim();  // e.g. "21 Jun 2026"
    const parsed = new Date(lastPart);
    if (!isNaN(parsed)) { attMonth = parsed.getMonth(); attYr = parsed.getFullYear(); }
  } catch(_) {}

  closeHistoryModal();
  openAttendanceModal('admin');

  // Pre-select first employee and navigate to correct month
  setTimeout(() => {
    // Navigate attendance modal to correct month/year
    attYear  = attYr;
    attMonth_local: {
      const el = document.getElementById('att-year-sel');
      if (el) el.value = attYr;
    }
    // Set month
    const monEl = document.getElementById('att-month-sel');
    if (monEl) { monEl.value = attMonth; }

    // Pre-select first employee in list
    if (entries[0]) {
      const sel = document.getElementById('att-emp-filter');
      if (sel) {
        sel.value = entries[0].empId;
        attSelEmp = entries[0].empId;
      }
    }
    renderAttendanceCalendar();
    showToast('📅 Navigate to the correct month and edit attendance marks directly.');
  }, 200);
}

/* ═══════════════════════════════════════════════════════════
   WHATSAPP SHARE
════════════════════════════════════════════════════════════ */
function shareWhatsApp(i) {
  const e=employees[i]; const gross=e.days*e.rate; const net=calcNet(e);
  const phone=(e.phone||'').replace(/\D/g,'');
  const displayPhone=e.phone?'+91 '+e.phone:'—';
  const week=getWeekStr();
  const msg=`*RK SPORTS WEAR*\n_Sports is Our Identity_\nSri Complex, Udhayam Theatre, Manapparai – 621 306\n📞 +91 99528 89854\n\n━━━━━━━━━━━━━━━━━━━━━━\n       *SALARY RECEIPT*\n━━━━━━━━━━━━━━━━━━━━━━\n*Week:* ${week}\n\n*Employee ID  :* ${e.empId}\n*Name          :* ${e.name}\n*Phone          :* ${displayPhone}\n*Address        :* ${e.addr||'—'}\n\n━━━━━━━━━━━━━━━━━━━━━━\n*Days Worked    :* ${e.days} days\n*Rate Per Day   :* ₹${e.rate.toLocaleString('en-IN')}\n*Gross Salary   :* ₹${gross.toLocaleString('en-IN')}\n*Advance (Week) :* ₹${e.adv.toLocaleString('en-IN')}\n*Old Advance    :* ₹${e.oldAdv.toLocaleString('en-IN')}\n━━━━━━━━━━━━━━━━━━━━━━\n*NET PAYABLE    :* ₹${net.toLocaleString('en-IN')}\n━━━━━━━━━━━━━━━━━━━━━━\n_Indian Rupee ${numberToWords(net)} Only_\n\n_This is a computer-generated salary receipt._`;
  const url=phone?`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`:`https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url,'_blank');
}

function shareMonthlyWhatsApp() {
  if (!msSelEmp) return;
  const m = employeeMaster[msSelEmp];
  if (!m) return;

  const mm        = String(msMonth+1).padStart(2,'0');
  const monthNames= ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const period    = monthNames[msMonth] + ' ' + msYear;
  const msSaved   = monthlySal[`${msSelEmp}::${msYear}-${mm}`] || {};
  const salMonth  = Number(msSaved.salMonth || m.rate || 0);
  const advAmt    = Number(msSaved.advance  || 0);
  const oldAdv    = Number(msSaved.oldAdv   || 0);
  const netAmt    = Math.max(0, salMonth - advAmt - oldAdv);
  const words     = numberToWords(Math.round(netAmt));
  const phone     = (m.phone || '').replace(/\D/g,'');
  const displayPhone = m.phone ? '+91 ' + m.phone : '—';

  // Count attendance for this month
  const attKey    = `${msSelEmp}::${msYear}-${mm}`;
  const rec       = attendance[attKey] || {};
  const daysInMonth = new Date(msYear, msMonth+1, 0).getDate();
  let presentDays = 0, absentDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds  = `${msYear}-${mm}-${String(d).padStart(2,'0')}`;
    const val = rec[ds];
    if      (val === 'FD')              { presentDays += 1; }
    else if (val === 'HM' || val === 'HE') { presentDays += 0.5; absentDays += 0.5; }
    else if (val === 'A')               { absentDays += 1; }
    else if (typeof val === 'number' && val > 0) { presentDays += 1; }
    else if (val === 'P' || val === 'H') { presentDays += 1; }
  }

  const msg =
`*RK SPORTS WEAR*
_Sports is Our Identity_
Sri Complex, Udhayam Theatre, Manapparai – 621 306
📞 +91 99528 89854

━━━━━━━━━━━━━━━━━━━━━━
    *MONTHLY SALARY RECEIPT*
━━━━━━━━━━━━━━━━━━━━━━
*Month:* ${period}

*Employee ID   :* ${m.empId}
*Name           :* ${m.name}
*Phone           :* ${displayPhone}

━━━━━━━━━━━━━━━━━━━━━━
*Days Present   :* ${presentDays} days
*Days Absent    :* ${absentDays} days
*Monthly Salary :* ₹${salMonth.toLocaleString('en-IN')}
*Advance        :* ₹${advAmt.toLocaleString('en-IN')}
*Old Advance    :* ₹${oldAdv.toLocaleString('en-IN')}
━━━━━━━━━━━━━━━━━━━━━━
*NET PAYABLE    :* ₹${netAmt.toLocaleString('en-IN')}
━━━━━━━━━━━━━━━━━━━━━━
_Indian Rupee ${words} Only_

_This is a computer-generated salary receipt._`;

  const url = phone
    ? `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

/* ═══════════════════════════════════════════════════════════
   PDF — Individual
════════════════════════════════════════════════════════════ */
function dlIndividual(i) { buildIndividualPdf(employees[i], getWeekStr()); }

function buildIndividualPdf(emp, weekStr) {
  if(typeof emp==='string') emp=JSON.parse(emp);
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const W=doc.internal.pageSize.getWidth(); const H=doc.internal.pageSize.getHeight();
  const week=weekStr||getWeekStr();
  const gross=emp.days*emp.rate; const net=calcNet(emp);
  const words=numberToWords(net);
  const today=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  const L=14,R=W-L,CW=R-L,LBL=38,VAL=L+LBL+4;

  doc.setFillColor(14,30,60); doc.rect(0,0,W,30,'F');
  if(window.RK_LOGO_B64){try{doc.addImage(window.RK_LOGO_B64,'PNG',L,3,24,24);}catch(_){}}
  const cx=L+28;
  doc.setFontSize(12);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);doc.text('RK SPORTS WEAR',cx,11);
  doc.setFontSize(7);doc.setFont(undefined,'normal');doc.setTextColor(180,195,220);doc.text('Sri Complex, Near Udhayam Theatre, Manapparai\u2013 621 306.  |  +91 99528 89854',cx,17);
  doc.setFontSize(7.5);doc.setFont(undefined,'italic');doc.setTextColor(180,195,220);doc.text('Sports is Our Identity',cx,23);
  doc.setFontSize(10);doc.setFont(undefined,'bold');doc.setTextColor(212,168,67);doc.text('Salary Receipt',R,10,{align:'right'});
  doc.setFontSize(7.5);doc.setFont(undefined,'normal');doc.setTextColor(180,195,220);doc.text('Week: '+week,R,17,{align:'right'});

  const boxW=56,boxH=24,boxX=R-boxW,boxY=54;
  doc.setDrawColor(180,215,195);doc.setLineWidth(0.4);doc.setFillColor(234,246,239);doc.roundedRect(boxX,boxY,boxW,boxH,2,2,'FD');
  doc.setFontSize(16);doc.setFont(undefined,'bold');doc.setTextColor(14,107,58);doc.text('Rs.'+gross.toLocaleString('en-IN'),boxX+boxW/2,boxY+13,{align:'center'});
  doc.setFontSize(7);doc.setFont(undefined,'normal');doc.setTextColor(60,140,100);doc.text('Gross Salary',boxX+boxW/2,boxY+18,{align:'center'});

  let y=36;
  doc.setFontSize(8);doc.setFont(undefined,'bold');doc.setTextColor(80,90,110);doc.text('EMPLOYEE SUMMARY',L,y+5);
  doc.setDrawColor(214,220,232);doc.setLineWidth(0.3);doc.line(L,y+7,R,y+7);
  y+=12;const rowH=9;
  const infoRows=[['Employee Name',emp.name],['Employee ID',emp.empId],['Phone Number',emp.phone?'+91 '+emp.phone:'\u2014'],['Address',emp.addr||'\u2014'],['Pay Period',week],['Pay Date',today]];
  infoRows.forEach(([lbl,val])=>{
    doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(120,130,145);doc.text(lbl,L,y);doc.setTextColor(120,130,145);doc.text(':',L+LBL,y);
    doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);
    const valMaxW=boxX-VAL-4;
    if(lbl==='Address'&&doc.getTextWidth(val)>valMaxW){const lines=doc.splitTextToSize(val,valMaxW);doc.text(lines,VAL,y);y+=(lines.length-1)*5;}
    else{doc.text(val,VAL,y);}
    y+=rowH;
  });
  y+=4;
  const halfW=(CW-4)/2;
  doc.setDrawColor(214,220,232);doc.setLineWidth(0.3);doc.setFillColor(247,248,252);doc.roundedRect(L,y,halfW,14,1.5,1.5,'FD');
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(120,130,145);doc.text('Paid Days',L+4,y+6);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);doc.text(': '+emp.days,L+32,y+6);
  const rx=L+halfW+4;doc.setFillColor(247,248,252);doc.roundedRect(rx,y,halfW,14,1.5,1.5,'FD');
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(120,130,145);doc.text('LOP Days',rx+4,y+6);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);doc.text(': 0',rx+32,y+6);
  y+=22;
  const tColW=(CW-4)/2,tHdrH=10,tRowH=10,tFtrH=10;
  doc.setFillColor(14,30,60);doc.rect(L,y,tColW,tHdrH,'F');doc.rect(L+tColW+4,y,tColW,tHdrH,'F');
  doc.setFontSize(8);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);
  doc.text('EARNINGS',L+3,y+6.5);doc.text('AMOUNT',L+tColW-3,y+6.5,{align:'right'});
  doc.text('DEDUCTIONS',L+tColW+7,y+6.5);doc.text('AMOUNT',L+tColW*2+4-3,y+6.5,{align:'right'});
  y+=tHdrH;
  const earnings=[['Basic Salary',emp.rate],['Days \u00d7 Salary',gross]];
  const deductions=[['Advance (Week)',emp.adv],['Old Advance',emp.oldAdv]];
  const maxR=Math.max(earnings.length,deductions.length);
  for(let r=0;r<maxR;r++){
    const bg=r%2===0?[252,252,252]:[245,246,250];
    doc.setFillColor(...bg);doc.rect(L,y,tColW,tRowH,'F');doc.rect(L+tColW+4,y,tColW,tRowH,'F');
    doc.setFontSize(8);
    if(earnings[r]){doc.setFont(undefined,'normal');doc.setTextColor(40,50,70);doc.text(earnings[r][0],L+3,y+6.5);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);doc.text('Rs.'+Number(earnings[r][1]).toLocaleString('en-IN'),L+tColW-3,y+6.5,{align:'right'});}
    if(deductions[r]){doc.setFont(undefined,'normal');doc.setTextColor(40,50,70);doc.text(deductions[r][0],L+tColW+7,y+6.5);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);doc.text('Rs.'+Number(deductions[r][1]).toLocaleString('en-IN'),L+tColW*2+4-3,y+6.5,{align:'right'});}
    doc.setDrawColor(225,228,235);doc.setLineWidth(0.2);doc.line(L,y+tRowH,L+tColW,y+tRowH);doc.line(L+tColW+4,y+tRowH,L+tColW*2+4,y+tRowH);
    y+=tRowH;
  }
  doc.setFillColor(228,233,243);doc.rect(L,y,tColW,tFtrH,'F');doc.rect(L+tColW+4,y,tColW,tFtrH,'F');
  doc.setFontSize(8);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);
  doc.text('Gross Salary',L+3,y+6.5);doc.text('Rs.'+gross.toLocaleString('en-IN'),L+tColW-3,y+6.5,{align:'right'});
  doc.text('Total Deductions',L+tColW+7,y+6.5);doc.text('Rs.'+(emp.adv+emp.oldAdv).toLocaleString('en-IN'),L+tColW*2+4-3,y+6.5,{align:'right'});
  y+=tFtrH+6;
  const bandH=18;doc.setFillColor(14,30,60);doc.rect(L,y,CW,bandH,'F');
  doc.setFontSize(10);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);doc.text('TOTAL NET PAYABLE',L+4,y+7.5);
  doc.setFontSize(7.5);doc.setFont(undefined,'normal');doc.setTextColor(170,185,210);doc.text('Gross Salary \u2013 Total Deductions',L+4,y+14);
  doc.setFontSize(13);doc.setFont(undefined,'bold');doc.setTextColor(212,168,67);doc.text('Rs.'+net.toLocaleString('en-IN'),R-4,y+12,{align:'right'});
  y+=bandH+10;
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(120,130,145);doc.text('Amount In Words :',R,y,{align:'right'});y+=6;
  doc.setFontSize(8.5);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);
  const wLine='Indian Rupee '+words+' Only';doc.text(doc.splitTextToSize(wLine,CW),R,y,{align:'right'});
  doc.setDrawColor(214,220,232);doc.setLineWidth(0.3);doc.line(L,H-14,R,H-14);
  doc.setFontSize(6.5);doc.setFont(undefined,'normal');doc.setTextColor(160,170,185);
  doc.text('-- This document has been automatically generated by RK Sports Wear Salary System; therefore, a signature is not required. --',W/2,H-8,{align:'center'});
  doc.save(week+'_Salary_'+emp.empId+'_'+emp.name.replace(/\s+/g,'_')+'.pdf');
}

/* ═══════════════════════════════════════════════════════════
   PDF — Overall (from entries array)
════════════════════════════════════════════════════════════ */
function dlOverall() {
  if(!employees.length){showMsg('No Entries','Add at least one employee salary entry first.','info');return;}
  buildOverallPdfFromEntries(employees, getWeekStr());
}

function buildOverallPdfFromEntries(entries, weekStr) {
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'mm',format:'a4',orientation:'landscape'});
  const W=doc.internal.pageSize.getWidth();const H=doc.internal.pageSize.getHeight();
  const week=weekStr||getWeekStr();
  doc.setFillColor(14,30,60);doc.rect(0,0,W,26,'F');
  if(window.RK_LOGO_B64){try{doc.addImage(window.RK_LOGO_B64,'PNG',8,3,30,16);}catch(e){}}
  doc.setFontSize(14);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);doc.text('RK SPORTS WEAR',W/2,10,{align:'center'});
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(180,190,210);doc.text('Sri Complex,Near Udhayam Theatre, Manapparai– 621 306 |  +91 99528 89854',W/2,16,{align:'center'});
  doc.setFontSize(9.5);doc.setFont(undefined,'bold');doc.setTextColor(212,168,67);doc.text('WEEKLY SALARY SHEET',W/2,23,{align:'center'});
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(80,90,110);doc.text('Week: '+week+'    |    Total Employees: '+entries.length,W/2,32,{align:'center'});
  const cols=[{h:'S.No',w:8},{h:'Emp ID',w:20},{h:'Name',w:36},{h:'Phone',w:30},{h:'Address',w:50},{h:'Days',w:12},{h:'Salary/Day',w:22},{h:'Gross',w:24},{h:'Advance',w:24},{h:'Old Adv',w:22},{h:'Net Pay',w:26}];
  const startX=10;let y=36;
  doc.setFillColor(14,30,60);doc.rect(startX,y,W-20,9,'F');doc.setFontSize(7.5);doc.setFont(undefined,'bold');doc.setTextColor(180,190,210);
  let x=startX;cols.forEach(c=>{doc.text(c.h,x+1.5,y+6);x+=c.w;});y+=9;
  entries.forEach((e,idx)=>{
    const gross=e.days*e.rate;const net=calcNet(e);
    const vals=[String(idx+1),e.empId,e.name,e.phone?'+91 '+e.phone:'—',e.addr||'—',String(e.days),inrPdf(e.rate),inrPdf(gross),inrPdf(e.adv),inrPdf(e.oldAdv),inrPdf(net)];
    if(idx%2===0){doc.setFillColor(252,252,252);}else{doc.setFillColor(246,247,250);}
    doc.rect(startX,y,W-20,8,'F');doc.setFontSize(7.5);doc.setFont(undefined,'normal');doc.setTextColor(14,30,60);
    x=startX;vals.forEach((v,vi)=>{
      const maxW=cols[vi].w-3;let txt=String(v);
      if(doc.getTextWidth(txt)>maxW)txt=txt.substring(0,Math.floor(maxW/doc.getTextWidth('A'))-1)+'…';
      if(vi===10){doc.setFont(undefined,'bold');doc.setTextColor(14,107,58);}else{doc.setFont(undefined,'normal');doc.setTextColor(14,30,60);}
      doc.text(txt,x+1.5,y+5.5);x+=cols[vi].w;
    });
    doc.setDrawColor(214,220,232);doc.setLineWidth(0.2);doc.line(startX,y+8,W-10,y+8);y+=8;
    if(y>H-22){doc.addPage('a4','landscape');y=16;}
  });

  // Totals row — Gross, Advance, Old Adv, Net Pay
  const tGross = entries.reduce((s,e)=>s+(e.days*e.rate),0);
  const tAdv   = entries.reduce((s,e)=>s+Number(e.adv||0),0);
  const tOld   = entries.reduce((s,e)=>s+Number(e.oldAdv||0),0);
  const tNet   = entries.reduce((s,e)=>s+calcNet(e),0);

  doc.setFillColor(14,30,60);doc.rect(startX,y,W-20,11,'F');
  doc.setFontSize(8);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);
  doc.text('TOTAL ('+entries.length+' employees)',startX+2,y+7.5);

  // Column x-offsets: S.No,EmpID,Name,Phone,Address,Days,Salary/Day,Gross,Advance,OldAdv,NetPay
  let colX = startX + cols[0].w + cols[1].w + cols[2].w + cols[3].w + cols[4].w + cols[5].w + cols[6].w; // start of Gross col
  doc.setTextColor(255,255,255);       doc.text(inrPdf(tGross), colX+1.5, y+7.5); colX += cols[7].w;
  doc.setTextColor(255,255,255);       doc.text(inrPdf(tAdv),   colX+1.5, y+7.5); colX += cols[8].w;
  doc.setTextColor(255,255,255);       doc.text(inrPdf(tOld),   colX+1.5, y+7.5); colX += cols[9].w;
  doc.setTextColor(212,168,67);        doc.text(inrPdf(tNet),   colX+1.5, y+7.5);

  doc.setFontSize(7);doc.setFont(undefined,'normal');doc.setTextColor(160,170,185);doc.text('Generated by RK Sports Wear Salary System — computer generated document',W/2,H-6,{align:'center'});
  doc.save(week+'_RK_Sports_Wear_Weekly_Salary_Sheet.pdf');
}
function inrPdf(n){return'Rs.'+Number(n).toLocaleString('en-IN');}

/* ═══════════════════════════════════════════════════════════
   WEEK PREVIEW MODAL
════════════════════════════════════════════════════════════ */
function openPreview(){
  document.getElementById('modal-week-label').textContent=getWeekStr();
  buildPreviewContent();
  document.getElementById('preview-modal').classList.add('open');
  document.body.style.overflow='hidden';
}
function closePreview(){document.getElementById('preview-modal').classList.remove('open');document.body.style.overflow='';}
function closePreviewOutside(e){if(e.target===document.getElementById('preview-modal'))closePreview();}
function buildPreviewContent(){
  const summary=document.getElementById('modal-summary');
  const empty=document.getElementById('modal-empty');
  const wrap=document.getElementById('modal-table-wrap');
  const footer=document.getElementById('modal-footer');
  const tG=employees.reduce((s,e)=>s+e.days*e.rate,0);
  const tA=employees.reduce((s,e)=>s+e.adv+e.oldAdv,0);
  const tN=employees.reduce((s,e)=>s+calcNet(e),0);
  summary.innerHTML=`<div class="modal-stat"><div class="modal-stat-label">Employees</div><div class="modal-stat-val">${employees.length}</div></div><div class="modal-stat"><div class="modal-stat-label">Total Gross</div><div class="modal-stat-val">${inr(tG)}</div></div><div class="modal-stat"><div class="modal-stat-label">Total Advance</div><div class="modal-stat-val red">${inr(tA)}</div></div><div class="modal-stat"><div class="modal-stat-label">Net Payable</div><div class="modal-stat-val green">${inr(tN)}</div></div>`;
  if(!employees.length){empty.style.display='block';wrap.style.display='none';footer.style.display='none';return;}
  empty.style.display='none';wrap.style.display='block';footer.style.display='flex';
  const table=document.getElementById('modal-table');
  table.innerHTML=`<thead><tr><th>#</th><th>Emp ID</th><th>Name</th><th>Days</th><th>Rate/Day</th><th>Gross</th><th>Advance</th><th>Old Adv</th><th>Net Pay</th></tr></thead><tbody>${employees.map((e,i)=>{const gross=e.days*e.rate;const net=calcNet(e);return`<tr><td style="color:var(--muted);font-size:11px;">${i+1}</td><td><span class="emp-badge">${e.empId}</span></td><td style="font-weight:600">${e.name}</td><td>${e.days}</td><td>${inr(e.rate)}</td><td>${inr(gross)}</td><td style="color:var(--accent)">${inr(e.adv)}</td><td style="color:var(--accent)">${inr(e.oldAdv)}</td><td class="modal-net">${inr(net)}</td></tr>`;}).join('')}</tbody><tfoot><tr><td colspan="5">Total — ${employees.length} employee${employees.length>1?'s':''}</td><td>${inr(tG)}</td><td>${inr(employees.reduce((s,e)=>s+e.adv,0))}</td><td>${inr(employees.reduce((s,e)=>s+e.oldAdv,0))}</td><td style="color:var(--gold)">${inr(tN)}</td></tr></tfoot>`;
}

/* ═══════════════════════════════════════════════════════════
   EMPLOYEE MASTER MANAGEMENT MODAL
════════════════════════════════════════════════════════════ */
let masterEditId=null;
function openMasterModal(){renderMasterList();document.getElementById('master-modal').classList.add('open');document.body.style.overflow='hidden';}

/* ═══════════════════════════════════════════════════════════
   ADMIN EMPLOYEE PREVIEW — see + modify exactly what the
   employee sees (salary receipts, attendance, advance ledger)
════════════════════════════════════════════════════════════ */
let aepEmpId = null;

function openAdminEmpPreview(empId) {
  const m = employeeMaster[empId];
  if (!m) return;
  aepEmpId = empId;

  const photo    = empPhotos[empId];
  const initials = (m.name||empId).trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const avatarEl = document.getElementById('aep-avatar');
  if (avatarEl) {
    if (photo) { avatarEl.style.backgroundImage = `url(${photo})`; avatarEl.style.backgroundSize='cover'; avatarEl.style.backgroundPosition='center'; avatarEl.textContent=''; }
    else { avatarEl.style.backgroundImage=''; avatarEl.textContent = initials; }
  }
  document.getElementById('aep-name').textContent = m.name;
  const isMonthly = m.salaryType === 'monthly';
  document.getElementById('aep-meta').innerHTML =
    `<span class="emp-badge">${escHtml(m.empId)}</span> &nbsp;·&nbsp; ${isMonthly?'Monthly':'Weekly'} Salary &nbsp;·&nbsp; ${m.phone?'+91 '+escHtml(m.phone):'No phone'}`;

  renderAdminEmpPreview();

  document.getElementById('admin-preview-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAdminEmpPreviewModal() {
  document.getElementById('admin-preview-modal').classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}
function closeAdminEmpPreviewOutside(e) {
  if (e.target === document.getElementById('admin-preview-modal')) closeAdminEmpPreviewModal();
}

/* Renders the receipts + advance ledger using the same logic as
   the employee's own view, but writing into the aep-* elements. */
function renderAdminEmpPreview() {
  if (!aepEmpId) return;
  const prevCurrent = currentEmpId;
  currentEmpId = aepEmpId;

  // Temporarily redirect the shared render targets to the aep-* elements
  // by swapping element ids is risky; instead we reuse renderEmployeeReceipts'
  // logic by calling it then copying its output, since it writes to
  // emp-receipts-list / emp-stats-row / emp-advance-* by id.
  // To avoid touching the real employee view DOM (in case it's also open),
  // we run the same computations here directly targeting aep-* elements.

  const m = employeeMaster[aepEmpId];
  const isMonthly = m && m.salaryType === 'monthly';
  const statsEl = document.getElementById('aep-stats-row');
  const listEl  = document.getElementById('aep-receipts-list');
  const emptyEl = document.getElementById('aep-receipts-empty');

  if (isMonthly) {
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const records = [];
    Object.keys(monthlySal).forEach(key => {
      if (key.startsWith(aepEmpId + '::')) {
        const [, ym] = key.split('::');
        const [yr, mm] = ym.split('-').map(Number);
        const saved = monthlySal[key];
        records.push({ key, yr, mm, monthName: monthNames[mm-1] + ' ' + yr, ...saved });
      }
    });
    records.sort((a,b) => b.key.localeCompare(a.key));
    window._aepRecords = records;

    const totalNet = records.reduce((s,r) => s + Number(r.netAmt||0), 0);
    const totalSal = records.reduce((s,r) => s + Number(r.salMonth||0), 0);
    if (statsEl) statsEl.innerHTML = `
      <div class="emp-stat-card"><div class="emp-stat-icon">📋</div><div class="emp-stat-label">Total Months</div><div class="emp-stat-val gold">${records.length}</div></div>
      <div class="emp-stat-card"><div class="emp-stat-icon">💰</div><div class="emp-stat-label">Total Earned</div><div class="emp-stat-val green">${inr(totalNet)}</div></div>
      <div class="emp-stat-card"><div class="emp-stat-icon">📅</div><div class="emp-stat-label">Gross Total</div><div class="emp-stat-val">${inr(totalSal)}</div></div>`;

    if (!records.length) {
      emptyEl.style.display = 'block'; listEl.innerHTML = '';
    } else {
      emptyEl.style.display = 'none';
      listEl.innerHTML = records.map((r, i) => {
        const net = Number(r.netAmt||0), sal = Number(r.salMonth||0), adv = Number(r.advance||0), oldAdv = Number(r.oldAdv||0);
        return `
        <div class="receipt-card" id="aep-card-${i}">
          <div class="receipt-card-header">
            <span class="receipt-week-label">📅 ${escHtml(r.monthName)}</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="btn btn-edit" style="height:28px;font-size:11px;" onclick="aepToggleEdit(${i})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit
              </button>
              <button class="receipt-dl-btn" onclick="aepDownloadPdf(${i})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                PDF
              </button>
            </div>
          </div>
          <!-- Inline edit form -->
          <div class="hist-edit-form" id="aep-edit-${i}" style="display:none;">
            <div class="hist-edit-grid">
              <div class="field" style="margin:0;"><label style="font-size:10px;">Salary / Month (₹)</label><input type="number" id="aep-sal-${i}" value="${sal}" min="0" style="height:36px;"/></div>
              <div class="field" style="margin:0;"><label style="font-size:10px;">Advance (₹)</label><input type="number" id="aep-adv-${i}" value="${adv}" min="0" style="height:36px;"/></div>
              <div class="field" style="margin:0;"><label style="font-size:10px;">Old Advance (₹)</label><input type="number" id="aep-oadv-${i}" value="${oldAdv}" min="0" style="height:36px;"/></div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button class="btn btn-primary" style="height:34px;font-size:12px;" onclick="aepSaveMonthEdit(${i})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><path d="M20 6L9 17l-5-5"/></svg>
                Save Changes
              </button>
              <button class="btn btn-ghost" style="height:34px;font-size:12px;" onclick="aepToggleEdit(${i})">Cancel</button>
            </div>
          </div>
          <div class="receipt-card-body" id="aep-body-${i}">
            <div class="receipt-grid">
              <div class="receipt-stat"><span class="receipt-stat-label">Monthly Salary</span><span class="receipt-stat-val">${inr(sal)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Advance</span><span class="receipt-stat-val red">${inr(adv)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Old Advance</span><span class="receipt-stat-val red">${inr(oldAdv)}</span></div>
            </div>
            <div class="receipt-net-bar">
              <div><div class="receipt-net-label">Net Payable</div><div class="receipt-net-words">${numberToWords(net)} Only</div></div>
              <div class="receipt-net-amount">${inr(net)}</div>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  } else {
    const records = [];
    Object.values(salaryHistory).forEach(wk => {
      wk.entries.forEach(e => { if (e.empId === aepEmpId) records.push({...e, weekStr: wk.weekStr}); });
    });
    employees.forEach(e => {
      if (e.empId === aepEmpId) {
        const wk = getWeekStr();
        if (!records.find(r => r.weekStr === wk && r.empId === aepEmpId)) records.push({...e, weekStr: wk, _isCurrent:true});
      }
    });
    records.sort((a,b) => b.weekStr.localeCompare(a.weekStr));
    window._aepRecords = records;

    if (statsEl) {
      const totalNet  = records.reduce((s,e) => s + calcNet(e), 0);
      const totalDays = records.reduce((s,e) => s + Number(e.days||0), 0);
      statsEl.innerHTML = `
        <div class="emp-stat-card"><div class="emp-stat-icon">📋</div><div class="emp-stat-label">Total Weeks</div><div class="emp-stat-val gold">${records.length}</div></div>
        <div class="emp-stat-card"><div class="emp-stat-icon">💰</div><div class="emp-stat-label">Total Earned</div><div class="emp-stat-val green">${inr(totalNet)}</div></div>
        <div class="emp-stat-card"><div class="emp-stat-icon">📅</div><div class="emp-stat-label">Days Worked</div><div class="emp-stat-val">${totalDays}</div></div>`;
    }

    if (!records.length) {
      emptyEl.style.display = 'block'; listEl.innerHTML = '';
    } else {
      emptyEl.style.display = 'none';
      listEl.innerHTML = records.map((e, i) => {
        const gross = Number(e.days)*Number(e.rate), net = calcNet(e), isCur = !!e._isCurrent;
        return `
        <div class="receipt-card" id="aep-card-${i}">
          <div class="receipt-card-header">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="receipt-week-label">📅 ${escHtml(e.weekStr)}</span>
              ${isCur?'<span style="background:rgba(212,168,67,.25);color:var(--gold);font-size:9px;font-weight:800;padding:2px 7px;border-radius:999px;">CURRENT</span>':''}
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="btn btn-edit" style="height:28px;font-size:11px;" onclick="aepToggleEdit(${i})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit
              </button>
              <button class="receipt-dl-btn" onclick="aepDownloadPdf(${i})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                PDF
              </button>
            </div>
          </div>
          <!-- Inline edit form -->
          <div class="hist-edit-form" id="aep-edit-${i}" style="display:none;">
            <div class="hist-edit-grid">
              <div class="field" style="margin:0;"><label style="font-size:10px;">Days Worked</label><input type="number" id="aep-days-${i}" value="${e.days}" min="0" step="0.5" style="height:36px;"/></div>
              <div class="field" style="margin:0;"><label style="font-size:10px;">Rate / Day (₹)</label><input type="number" id="aep-rate-${i}" value="${e.rate}" min="0" style="height:36px;"/></div>
              <div class="field" style="margin:0;"><label style="font-size:10px;">Advance (₹)</label><input type="number" id="aep-adv-${i}" value="${e.adv||0}" min="0" style="height:36px;"/></div>
              <div class="field" style="margin:0;"><label style="font-size:10px;">Old Advance (₹)</label><input type="number" id="aep-oadv-${i}" value="${e.oldAdv||0}" min="0" style="height:36px;"/></div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button class="btn btn-primary" style="height:34px;font-size:12px;" onclick="aepSaveWeekEdit(${i})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><path d="M20 6L9 17l-5-5"/></svg>
                Save Changes
              </button>
              <button class="btn btn-ghost" style="height:34px;font-size:12px;" onclick="aepToggleEdit(${i})">Cancel</button>
            </div>
          </div>
          <div class="receipt-card-body" id="aep-body-${i}">
            <div class="receipt-grid">
              <div class="receipt-stat"><span class="receipt-stat-label">Days Worked</span><span class="receipt-stat-val">${e.days} <span style="font-size:10px;font-weight:500;color:var(--muted);">days</span></span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Rate / Day</span><span class="receipt-stat-val">${inr(e.rate)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Gross Salary</span><span class="receipt-stat-val">${inr(gross)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Advance (Week)</span><span class="receipt-stat-val red">${inr(e.adv||0)}</span></div>
              <div class="receipt-stat"><span class="receipt-stat-label">Old Advance</span><span class="receipt-stat-val red">${inr(e.oldAdv||0)}</span></div>
            </div>
            <div class="receipt-net-bar">
              <div><div class="receipt-net-label">Net Payable</div><div class="receipt-net-words">${numberToWords(net)} Only</div></div>
              <div class="receipt-net-amount">${inr(net)}</div>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // Advance ledger
  const advListEl  = document.getElementById('aep-advance-list');
  const advEmptyEl = document.getElementById('aep-advance-empty');
  const ledger = (advances[aepEmpId] || []).slice().sort((a,b) => b.date.localeCompare(a.date));
  if (!ledger.length) {
    advEmptyEl.style.display = 'block';
    advListEl.innerHTML = '';
  } else {
    advEmptyEl.style.display = 'none';
    const totalGiven    = ledger.reduce((s,a) => s + Number(a.amount||0), 0);
    const totalDeducted = ledger.reduce((s,a) => s + Number(a.deducted||0), 0);
    const outstanding   = Math.max(0, totalGiven - totalDeducted);
    advListEl.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:var(--navy);color:#fff;">
            <th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;">Date</th>
            <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;">Given</th>
            <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;">Deducted</th>
            <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;">Balance</th>
            <th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;">Note</th>
            <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;">Actions</th>
          </tr></thead>
          <tbody>
            ${ledger.map(a => {
              const bal = Math.max(0, Number(a.amount)-Number(a.deducted||0));
              return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:9px 12px;font-weight:600;">${escHtml(a.date)}</td>
                <td style="padding:9px 12px;text-align:right;color:var(--accent);font-weight:700;">${inr(a.amount)}</td>
                <td style="padding:9px 12px;text-align:right;color:var(--green);font-weight:700;">${inr(a.deducted||0)}</td>
                <td style="padding:9px 12px;text-align:right;font-weight:800;color:${bal>0?'var(--accent)':'var(--green)'};">${inr(bal)}</td>
                <td style="padding:9px 12px;color:var(--muted);font-size:12px;">${escHtml(a.note||'—')}</td>
                <td style="padding:9px 12px;text-align:right;">
                  <button class="edit-btn" onclick="openAddAdvanceModal('${escHtml(aepEmpId)}','${escHtml(a.id)}')">✎</button>
                  <button class="del-btn" onclick="deleteAdvance('${escHtml(aepEmpId)}','${escHtml(a.id)}');renderAdminEmpPreview();">✕</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot><tr style="background:var(--offwhite);font-weight:800;border-top:2px solid var(--border);">
            <td style="padding:9px 12px;">Total</td>
            <td style="padding:9px 12px;text-align:right;color:var(--accent);">${inr(totalGiven)}</td>
            <td style="padding:9px 12px;text-align:right;color:var(--green);">${inr(totalDeducted)}</td>
            <td style="padding:9px 12px;text-align:right;color:${outstanding>0?'var(--accent)':'var(--green)'};">${inr(outstanding)}</td>
            <td colspan="2"></td>
          </tr></tfoot>
        </table>
      </div>`;
  }

  currentEmpId = prevCurrent;
}

/* ── Admin Employee Preview — section accordion toggle ───── */
function aepToggleSection(sec) {
  const body = document.getElementById('aep-'+sec+'-body');
  const chev = document.getElementById('aep-'+sec+'-chev');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (chev) chev.style.transform = open ? 'rotate(-90deg)' : '';
}

/* ── Salary History — download PDF for current view ─────── */
function dlHistoryPdf() {
  const entries = window._historyCurrentEntries;
  const weekStr = window._historyCurrentWeekStr;
  if (!entries || !entries.length) { showToast('No records to download.'); return; }
  if (historyType === 'monthly') {
    // Build the sheet for the SELECTED month, not whatever month the Monthly
    // Salary page happens to be on — and only for employees shown in this view.
    const prevM = msMonth, prevY = msYear;
    msMonth = entries[0].mm - 1;
    msYear  = entries[0].yr;
    const emps = entries.map(e => employeeMaster[e.empId]).filter(Boolean);
    buildMonthlyOverallPdf(emps);
    msMonth = prevM; msYear = prevY;
  } else {
    buildOverallPdfFromEntries(entries, weekStr);
  }
}

/* ── Forgot Password — step navigation ─────────────────── */
function showForgotStep(step) {
  const s1 = document.getElementById('forgot-step1');
  const s2 = document.getElementById('forgot-step2');
  if (s1) s1.style.display = step === 1 ? 'block' : 'none';
  if (s2) s2.style.display = step === 2 ? 'block' : 'none';
}

function aepGoSalary() {
  const m = employeeMaster[aepEmpId];
  if (!m) return;
  closeAdminEmpPreviewModal();
  if (m.salaryType === 'monthly') {
    switchSalaryMode('monthly');
    msPick(aepEmpId);
    document.getElementById('monthly-salary-section')?.scrollIntoView({behavior:'smooth', block:'start'});
  } else {
    switchSalaryMode('weekly');
    wsPick(aepEmpId);
    document.getElementById('weekly-salary-section')?.scrollIntoView({behavior:'smooth', block:'start'});
  }
}

function aepToggleEdit(i) {
  const body = document.getElementById('aep-body-'+i);
  const form = document.getElementById('aep-edit-'+i);
  if (!body || !form) return;
  const isOpen = form.style.display !== 'none';
  body.style.display = isOpen ? '' : 'none';
  form.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) form.querySelector('input')?.focus();
}

function aepDownloadPdf(i) {
  const records = window._aepRecords;
  if (!records || !records[i]) return;
  const m = employeeMaster[aepEmpId];
  if (!m) return;
  if (m.salaryType === 'monthly') {
    const r = records[i];
    const prev = msSelEmp, prevMonth = msMonth, prevYear = msYear;
    msSelEmp = aepEmpId; msMonth = r.mm - 1; msYear = r.yr;
    buildMonthlySalPdf();
    msSelEmp = prev; msMonth = prevMonth; msYear = prevYear;
  } else {
    buildIndividualPdf(records[i], records[i].weekStr);
  }
}

function aepSaveWeekEdit(i) {
  const records = window._aepRecords;
  if (!records || !records[i]) return;
  const days   = parseFloat(document.getElementById('aep-days-'+i)?.value) || 0;
  const rate   = parseFloat(document.getElementById('aep-rate-'+i)?.value) || 0;
  const adv    = parseFloat(document.getElementById('aep-adv-'+i)?.value)  || 0;
  const oldAdv = parseFloat(document.getElementById('aep-oadv-'+i)?.value) || 0;

  const r = records[i];
  // Update current week employees[] or salaryHistory
  if (r._isCurrent) {
    const idx = employees.findIndex(e => e.empId === aepEmpId);
    if (idx >= 0) { employees[idx].days=days; employees[idx].rate=rate; employees[idx].adv=adv; employees[idx].oldAdv=oldAdv; }
    renderTable();
  } else {
    const wKey = Object.keys(salaryHistory).find(k => salaryHistory[k].weekStr === r.weekStr);
    if (wKey) {
      const hIdx = salaryHistory[wKey].entries.findIndex(e => e.empId === aepEmpId);
      if (hIdx >= 0) { salaryHistory[wKey].entries[hIdx].days=days; salaryHistory[wKey].entries[hIdx].rate=rate; salaryHistory[wKey].entries[hIdx].adv=adv; salaryHistory[wKey].entries[hIdx].oldAdv=oldAdv; }
      saveHistory();
    }
  }
  showToast('✅ Salary updated — employee view reflects the change.');
  renderAdminEmpPreview();
}

function aepSaveMonthEdit(i) {
  const records = window._aepRecords;
  if (!records || !records[i]) return;
  const r      = records[i];
  const sal    = parseFloat(document.getElementById('aep-sal-'+i)?.value)  || 0;
  const adv    = parseFloat(document.getElementById('aep-adv-'+i)?.value)  || 0;
  const oldAdv = parseFloat(document.getElementById('aep-oadv-'+i)?.value) || 0;
  const netAmt = Math.max(0, sal - adv - oldAdv);

  const key = r.key; // "empId::YYYY-MM"
  if (!monthlySal[key]) monthlySal[key] = {};
  monthlySal[key].salMonth = sal;
  monthlySal[key].advance  = adv;
  monthlySal[key].oldAdv   = oldAdv;
  monthlySal[key].netAmt   = netAmt;
  monthlySal[key].savedAt  = new Date().toISOString();
  saveMonthlySal();
  renderMonthlySalSheet();
  showToast('✅ Monthly salary updated — employee view reflects the change.');
  renderAdminEmpPreview();
}

function aepEditProfile() {
  if (!aepEmpId) return;
  closeAdminEmpPreviewModal();
  openMasterModal();
  setTimeout(() => startMasterEdit(aepEmpId), 150);
}

function aepOpenSalary() {
  if (!aepEmpId) return;
  const m = employeeMaster[aepEmpId];
  if (!m) return;
  closeAdminEmpPreviewModal();
  if (m.salaryType === 'monthly') {
    switchSalaryMode('monthly');
    msPick(aepEmpId);
  } else {
    switchSalaryMode('weekly');
    wsPick(aepEmpId);
  }
  document.getElementById(m.salaryType === 'monthly' ? 'ms-calc-card' : 'ws-form-card')?.scrollIntoView({behavior:'smooth', block:'start'});
}

function aepOpenAttendance() {
  if (!aepEmpId) return;
  closeAdminEmpPreviewModal();
  openAttendanceModal('admin');
  setTimeout(() => {
    const sel = document.getElementById('att-emp-filter');
    if (sel) { sel.value = aepEmpId; renderAttendanceCalendar(); }
  }, 150);
}

function aepOpenAdvance() {
  if (!aepEmpId) return;
  openAddAdvanceModal(aepEmpId);
}

function aepEditWeekRecord(i) {
  if (!window._aepRecords || !window._aepRecords[i]) return;
  const r = window._aepRecords[i];
  closeAdminEmpPreviewModal();
  switchSalaryMode('weekly');
  wsPick(r.empId);
  setTimeout(() => {
    const idx = employees.findIndex(e => e.empId === r.empId);
    if (idx >= 0) editEntry(idx);
  }, 150);
}

function aepEditMonthRecord(i) {
  if (!window._aepRecords || !window._aepRecords[i]) return;
  const r = window._aepRecords[i];
  closeAdminEmpPreviewModal();
  switchSalaryMode('monthly');
  msMonth = r.mm - 1;
  msYear  = r.yr;
  msPick(r.key.split('::')[0]);
}
function closeMasterModal(){cancelMasterEdit();document.getElementById('master-modal').classList.remove('open');if(!document.querySelector('.modal-overlay.open'))document.body.style.overflow='';}
function closeMasterOutside(e){if(e.target===document.getElementById('master-modal'))closeMasterModal();}
function renderMasterList(){
  const list=Object.values(employeeMaster);
  const empty=document.getElementById('master-empty');
  const table=document.getElementById('master-table');
  const tbody=document.getElementById('master-tbody');
  const label=document.getElementById('master-count-label');
  label.textContent=list.length?list.length+' saved employee'+(list.length>1?'s':''):'';
  if(!list.length){empty.style.display='block';table.style.display='none';return;}
  empty.style.display='none';table.style.display='table';
  tbody.innerHTML=list.map(m=>{
    const photo    = empPhotos[m.empId];
    const initials = (m.name||m.empId||'?').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const thumb    = photo
      ? `<span class="master-photo-thumb" style="background-image:url(${photo})"></span>`
      : `<span class="master-initials-thumb">${initials}</span>`;
    return `<tr id="master-row-${escHtml(m.empId)}"${m.inactive?' class="row-inactive"':''}>
    <td><span class="emp-badge">${escHtml(m.empId)}</span></td>
    <td style="font-weight:600;display:flex;align-items:center;gap:7px;">${thumb}<span>${escHtml(m.name)}</span></td>
    <td class="dob-badge">${m.dob ? formatDob(m.dob) : '—'}</td>
    <td>${m.phone?'+91 '+escHtml(m.phone):'—'}</td>
    <td style="font-weight:600;color:var(--green)">₹${Number(m.rate).toLocaleString('en-IN')}/day</td>
    <td>${m.inactive?'<span class="inactive-badge">Left</span>':'<span style="color:var(--green);font-weight:700;font-size:11px;">Active</span>'}</td>
    <td><div class="row-actions">
      <button class="btn btn-edit" onclick="startMasterEdit('${escHtml(m.empId)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>
      <button class="btn btn-view-as" onclick="openAdminEmpPreview('${escHtml(m.empId)}')" title="View &amp; modify this employee's salary and attendance"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View</button>
      <button class="btn-inactive-toggle${m.inactive?' active':''}" onclick="toggleInactive('${escHtml(m.empId)}')">${m.inactive?'✅ Rejoin':'🚪 Left'}</button>
      <button class="del-btn master-del-btn" onclick="deleteMasterEntry('${escHtml(m.empId)}')">✕</button>
    </div></td>
  </tr>`;
  }).join('');
}
function startMasterEdit(empId){
  const m=employeeMaster[empId];if(!m)return;
  showConfirm({type:'edit',empId,empName:m.name,onYes:()=>doStartMasterEdit(empId)});
}
function doStartMasterEdit(empId){
  const m=employeeMaster[empId];if(!m)return;
  masterEditId=empId;
  document.getElementById('me-id').value   =m.empId;
  document.getElementById('me-name').value =m.name;
  document.getElementById('me-dob').value  =m.dob||'';
  const joiningEl = document.getElementById('me-joining');
  if (joiningEl) joiningEl.value = m.joiningDate||'';
  document.getElementById('me-phone').value=(m.phone||'').replace(/\D/g,'');
  document.getElementById('me-addr').value =m.addr||'';
  document.getElementById('me-rate').value =m.rate||'';
  const shiftsEl = document.getElementById('me-shifts');
  if (shiftsEl) shiftsEl.value = String(m.shiftsPerDay||2);
  // Set salary type dropdown
  selectSalType(m.salaryType || 'weekly', true);
  document.getElementById('master-edit-id-label').textContent=m.empId+' · '+m.name;
  document.getElementById('master-edit-form').style.display='block';
  const row=document.getElementById('master-row-'+empId);if(row)row.classList.add('row-editing');
  renderPhotoPicker('me-photo-wrap','me-photo-preview',empId);
  document.getElementById('master-edit-form').scrollIntoView({behavior:'smooth',block:'nearest'});
  document.getElementById('me-name').focus();
}
function cancelMasterEdit(){
  if(masterEditId){const row=document.getElementById('master-row-'+masterEditId);if(row)row.classList.remove('row-editing');}
  masterEditId=null;document.getElementById('master-edit-form').style.display='none';
  // Close dropdown if open
  const menu=document.getElementById('me-sal-type-menu');
  if(menu) menu.style.display='none';
}

/* ── Salary Type Dropdown (Manage Employees edit form) ── */
function toggleSalTypeDropdown() {
  const menu = document.getElementById('me-sal-type-menu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  const chevron = document.getElementById('me-sal-chevron');
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
}

function selectSalType(type, silent) {
  const hidden = document.getElementById('me-sal-type');
  const label  = document.getElementById('me-sal-type-label');
  const menu   = document.getElementById('me-sal-type-menu');
  const checkW = document.getElementById('sal-check-weekly');
  const checkM = document.getElementById('sal-check-monthly');
  const chevron = document.getElementById('me-sal-chevron');

  if (!hidden) return;
  hidden.value = type;

  const isMonthly = type === 'monthly';
  const svgW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="12" y2="18"/></svg>`;
  const svgM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>`;

  if (label) label.innerHTML = isMonthly
    ? `${svgM} <span style="color:#1565c0;font-weight:700;">Monthly Salary</span>`
    : `${svgW} <span style="color:#2e7d32;font-weight:700;">Weekly Salary</span>`;

  if (checkW) checkW.style.display = isMonthly ? 'none' : '';
  if (checkM) checkM.style.display = isMonthly ? '' : 'none';

  const btn = document.getElementById('me-sal-type-btn');
  if (btn) {
    btn.style.borderColor = isMonthly ? '#90caf9' : '#a5d6a7';
    btn.style.background  = isMonthly ? '#e3f2fd' : '#e8f5e9';
  }

  // Update the rate field label in edit modal
  const meRateLbl = document.getElementById('me-rate-label');
  if (meRateLbl) meRateLbl.textContent = isMonthly ? 'Salary / Month (₹)' : 'Salary / Day (₹)';

  if (!silent && menu) {
    menu.style.display = 'none';
    if (chevron) chevron.style.transform = '';
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const wrap = document.querySelector('.sal-type-dropdown-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const menu = document.getElementById('me-sal-type-menu');
    const chevron = document.getElementById('me-sal-chevron');
    if (menu) menu.style.display = 'none';
    if (chevron) chevron.style.transform = '';
  }
});
function saveMasterEdit(){
  if(!masterEditId)return;
  const name  = document.getElementById('me-name').value.trim().toUpperCase().replace(EMP_NAME_ALLOWED,'');
  const dob   = document.getElementById('me-dob').value.trim();
  const joiningDate = (document.getElementById('me-joining')?.value||'').trim();
  const phone = document.getElementById('me-phone').value.replace(/\D/g,'');
  const addr  = document.getElementById('me-addr').value.trim();
  const rate  = parseFloat(document.getElementById('me-rate').value)||0;
  const shiftsPerDay = parseInt(document.getElementById('me-shifts')?.value||'2')||2;
  const salaryType   = document.getElementById('me-sal-type')?.value || 'weekly';
  if(!name){showMsg('Name Required','Employee Name is required.','warn','me-name');return;}
  if(!rate){showMsg('Salary Rate Required','Salary per Day is required.','warn','me-rate');return;}
  if(phone&&phone.length!==10){showMsg('Invalid Phone','Phone number must be exactly <strong>10 digits</strong> after +91.','warn','me-phone');return;}
  employeeMaster[masterEditId]={...employeeMaster[masterEditId],name,dob,joiningDate,phone,addr,rate,shiftsPerDay,salaryType};
  saveMaster();
  commitPhoto('me-photo-wrap', masterEditId);
  employees.forEach((e,i)=>{if(e.empId===masterEditId)employees[i]={...e,name,phone,addr,rate};});
  persistWeekToHistory();
  renderTable();
  renderMasterList();
  const savedName=name; const savedId=masterEditId;
  cancelMasterEdit();
  showTimedSuccess(savedName, savedId);
}
function showSuccessBox(name){showMsg('Updated',escHtml(name)+' updated successfully.','success');}
function closeSuccessBox(){}

/* ── Timed success popup (5 sec auto-dismiss with countdown) ── */
function showTimedSuccess(empName, empId) {
  // Remove any existing
  const ex = document.getElementById('timed-success-overlay');
  if (ex) { ex.remove(); clearTimeout(ex._timer); clearInterval(ex._interval); }

  const overlay = document.createElement('div');
  overlay.id = 'timed-success-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;
    background:rgba(8,16,34,.45);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
    animation:tsOverlayIn .2s ease;padding:20px;
  `;

  overlay.innerHTML = `
    <div id="timed-success-box" style="
      background:#fff;border-radius:20px;
      box-shadow:0 24px 80px rgba(8,16,34,.35);
      width:100%;max-width:360px;overflow:hidden;
      animation:tsBoxIn .25s cubic-bezier(.34,1.56,.64,1);
      text-align:center;
    ">
      <!-- Green header strip -->
      <div style="background:linear-gradient(135deg,#1a6b3a,#2e7d32);padding:28px 24px 20px;position:relative;">
        <div style="font-size:52px;line-height:1;margin-bottom:10px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.2));">🎉</div>
        <div style="font-size:18px;font-weight:900;color:#fff;letter-spacing:-.3px;">Updated Successfully!</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:3px;">Employee details saved</div>
      </div>
      <!-- Employee info -->
      <div style="padding:20px 24px 0;">
        <div style="font-size:20px;font-weight:800;color:var(--navy);margin-bottom:4px;">${escHtml(empName)}</div>
        <div style="display:inline-block;background:var(--navy);color:#fff;font-size:10px;font-weight:700;
          padding:2px 12px;border-radius:999px;letter-spacing:.5px;margin-bottom:14px;">${escHtml(empId)}</div>
        <div style="font-size:13px;color:var(--green);font-weight:600;margin-bottom:16px;">
          ✅ All changes have been saved successfully.
        </div>
      </div>
      <!-- Progress bar -->
      <div style="padding:0 24px 8px;">
        <div style="height:4px;background:#e8e8e8;border-radius:999px;overflow:hidden;margin-bottom:6px;">
          <div id="ts-progress-bar" style="height:100%;width:100%;background:var(--green);border-radius:999px;transition:width .1s linear;"></div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:16px;">
          Closing in <span id="ts-countdown">5</span> second<span id="ts-plural">s</span>…
        </div>
      </div>
      <!-- OK button -->
      <div style="padding:0 24px 22px;">
        <button onclick="closeTimedSuccess()" style="
          width:100%;height:44px;background:var(--navy);color:#fff;border:none;
          border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;
          font-family:var(--font-body);transition:background .15s;
        " onmouseover="this.style.background='#1a3060'" onmouseout="this.style.background='var(--navy)'">
          OK
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Click outside to close
  overlay.addEventListener('click', e => { if (e.target === overlay) closeTimedSuccess(); });

  // Countdown
  let remaining = 5;
  const bar      = document.getElementById('ts-progress-bar');
  const countEl  = document.getElementById('ts-countdown');
  const pluralEl = document.getElementById('ts-plural');

  overlay._interval = setInterval(() => {
    remaining -= 0.1;
    const pct = Math.max(0, (remaining / 5) * 100);
    if (bar) bar.style.width = pct + '%';
    const secs = Math.ceil(remaining);
    if (countEl) countEl.textContent = secs;
    if (pluralEl) pluralEl.textContent = secs === 1 ? '' : 's';
    if (remaining <= 0) closeTimedSuccess();
  }, 100);

  overlay._timer = setTimeout(closeTimedSuccess, 5200);
}

function closeTimedSuccess() {
  const overlay = document.getElementById('timed-success-overlay');
  if (!overlay) return;
  clearTimeout(overlay._timer);
  clearInterval(overlay._interval);
  overlay.style.animation = 'tsOverlayOut .18s ease forwards';
  setTimeout(() => {
    overlay.remove();
    if (!document.querySelector('.modal-overlay.open, .confirm-overlay.open'))
      document.body.style.overflow = '';
  }, 180);
}
function deleteMasterEntry(empId){
  const m=employeeMaster[empId];if(!m)return;
  showConfirm({type:'delete',empId,empName:m.name,onYes:()=>{
    delete employeeMaster[empId];saveMaster();
    if(masterEditId===empId)cancelMasterEdit();
    renderMasterList();showToast(`🗑️ ${m.name} removed.`);
  }});
}
function toggleInactive(empId){
  const m=employeeMaster[empId];if(!m)return;
  const nowInactive=!m.inactive;
  showConfirm({type:nowInactive?'left':'edit',empId,empName:m.name,onYes:()=>{
    employeeMaster[empId]={...m,inactive:nowInactive};saveMaster();renderMasterList();
    showToast(nowInactive?`🚪 ${m.name} marked as Left.`:`✅ ${m.name} is Active again.`);
  }});
}

/* ═══════════════════════════════════════════════════════════
   NEW EMPLOYEE MODAL
════════════════════════════════════════════════════════════ */
function openNewEmpModal(){clearNewEmpForm();document.getElementById('new-emp-modal').classList.add('open');document.body.style.overflow='hidden';setTimeout(()=>document.getElementById('ne-id').focus(),100);}
function closeNewEmpModal(){document.getElementById('new-emp-modal').classList.remove('open');if(!document.querySelector('.modal-overlay.open'))document.body.style.overflow='';}
function closeNewEmpOutside(e){if(e.target===document.getElementById('new-emp-modal'))closeNewEmpModal();}
function clearNewEmpForm(){
  ['ne-id','ne-name','ne-phone','ne-addr','ne-rate','ne-dob','ne-joining'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const preview=document.getElementById('ne-photo-preview');
  if(preview){preview.style.backgroundImage='';preview.classList.remove('has-photo');}
  const wrap=document.getElementById('ne-photo-wrap');
  if(wrap){wrap._pendingPhoto=null;}
  const label=document.getElementById('ne-photo-wrap-label');
  if(label)label.textContent='Upload Photo';
  const inp=document.getElementById('ne-photo-input');
  if(inp)inp.value='';
  // Reset salary type to weekly
  const weeklyRadio = document.getElementById('ne-sal-weekly');
  if (weeklyRadio) { weeklyRadio.checked = true; onNeSalTypeChange(); }
}

function onNeSalTypeChange() {
  const val = document.querySelector('input[name="ne-sal-type"]:checked')?.value || 'weekly';
  const wLbl = document.getElementById('ne-sal-weekly-lbl');
  const mLbl = document.getElementById('ne-sal-monthly-lbl');
  if (wLbl) wLbl.classList.toggle('sal-type-active', val==='weekly');
  if (mLbl) mLbl.classList.toggle('sal-type-active', val==='monthly');
  // Swap rate label based on salary type
  const rateLbl = document.getElementById('ne-rate-label');
  if (rateLbl) rateLbl.textContent = (val === 'monthly') ? 'Salary / Month (₹)' : 'Salary / Day (₹)';
}
function saveNewEmployee(){
  const get=id=>document.getElementById(id).value.trim();
  let empId=get('ne-id'); let name=get('ne-name');
  const dob  =get('ne-dob');
  const joiningDate = get('ne-joining');
  const phone=get('ne-phone').replace(/\D/g,'');
  const addr=get('ne-addr'); const rate=parseFloat(get('ne-rate'))||0;
  const shiftsPerDay=parseInt(document.getElementById('ne-shifts')?.value||'2')||2;
  const salaryType = document.querySelector('input[name="ne-sal-type"]:checked')?.value || 'weekly';
  if(!empId){showMsg('Employee ID Required','Please enter an <strong>Employee ID</strong>.','warn','ne-id');return;}
  // Normalize in case of paste/autofill that bypassed the live sanitizer
  empId = empId.toUpperCase().replace(EMP_ID_ALLOWED, '');
  if(!empId){showMsg('Invalid Employee ID','Employee ID can only contain <strong>A–Z</strong>, <strong>0–9</strong>, and <strong>_ - . / #</strong>.','warn','ne-id');return;}
  document.getElementById('ne-id').value = empId;
  if(!name) {showMsg('Employee Name Required','Please enter the <strong>Employee Name</strong>.','warn','ne-name');return;}
  name = name.toUpperCase().replace(EMP_NAME_ALLOWED, '');
  document.getElementById('ne-name').value = name;
  if(!name) {showMsg('Invalid Employee Name','Employee Name can only contain letters and spaces.','warn','ne-name');return;}
  const rateLabel = salaryType === 'monthly' ? 'Salary Per Month' : 'Salary Per Day';
  if(!rate) {showMsg('Salary Rate Required','Please enter the <strong>'+rateLabel+'</strong>.','warn','ne-rate');return;}
  if(employeeMaster[empId]){showMsg('Duplicate Employee ID','Employee ID <strong>'+escHtml(empId)+'</strong> is already assigned to <strong>'+escHtml(employeeMaster[empId].name)+'</strong>.<br>Please use a unique Employee ID.','block','ne-id');return;}
  if(phone&&phone.length!==10){showMsg('Invalid Phone Number','Phone number must be exactly <strong>10 digits</strong> after +91.','warn','ne-phone');return;}
  upsertMaster({empId, name, dob, joiningDate, phone, addr, rate, shiftsPerDay, salaryType});
  commitPhoto('ne-photo-wrap', empId);
  closeNewEmpModal();
  showToast(`✅ ${name} added to employee list.`);
  renderEmpProfileGrid();
  renderSettingsEmpList();
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS MODAL
════════════════════════════════════════════════════════════ */
function openSettingsModal(){renderSettingsEmpList();document.getElementById('settings-modal').classList.add('open');document.body.style.overflow='hidden';}
function closeSettingsModal(){document.getElementById('settings-modal').classList.remove('open');if(!document.querySelector('.modal-overlay.open'))document.body.style.overflow='';}
function closeSettingsOutside(e){if(e.target===document.getElementById('settings-modal'))closeSettingsModal();}

async function saveAdminPassword(){
  const np=document.getElementById('s-newpass').value;
  const cp=document.getElementById('s-confpass').value;
  if(!np){showMsg('Password Required','Please enter a new password.','warn');return;}
  if(np!==cp){showMsg('Passwords Do Not Match','New password and confirm password do not match.','warn');return;}
  if(np.length<4){showMsg('Too Short','Password must be at least 4 characters.','warn');return;}
  appSettings.adminPass=await hashPass(np);
  saveSettings();
  document.getElementById('s-newpass').value='';
  document.getElementById('s-confpass').value='';
  showMsg('Password Updated','Admin password has been updated successfully.','success');
}

function renderSettingsEmpList(){
  const list = Object.values(employeeMaster).sort((a,b)=>a.empId.localeCompare(b.empId));
  const el   = document.getElementById('settings-emp-list');
  if (!list.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:16px;text-align:center;background:var(--offwhite);border-radius:10px;">No employees added yet.<br>Add employees first using the <strong>New Employee</strong> button.</div>';
    return;
  }
  el.innerHTML = list.map(m => {
    const hasPass  = !!appSettings.empPasswords[m.empId];
    const photo    = empPhotos[m.empId];
    const initials = (m.name||'').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase()||'?';
    const avatarH  = photo
      ? `<div class="sp-avatar" style="background-image:url(${photo});background-size:cover;background-position:center;"></div>`
      : `<div class="sp-avatar sp-avatar-init">${initials}</div>`;
    return `
    <div class="sp-card${m.inactive?' sp-card-inactive':''}">
      <div class="sp-card-left">
        ${avatarH}
        <div class="sp-info">
          <div class="sp-name">${escHtml(m.name)}</div>
          <div class="sp-meta">
            <span class="sp-id-badge">${escHtml(m.empId)}</span>
            ${hasPass
              ? '<span class="sp-status-set">🔒 Password Set</span>'
              : '<span class="sp-status-unset">⚠ No Password</span>'}
            ${m.inactive ? '<span class="sp-inactive-tag">Left</span>' : ''}
          </div>
        </div>
      </div>
      <div class="sp-pass-section">
        <div class="sp-pass-wrap">
          <div class="pass-input-wrap" style="flex:1;">
            <input type="password" class="spass-input sp-pass-input" data-empid="${escHtml(m.empId)}"
                   placeholder="${hasPass ? '••••• Change password' : 'Set new password'}"
                   autocomplete="new-password" maxlength="32"
                   onkeydown="if(event.key==='Enter')saveEmpPasswordFromInput(this)" />
            <button type="button" class="pass-eye-lg" onclick="togglePassVis(null,this,this.previousElementSibling)" tabindex="-1" style="width:38px;">
              <svg class="eye-icon-show" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg class="eye-icon-hide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="display:none;"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
          </div>
          <button class="btn btn-primary sp-save-btn" onclick="saveEmpPasswordFromInput(this.closest('.sp-pass-section').querySelector('.spass-input'))">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><path d="M20 6L9 17l-5-5"/></svg>
            Save
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function saveEmpPasswordFromInput(inp) {
  if (!inp) return;
  const empId = inp.getAttribute('data-empid');
  if (!empId) return;
  const pass = inp.value.trim();
  if (!pass) { showMsg('Password Required', 'Please enter a password for this employee.', 'warn'); inp.focus(); return; }
  if (pass.length < 4) { showMsg('Too Short', 'Password must be at least 4 characters.', 'warn'); inp.focus(); return; }
  const hashed = await hashPass(pass);
  appSettings.empPasswords[empId] = hashed;
  saveSettings();
  inp.value = '';
  inp.placeholder = 'Password updated ✓';
  const row = inp.closest('.settings-emp-row');
  if (row) {
    const statusEl = row.querySelector('span[style*="color"]');
    if (statusEl) { statusEl.textContent = '✓ Set'; statusEl.style.color = 'var(--green)'; }
  }
  showToast(`✅ Password set for ${employeeMaster[empId]?.name || empId}`);
}

// Keep old function as alias for any existing callers
async function saveEmpPassword(empId) {
  const inp = document.querySelector(`.spass-input[data-empid="${CSS.escape(empId)}"]`);
  if (inp) await saveEmpPasswordFromInput(inp);
}

/* ═══════════════════════════════════════════════════════════
   FORGOT PASSWORD MODAL
════════════════════════════════════════════════════════════ */
function openForgotModal() {
  const role = loginRole;
  document.getElementById('forgot-admin-section').style.display = role === 'admin'    ? '' : 'none';
  document.getElementById('forgot-emp-section').style.display   = role === 'employee' ? '' : 'none';
  document.getElementById('forgot-emp-check-btn').style.display = role === 'employee' ? '' : 'none';
  const statusEl = document.getElementById('forgot-emp-status');
  if (statusEl) { statusEl.style.display = 'none'; statusEl.innerHTML = ''; }
  const empidEl = document.getElementById('forgot-empid');
  if (empidEl) empidEl.value = '';
  document.getElementById('forgot-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeForgotModal() {
  document.getElementById('forgot-modal').classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}
function closeForgotOutside(e) {
  if (e.target === document.getElementById('forgot-modal')) closeForgotModal();
}
function checkForgotEmpId() {
  const empId = (document.getElementById('forgot-empid').value || '').trim().toUpperCase();
  const statusEl = document.getElementById('forgot-emp-status');
  statusEl.style.display = 'block';
  if (!empId) { statusEl.innerHTML = '<div class="forgot-info-box" style="background:#fff0f3;border-color:rgba(229,0,58,.2);"><div style="font-size:12px;color:var(--accent);">Please enter your Employee ID.</div></div>'; return; }
  const m = employeeMaster[empId] || Object.values(employeeMaster).find(x => x.empId.toUpperCase() === empId);
  if (!m) {
    statusEl.innerHTML = '<div class="forgot-info-box" style="background:#fff0f3;border-color:rgba(229,0,58,.2);"><div style="font-size:12px;color:var(--accent);">Employee ID <strong>' + escHtml(empId) + '</strong> not found. Please check with your admin.</div></div>';
    return;
  }
  const hasPass = !!appSettings.empPasswords[m.empId];
  statusEl.innerHTML = `<div class="forgot-info-box" style="background:#eef6ff;border-color:#c5d0ef;">
    <div style="font-size:12px;color:var(--navy-2);line-height:1.6;">
      <strong>${escHtml(m.name)}</strong> (${escHtml(m.empId)})<br>
      ${hasPass
        ? 'A password is set for your account. Please contact your <strong>Admin</strong> or Manager to reset it — they can set a new password in <em>Settings → Employee Passwords</em>.'
        : 'No password has been set yet. Please ask your <strong>Admin</strong> to set a password for you in <em>Settings → Employee Passwords</em>.'}
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   CUSTOM CONFIRM DIALOG
════════════════════════════════════════════════════════════ */
function showConfirm({type,empId,empName,onYes}){
  const existing=document.getElementById('confirm-overlay');if(existing)existing.remove();
  const overlay=document.createElement('div');overlay.className='confirm-overlay open';overlay.id='confirm-overlay';
  const isDelete=type==='delete';
  const isLeft=type==='left';
  const icon = isDelete?'🗑️':isLeft?'🚪':'✏️';
  const iconCls = isDelete?'icon-delete':isLeft?'icon-delete':'icon-edit';
  const title = isDelete?'Confirm?':isLeft?'Mark as Left?':'Edit Employee?';
  const msg = isDelete
    ? `Remove <span class="confirm-emp-name">${escHtml(empName)}</span> from saved employees?<br><span class="confirm-emp-id">${escHtml(empId)}</span>`
    : isLeft
      ? `Mark <span class="confirm-emp-name">${escHtml(empName)}</span> as left?<br><span class="confirm-emp-id">${escHtml(empId)}</span><br><span style="font-size:11px;color:var(--muted);">Their records stay saved — you can mark them Active again anytime.</span>`
      : empId?`Edit details of <span class="confirm-emp-name">${escHtml(empName)}</span>?<br><span class="confirm-emp-id">${escHtml(empId)}</span>`:'';
  const yesCls = isDelete?'btn-confirm-yes-delete':isLeft?'btn-confirm-yes-delete':'btn-confirm-yes-edit';
  const yesLabel = isDelete?'Yes, Delete':isLeft?'Yes, Left':'Yes, Proceed';
  overlay.innerHTML=`<div class="confirm-box"><div class="confirm-icon-wrap"><div class="confirm-icon ${iconCls}">${icon}</div></div><div class="confirm-body"><div class="confirm-title">${title}</div><div class="confirm-msg">${msg}</div></div><div class="confirm-footer"><button class="btn btn-confirm-no" id="confirm-no-btn">Cancel</button><button class="btn ${yesCls}" id="confirm-yes-btn">${yesLabel}</button></div></div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow='hidden';
  document.getElementById('confirm-no-btn').addEventListener('click',closeConfirm);
  document.getElementById('confirm-yes-btn').addEventListener('click',()=>{closeConfirm();onYes();});
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeConfirm();});
  function onEsc(e){if(e.key==='Escape'){closeConfirm();document.removeEventListener('keydown',onEsc);}}
  document.addEventListener('keydown',onEsc);
}
function closeConfirm(){const o=document.getElementById('confirm-overlay');if(o)o.remove();if(!document.querySelector('.modal-overlay.open'))document.body.style.overflow='';}

/* ═══════════════════════════════════════════════════════════
   HELPER — formatDob
════════════════════════════════════════════════════════════ */
function formatDob(dob) {
  if (!dob) return '—';
  try {
    const d = new Date(dob + 'T00:00:00');
    return d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
  } catch(e) { return dob; }
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS TABS
════════════════════════════════════════════════════════════ */
function switchSettingsTab(tab) {
  ['admin','emp','email'].forEach(t => {
    document.getElementById('stab-'+t).classList.toggle('active', t===tab);
    document.getElementById('stab-'+t+'-content').style.display = t===tab ? '' : 'none';
  });
  if (tab === 'emp') renderSettingsEmpList();
  if (tab === 'email') {
    const el = document.getElementById('s-admin-email');
    if (el && appSettings.adminEmail) el.value = appSettings.adminEmail;
    const sv = document.getElementById('s-ejs-service');
    if (sv && appSettings.ejsServiceId) sv.value = appSettings.ejsServiceId;
    const tv = document.getElementById('s-ejs-template');
    if (tv && appSettings.ejsTemplate) tv.value = appSettings.ejsTemplate;
    const pv = document.getElementById('s-ejs-pubkey');
    if (pv && appSettings.ejsPubKey) pv.value = appSettings.ejsPubKey;
  }
}

function saveEmailSettings() {
  const email    = (document.getElementById('s-admin-email').value || '').trim();
  const service  = (document.getElementById('s-ejs-service').value || '').trim();
  const template = (document.getElementById('s-ejs-template').value || '').trim();
  const pubkey   = (document.getElementById('s-ejs-pubkey').value || '').trim();

  if (!email || !email.includes('@')) {
    showMsg('Invalid Email', 'Please enter a valid admin email address.', 'warn', 's-admin-email'); return;
  }
  appSettings.adminEmail   = email;
  appSettings.ejsServiceId = service;
  appSettings.ejsTemplate  = template;
  appSettings.ejsPubKey    = pubkey;
  saveSettings();

  // Initialise EmailJS if keys are present
  if (pubkey && window.emailjs) {
    window.emailjs.init({ publicKey: pubkey });
  }
  showMsg('Settings Saved', `Admin email <strong>${escHtml(email)}</strong> saved.<br>${service && template && pubkey ? '✅ EmailJS configured — OTPs will be sent to your email.' : '⚠️ EmailJS keys not filled — OTP will be shown on screen (demo mode).'}`, 'success');
}

// Also keep the old name as alias
const saveAdminEmail = saveEmailSettings;

async function sendAdminOtp() {
  const emailIn    = (document.getElementById('forgot-admin-email').value || '').trim();
  const savedEmail = appSettings.adminEmail || '';
  const errEl      = document.getElementById('forgot-email-error');
  errEl.style.display = 'none';

  if (!emailIn)   { errEl.textContent = 'Please enter your email address.'; errEl.style.display=''; return; }
  if (!savedEmail){ errEl.textContent = 'No admin email configured. Go to Settings → Email Setup first.'; errEl.style.display=''; return; }
  if (emailIn.toLowerCase() !== savedEmail.toLowerCase()) { errEl.textContent = 'Email does not match the registered admin email.'; errEl.style.display=''; return; }

  // Generate OTP
  _otpCode   = String(Math.floor(100000 + Math.random() * 900000));
  _otpExpiry = Date.now() + 10 * 60 * 1000; // 10 min

  // ── Try to send via EmailJS ───────────────────────────
  const svcId  = appSettings.ejsServiceId;
  const tplId  = appSettings.ejsTemplate;
  const pubKey = appSettings.ejsPubKey;
  let emailSent = false;

  if (svcId && tplId && pubKey && window.emailjs) {
    try {
      // Init with current public key
      window.emailjs.init({ publicKey: pubKey });
      await window.emailjs.send(svcId, tplId, {
        to_email: emailIn,
        otp_code: _otpCode,
        app_name: 'RK Sports Wear Salary System'
      });
      emailSent = true;
    } catch(err) {
      console.error('EmailJS error:', err);
      // Fall through to demo mode
    }
  }

  document.getElementById('forgot-email-display').textContent = emailIn;
  showForgotStep(2);

  let demoBox = document.getElementById('forgot-otp-demo-box');
  if (!demoBox) {
    demoBox = document.createElement('div');
    demoBox.id = 'forgot-otp-demo-box';
    document.getElementById('forgot-step2').insertBefore(demoBox, document.getElementById('forgot-step2').firstChild);
  }

  if (emailSent) {
    demoBox.style.cssText = 'background:#e8f5e9;border:1.5px solid #a5d6a7;border-radius:10px;padding:12px 16px;margin-bottom:12px;text-align:center;';
    demoBox.innerHTML = `
      <div style="font-size:13px;color:#1a5c2a;font-weight:700;margin-bottom:4px;">📧 OTP Sent!</div>
      <div style="font-size:11px;color:#2e7d32;">A 6-digit OTP has been sent to <strong>${escHtml(emailIn)}</strong>.<br>Check your inbox (and spam folder).</div>`;
  } else {
    // Demo mode — show OTP on screen
    demoBox.style.cssText = 'background:#fffbe6;border:1.5px dashed #d4a843;border-radius:10px;padding:10px 14px;margin-bottom:12px;text-align:center;';
    demoBox.innerHTML = `
      <div style="font-size:10px;color:#a07800;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">🧪 Demo Mode — OTP Code</div>
      <div id="forgot-otp-demo-code" style="font-size:28px;font-weight:900;letter-spacing:8px;color:#0e1e3c;">${_otpCode}</div>
      <div style="font-size:10px;color:#a07800;margin-top:3px;">Configure EmailJS in Settings → Email Setup to receive OTP by email.</div>`;
  }

  document.getElementById('forgot-otp-input').value = '';
  document.getElementById('forgot-otp-error').style.display = 'none';
  document.getElementById('forgot-otp-input').focus();
}

async function verifyOtpAndReset() {
  const entered  = (document.getElementById('forgot-otp-input').value || '').trim();
  const newPass  = (document.getElementById('forgot-new-pass').value || '').trim();
  const confPass = (document.getElementById('forgot-conf-pass').value || '').trim();
  const errEl    = document.getElementById('forgot-otp-error');
  errEl.style.display = 'none';

  if (!entered)   { errEl.textContent = 'Please enter the OTP.'; errEl.style.display=''; return; }
  if (Date.now() > _otpExpiry) { errEl.textContent = 'OTP expired. Please request a new one.'; errEl.style.display=''; return; }
  if (entered !== _otpCode)    { errEl.textContent = 'Incorrect OTP. Please check and try again.'; errEl.style.display=''; return; }
  if (!newPass)   { errEl.textContent = 'Please enter a new password.'; errEl.style.display=''; return; }
  if (newPass.length < 4) { errEl.textContent = 'Password must be at least 4 characters.'; errEl.style.display=''; return; }
  if (newPass !== confPass)    { errEl.textContent = 'Passwords do not match.'; errEl.style.display=''; return; }

  appSettings.adminPass = await hashPass(newPass);
  saveSettings();
  _otpCode = ''; _otpExpiry = 0;
  closeForgotModal();
  showMsg('Password Reset!', 'Admin password has been reset successfully. Please sign in with your new password.', 'success');
}

/* ── Auto-fill Days Worked from this week's attendance ──── */
function autoFillDaysWorked(empId) {
  const currentId = document.getElementById('f-id')?.value?.trim();
  if (!currentId || currentId !== empId) return;
  const m = employeeMaster[empId];
  if (!m || (m.salaryType||'weekly') !== 'weekly') return;

  // Always use CURRENT week (Mon–today), not the attendance modal's selected date
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const dow = today.getDay(); // 0=Sun
  const diffToMon = dow === 0 ? 6 : dow - 1;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - diffToMon);

  let totalShifts = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const yr = d.getFullYear();
    const mo = String(d.getMonth()+1).padStart(2,'0');
    const dy = String(d.getDate()).padStart(2,'0');
    const ds = `${yr}-${mo}-${dy}`;
    if (ds > todayStr) break;
    const val = (attendance[`${empId}::${yr}-${mo}`] || {})[ds];
    if (typeof val === 'number' && val > 0)   totalShifts += val;
    else if (val === 'P')                      totalShifts += 1;
    else if (val === 'H')                      totalShifts += 0.5;
  }

  // Fill total shifts directly as "days worked" — salary is shift-based
  const fillValue = parseFloat(totalShifts.toFixed(2));

  const daysEl = document.getElementById('f-days');
  if (!daysEl) return;

  daysEl.value = fillValue > 0 ? fillValue : '';
  daysEl.style.transition = 'background .3s';
  daysEl.style.background = '#d0f0e0';
  setTimeout(() => { daysEl.style.background = ''; }, 1400);
  validateDaysInput();

  if (fillValue > 0) {
    const wkLabel = weekStart.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
    showToast(`📅 Shifts this week (${wkLabel}): ${fillValue}`);
  }
}

/* ═══════════════════════════════════════════════════════════
   SALARY MODE — Weekly / Monthly toggle
════════════════════════════════════════════════════════════ */
let salaryMode = 'weekly'; // 'weekly' | 'monthly'

function switchSalaryMode(mode) {
  salaryMode = mode;
  document.getElementById('sal-mode-weekly').classList.toggle('active', mode==='weekly');
  document.getElementById('sal-mode-monthly').classList.toggle('active', mode==='monthly');
  document.getElementById('weekly-salary-section').style.display   = mode==='weekly'  ? 'block' : 'none';
  document.getElementById('monthly-salary-section').style.display  = mode==='monthly' ? 'block' : 'none';
  if (mode === 'monthly') {
    renderMonthlySalCalc();
    renderMonthlySalSheet();
  } else if (mode === 'weekly') {
    renderWeeklyPicker();
  }
}

let wsSelEmp = '';

function renderWeeklyPicker() {
  const pickerCard = document.getElementById('ws-picker-card');
  const formCard    = document.getElementById('ws-form-card');
  const grid        = document.getElementById('ws-picker-grid');
  if (!pickerCard || !formCard || !grid) return;

  if (!wsSelEmp) {
    pickerCard.style.display = 'block';
    formCard.style.display   = 'none';

    const empList = Object.values(employeeMaster).filter(e => !e.inactive && (e.salaryType||'weekly') === 'weekly');
    if (!empList.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#8892A4;font-size:13px;">No weekly salary employees found.<br>Add an employee with Weekly Salary type first.</div>';
      return;
    }
    grid.innerHTML = empList.map(e => {
      const photo = empPhotos[e.empId] || '';
      const initials = e.name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
      const av = photo
        ? `<div style="width:44px;height:44px;border-radius:50%;background-image:url(${photo});background-size:cover;background-position:center;border:2px solid #D6DCE8;flex-shrink:0;"></div>`
        : `<div style="width:44px;height:44px;border-radius:50%;background:#0E1E3C;color:#fff;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>`;

      const alreadyAdded = employees.some(x => x.empId === e.empId);
      const safeId = e.empId.replace(/'/g,"\\'");

      if (alreadyAdded) {
        // Already added this week — show as done, disabled, not selectable
        return `<div onclick="wsAlreadyAddedNotice('${safeId}')"
          style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#F3F5F9;border:2px solid #E2E6EE;border-radius:12px;cursor:not-allowed;opacity:.72;position:relative;">
          <div style="filter:grayscale(.4);">${av}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:14px;color:#6B7280;">${escHtml(e.name)}</div>
            <div style="font-size:11px;color:#9AA3B2;margin-top:2px;">ID: ${escHtml(e.empId)}</div>
          </div>
          <span style="background:#DCEFE0;color:#0E6B3A;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap;letter-spacing:.3px;">✓ ADDED</span>
        </div>`;
      }

      return `<div onclick="wsPick('${safeId}')"
        style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fff;border:2px solid #D6DCE8;border-radius:12px;cursor:pointer;"
        onmouseover="this.style.borderColor='#0E1E3C';this.style.background='#F6F7FA';"
        onmouseout="this.style.borderColor='#D6DCE8';this.style.background='#fff';">
        ${av}
        <div>
          <div style="font-weight:700;font-size:14px;color:#0E1E3C;">${escHtml(e.name)}</div>
          <div style="font-size:11px;color:#8892A4;margin-top:2px;">ID: ${escHtml(e.empId)}</div>
        </div></div>`;
    }).join('');
  } else {
    pickerCard.style.display = 'none';
    formCard.style.display   = 'block';
  }
}

function wsAlreadyAddedNotice(empId) {
  const m = employeeMaster[empId];
  const name = m ? m.name : empId;
  showMsg(
    'Already Added This Week',
    `Salary for <strong>${escHtml(name)}</strong> has already been added for this week.<br><br>` +
    `This employee can't be selected again from here. To edit their entry, use the <strong>Edit</strong> button in the Weekly Salary Sheet below.`,
    'info'
  );
}

function wsPick(empId) {
  wsSelEmp = empId;
  renderWeeklyPicker();

  // If this employee already has an entry for THIS WEEK, open it in edit mode
  // instead of a blank form — so the same ID stays accessible all week.
  const existingIdx = employees.findIndex(e => e.empId === empId);
  if (existingIdx >= 0) {
    editEntry(existingIdx);
    showToast('✏️ Editing this week\'s existing entry for this employee.');
    return;
  }

  document.getElementById('f-id').value = empId;
  selectEmployee(empId);
}

function wsClearPick() {
  wsSelEmp = '';
  clearForm();
  renderWeeklyPicker();
  setTimeout(() => {
    document.getElementById('ws-picker-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

let weeklyCalVisible = false;

function toggleWeeklyCalendar() {
  weeklyCalVisible = !weeklyCalVisible;
  const wrap = document.getElementById('weekly-cal-wrap');
  const btn  = document.getElementById('btn-weekly-cal');
  if (!wrap) return;
  if (weeklyCalVisible) {
    wrap.style.display = 'block';
    if (btn) { btn.style.background = 'var(--navy)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--navy)'; }
    renderWeeklyCalendar();
  } else {
    wrap.style.display = 'none';
    if (btn) { btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
  }
}

function renderWeeklyCalendar() {
  const inner = document.getElementById('weekly-cal-inner');
  if (!inner || !weeklyCalVisible) return;

  // Calculate current week Mon–Sun
  const today    = new Date();
  const todayStr = today.toISOString().slice(0,10);
  const dow      = today.getDay();
  const diffMon  = dow === 0 ? 6 : dow - 1;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - diffMon);

  // Build 7 days
  const days = [];
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push({
      ds:    d.toISOString().slice(0,10),
      label: dayNames[i],
      date:  d.getDate(),
      mo:    String(d.getMonth()+1).padStart(2,'0'),
      yr:    d.getFullYear(),
      isFuture: d.toISOString().slice(0,10) > todayStr,
      isToday:  d.toISOString().slice(0,10) === todayStr,
    });
  }

  const weekStr = weekStart.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})
    + ' – ' + new Date(weekStart.getTime() + 6*86400000).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});

  // Weekly-salary employees only
  const emps = Object.values(employeeMaster)
    .filter(m => !m.inactive && (m.salaryType||'weekly') === 'weekly')
    .sort((a,b) => a.empId.localeCompare(b.empId));

  if (!emps.length) {
    inner.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px;">No weekly salary employees found.</div>';
    return;
  }

  // Shift value → display badge
  function shiftBadge(val, isFuture) {
    if (isFuture) return '<span class="wc-cell wc-future">—</span>';
    if (val === undefined || val === null || val === '')
      return '<span class="wc-cell wc-empty">·</span>';
    if (val === 'A')
      return '<span class="wc-cell wc-absent">A</span>';
    if (val === '-')
      return '<span class="wc-cell wc-holiday">H</span>';
    if (typeof val === 'number' && val > 0)
      return `<span class="wc-cell wc-shift">${val}</span>`;
    if (val === 'P') return '<span class="wc-cell wc-shift">1</span>';
    if (val === 'H') return '<span class="wc-cell wc-shift">½</span>';
    return '<span class="wc-cell wc-empty">·</span>';
  }

  function shiftVal(val) {
    if (typeof val === 'number' && val > 0) return val;
    if (val === 'P') return 1;
    if (val === 'H') return 0.5;
    return 0;
  }

  // Build table
  let html = `
  <div class="wc-header">
    <span class="wc-week-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Week: ${weekStr}
    </span>
    <span style="font-size:11px;color:var(--muted);">${emps.length} weekly employee${emps.length!==1?'s':''}</span>
  </div>
  <div class="table-scroll">
  <table class="wc-table">
    <thead>
      <tr>
        <th class="wc-th-emp">Employee</th>
        ${days.map(d => `<th class="wc-th-day${d.isToday?' wc-today-hdr':''}">${d.label}<br><span class="wc-day-num">${d.date}</span></th>`).join('')}
        <th class="wc-th-total">Total</th>
      </tr>
    </thead>
    <tbody>
      ${emps.map(m => {
        let weekTotal = 0;
        const cells = days.map(d => {
          const key = `${m.empId}::${d.yr}-${d.mo}`;
          const val = (attendance[key] || {})[d.ds];
          weekTotal += shiftVal(val);
          return `<td class="wc-td${d.isToday?' wc-today-col':''}">${shiftBadge(val, d.isFuture)}</td>`;
        }).join('');
        return `<tr>
          <td class="wc-td-emp">
            <span class="wc-emp-badge">${escHtml(m.empId)}</span>
            <span class="wc-emp-name">${escHtml(m.name)}</span>
          </td>
          ${cells}
          <td class="wc-td-total">${weekTotal > 0 ? weekTotal : '—'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
  </div>
  <div class="wc-legend">
    <span class="wc-cell wc-shift" style="font-size:10px;">1</span> Shifts &nbsp;
    <span class="wc-cell wc-absent" style="font-size:10px;">A</span> Absent &nbsp;
    <span class="wc-cell wc-holiday" style="font-size:10px;">H</span> Holiday &nbsp;
    <span class="wc-cell wc-empty" style="font-size:10px;">·</span> Not marked &nbsp;
    <span class="wc-cell wc-future" style="font-size:10px;">—</span> Future
  </div>`;

  inner.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════
   EMPLOYEE PROFILE GRID (Admin Front Page)
════════════════════════════════════════════════════════════ */
function scrollToEmpProfile() {
  const section = document.getElementById('emp-profile-section');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    section.classList.add('emp-profile-flash');
    setTimeout(() => section.classList.remove('emp-profile-flash'), 1200);
  }
}

function setEmpFilter(f) {
  empFilter = f;
  ['all','weekly','monthly'].forEach(function(k) {
    var btn = document.getElementById('emp-filter-' + k);
    if (btn) btn.classList.toggle('active', k === f);
  });
  renderEmpProfileGrid();
}

function buildEmpCard(m, closeProfilePageFirst) {
  const photo    = empPhotos[m.empId];
  const initials = (m.name||m.empId).trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const avatarHtml = photo
    ? `<div class="pgc-photo" style="background-image:url(${photo})"></div>`
    : `<div class="pgc-photo pgc-photo-init">${initials}</div>`;

  let dobStr = '—';
  if (m.dob) {
    try { dobStr = new Date(m.dob+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); } catch(_){}
  }
  let joinStr = '—', svcStr = '';
  if (m.joiningDate) {
    try {
      const jd = new Date(m.joiningDate+'T00:00:00');
      joinStr = jd.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
      const ms2 = Date.now()-jd.getTime();
      const y = Math.floor(ms2/(365.25*24*3600*1000));
      const mo = Math.floor((ms2%(365.25*24*3600*1000))/(30.44*24*3600*1000));
      svcStr = y>0?`${y}y ${mo}m`:mo>0?`${mo}m`:'<1m';
    } catch(_){}
  }

  const phone   = m.phone ? '+91 '+m.phone : '—';
  const salType = m.salaryType || 'weekly';
  const isMonthly = salType === 'monthly';

  let onclick = '';
  if (!m.inactive) {
    const closePrefix = closeProfilePageFirst ? 'closeEmpProfilePageModal();' : '';
    if (isMonthly) {
      onclick = `${closePrefix}switchSalaryMode('monthly');msPick('${m.empId}');`;
    } else {
      onclick = `${closePrefix}switchSalaryMode('weekly');wsPick('${m.empId}');document.getElementById('weekly-salary-section').scrollIntoView({behavior:'smooth'});`;
    }
  }

  return `<div class="pgc-card${m.inactive?' pgc-inactive':''}${isMonthly?' pgc-monthly':' pgc-weekly'}" onclick="${onclick}">
    <div class="pgc-ribbon ${m.inactive?'pgc-ribbon-left':isMonthly?'pgc-ribbon-m':'pgc-ribbon-w'}">${m.inactive?'Left':isMonthly?'Monthly':'Weekly'}</div>
    <div class="pgc-photo-col">${avatarHtml}</div>
    <div class="pgc-info-col">
      <div class="pgc-name">${escHtml(m.name)}</div>
      <div class="pgc-id">${escHtml(m.empId)}</div>
      <div class="pgc-row"><span class="pgc-lbl">DOB</span><span class="pgc-val">${dobStr}</span></div>
      <div class="pgc-row"><span class="pgc-lbl">Phone</span><span class="pgc-val">${escHtml(phone)}</span></div>
      <div class="pgc-row"><span class="pgc-lbl">Joined</span><span class="pgc-val">${joinStr}${svcStr?` <b class="pgc-svc">${svcStr}</b>`:''}</span></div>
    </div>
  </div>`;
}

function buildCategoryGroupsHtml(list, closeProfilePageFirst) {
  const monthly = list.filter(m => m.salaryType === 'monthly');
  const weekly  = list.filter(m => (m.salaryType || 'weekly') === 'weekly');
  let html = '';

  if (monthly.length) {
    html += `<div class="pgc-section-hdr pgc-hdr-monthly">
      <div class="pgc-hdr-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>
      </div>
      <span class="pgc-hdr-title">Monthly Salary</span>
      <span class="pgc-hdr-count">${monthly.length} employee${monthly.length!==1?'s':''}</span>
    </div>
    <div class="pgc-grid">${monthly.map(m => buildEmpCard(m, closeProfilePageFirst)).join('')}</div>`;
  }

  if (weekly.length) {
    html += `<div class="pgc-section-hdr pgc-hdr-weekly"${monthly.length?' style="margin-top:22px;"':''}>
      <div class="pgc-hdr-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="12" y2="18"/></svg>
      </div>
      <span class="pgc-hdr-title">Weekly Salary</span>
      <span class="pgc-hdr-count">${weekly.length} employee${weekly.length!==1?'s':''}</span>
    </div>
    <div class="pgc-grid">${weekly.map(m => buildEmpCard(m, closeProfilePageFirst)).join('')}</div>`;
  }

  return html;
}

function renderEmpProfileGrid() {
  const wrap = document.getElementById('emp-profile-grid');
  if (!wrap) return;

  // Always reset to block container — inner sections each have their own grid
  wrap.style.display = 'block';
  wrap.removeAttribute('class');
  wrap.style.cssText = 'display:block;';

  const allList = Object.values(employeeMaster).sort((a,b) => a.empId.localeCompare(b.empId));
  const list = empFilter === 'all' ? allList
    : empFilter === 'weekly'  ? allList.filter(m => (m.salaryType||'weekly') === 'weekly')
    : allList.filter(m => m.salaryType === 'monthly');

  if (!list.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--muted);">
        <div style="font-size:40px;margin-bottom:10px;">👥</div>
        <div style="font-size:14px;font-weight:600;">No employees yet.</div>
        <div style="font-size:12px;margin-top:4px;">Click <strong>New Employee</strong> to add one.</div>
      </div>`;
    return;
  }

  wrap.innerHTML = buildCategoryGroupsHtml(list, false);
}

/* ── Employee Profile Page (Full Modal, Category-wise) ──────── */
let eppFilter = 'all'; // 'all' | 'weekly' | 'monthly'

function openEmpProfilePage() {
  const modal = document.getElementById('emp-profile-page-modal');
  if (!modal) return;
  eppFilter = 'all';
  ['all','weekly','monthly'].forEach(k => {
    const btn = document.getElementById('epp-filter-'+k);
    if (btn) btn.classList.toggle('active', k==='all');
  });
  const search = document.getElementById('epp-search');
  if (search) search.value = '';
  renderEmpProfilePage();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeEmpProfilePageModal() {
  const modal = document.getElementById('emp-profile-page-modal');
  if (modal) modal.classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}

function closeEmpProfilePageOutside(e) {
  if (e.target === document.getElementById('emp-profile-page-modal')) closeEmpProfilePageModal();
}

function setEppFilter(f) {
  eppFilter = f;
  ['all','weekly','monthly'].forEach(k => {
    const btn = document.getElementById('epp-filter-'+k);
    if (btn) btn.classList.toggle('active', k===f);
  });
  renderEmpProfilePage();
}

function renderEmpProfilePage() {
  const wrap = document.getElementById('epp-list-wrap');
  if (!wrap) return;

  const q = (document.getElementById('epp-search')?.value || '').trim().toLowerCase();
  let list = Object.values(employeeMaster).sort((a,b) => a.empId.localeCompare(b.empId));

  if (eppFilter === 'weekly')  list = list.filter(m => (m.salaryType||'weekly') === 'weekly');
  if (eppFilter === 'monthly') list = list.filter(m => m.salaryType === 'monthly');
  if (q) list = list.filter(m => m.name.toLowerCase().includes(q) || m.empId.toLowerCase().includes(q));

  if (!list.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--muted);">
        <div style="font-size:40px;margin-bottom:10px;">👥</div>
        <div style="font-size:14px;font-weight:600;">${q ? 'No employees match your search.' : 'No employees found in this category.'}</div>
      </div>`;
    return;
  }

  wrap.innerHTML = buildCategoryGroupsHtml(list, true);
}



/* ═══════════════════════════════════════════════════════════
   MONTHLY SALARY MODAL
════════════════════════════════════════════════════════════ */
let msYear  = new Date().getFullYear();
let msMonth = new Date().getMonth();
let empFilter = 'all'; // 'all' | 'weekly' | 'monthly'
let msSelEmp = '';

function openMonthlySalModal() {
  // Switch to monthly mode inline instead of opening a separate modal
  switchSalaryMode('monthly');
  // Populate select
  const sel = document.getElementById('ms-emp-select');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Select Employee to Calculate Monthly Salary —</option>' +
      Object.values(employeeMaster).filter(m=>!m.inactive).map(m =>
        `<option value="${escHtml(m.empId)}">${escHtml(m.name)} (${escHtml(m.empId)})</option>`
      ).join('');
    if (cur) sel.value = cur;
  }
  renderMonthlySalCalc();
  // Scroll to section
  const sec = document.getElementById('monthly-salary-section');
  if (sec) sec.scrollIntoView({behavior:'smooth', block:'start'});
}
function closeMonthlySalModal() {
  document.getElementById('monthly-sal-modal').classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}
function closeMonthlySalOutside(e) {
  if (e.target === document.getElementById('monthly-sal-modal')) closeMonthlySalModal();
}
function msChangeMonth(delta) {
  msMonth += delta;
  if (msMonth < 0)  { msMonth = 11; msYear--; }
  if (msMonth > 11) { msMonth = 0;  msYear++; }
  renderMonthlySalCalc();
  renderMonthlySalSheet();
}

function msAlreadyAddedNotice(empId) {
  var m = employeeMaster[empId];
  var name = m ? m.name : empId;
  var mn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  showMsg(
    'Already Added This Month',
    'Salary for <strong>'+escHtml(name)+'</strong> has already been added for '+mn[msMonth]+' '+msYear+'.<br><br>' +
    'This employee can\'t be selected again from here. To edit their entry, use the <strong>Edit</strong> button in the Monthly Salary Sheet below.',
    'info'
  );
}

function msPick(empId) {
  msSelEmp = empId;
  renderMonthlySalCalc();
}

function msClearPick() {
  msSelEmp = '';
  renderMonthlySalCalc();
  setTimeout(() => {
    document.getElementById('ms-picker-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function updateMsNetLive() {
  var salMonth  = parseFloat(document.getElementById('ms-sal-month-inp')   ? document.getElementById('ms-sal-month-inp').value   : 0) || 0;
  var advMonth  = parseFloat(document.getElementById('ms-advance-inp')     ? document.getElementById('ms-advance-inp').value     : 0) || 0;
  var oldAdv    = parseFloat(document.getElementById('ms-old-advance-inp') ? document.getElementById('ms-old-advance-inp').value : 0) || 0;
  var netAmt    = Math.max(0, salMonth - advMonth - oldAdv);
  var netEl     = document.getElementById('ms-net-amount');
  var wordsEl   = document.getElementById('ms-net-words');
  if (netEl)   netEl.textContent   = '₹' + Math.round(netAmt).toLocaleString('en-IN');
  if (wordsEl) wordsEl.textContent = numberToWords(Math.round(netAmt)) + ' Only';
}

function renderMonthlySalCalc() {
  var mn = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Update month label
  var lbl = document.getElementById('ms-month-label');
  if (lbl) lbl.textContent = mn[msMonth] + ' ' + msYear;

  var pickerCard = document.getElementById('ms-picker-card');
  var calcCard   = document.getElementById('ms-calc-card');
  if (!pickerCard || !calcCard) return;

  // ── NO EMPLOYEE SELECTED: show picker grid ──
  if (!msSelEmp) {
    pickerCard.style.display = 'block';
    calcCard.style.display   = 'none';
    var grid = document.getElementById('ms-picker-grid');
    if (!grid) return;
    var empList = Object.values(employeeMaster).filter(function(e){ return !e.inactive && e.salaryType === 'monthly'; });
    if (!empList.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#8892A4;font-size:13px;">No monthly salary employees found.<br>Add an employee with Monthly Salary type first.</div>';
      return;
    }
    var mm = String(msMonth+1).padStart(2,'0');
    grid.innerHTML = empList.map(function(e) {
      var photo = empPhotos[e.empId] || '';
      var initials = e.name.trim().split(/\s+/).map(function(w){return w[0];}).join('').slice(0,2).toUpperCase();
      var av = photo
        ? '<div style="width:44px;height:44px;border-radius:50%;background-image:url('+photo+');background-size:cover;background-position:center;border:2px solid #D6DCE8;flex-shrink:0;"></div>'
        : '<div style="width:44px;height:44px;border-radius:50%;background:#0E1E3C;color:#fff;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'+initials+'</div>';

      var savedRec = monthlySal[e.empId+'::'+msYear+'-'+mm];
      var alreadyAdded = !!(savedRec && savedRec.savedAt);
      var safeId = e.empId.replace(/\\/g,'\\\\').replace(/'/g,"\\'");

      if (alreadyAdded) {
        return '<div onclick="msAlreadyAddedNotice(\''+safeId+'\')"'
          +' style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#F3F5F9;border:2px solid #E2E6EE;border-radius:12px;cursor:not-allowed;opacity:.72;position:relative;">'
          +'<div style="filter:grayscale(.4);">'+av+'</div>'
          +'<div style="flex:1;min-width:0;">'
          +'<div style="font-weight:700;font-size:14px;color:#6B7280;">'+e.name+'</div>'
          +'<div style="font-size:11px;color:#9AA3B2;margin-top:2px;">ID: '+e.empId+'</div>'
          +'</div>'
          +'<span style="background:#DCEFE0;color:#0E6B3A;font-size:9px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap;letter-spacing:.3px;">✓ ADDED</span>'
          +'</div>';
      }

      return '<div onclick="msPick(\''+safeId+'\')"'
        +' style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fff;border:2px solid #D6DCE8;border-radius:12px;cursor:pointer;"'
        +' onmouseover="this.style.borderColor=\'#0E1E3C\';this.style.background=\'#F6F7FA\';"'
        +' onmouseout="this.style.borderColor=\'#D6DCE8\';this.style.background=\'#fff\';">'
        +av
        +'<div>'
        +'<div style="font-weight:700;font-size:14px;color:#0E1E3C;">'+e.name+'</div>'
        +'<div style="font-size:11px;color:#8892A4;margin-top:2px;">ID: '+e.empId+'</div>'
        +'</div></div>';
    }).join('');
    return;
  }

  // ── EMPLOYEE SELECTED: show calculator ──
  pickerCard.style.display = 'none';
  calcCard.style.display   = 'block';

  var m = employeeMaster[msSelEmp];
  if (!m) { msClearPick(); return; }

  // Month label
  if (lbl) lbl.textContent = mn[msMonth] + ' ' + msYear;

  // Count present days from attendance
  var mm = String(msMonth+1).padStart(2,'0');
  var attKey = msSelEmp+'::'+msYear+'-'+mm;
  var rec = attendance[attKey] || {};
  var daysInMonth = new Date(msYear, msMonth+1, 0).getDate();
  var presentDays=0, absentDays=0, holidays=0;
  for (var d=1; d<=daysInMonth; d++) {
    var ds = msYear+'-'+mm+'-'+String(d).padStart(2,'0');
    var val = rec[ds];
    if      (val==='A')                        { absentDays++; }
    else if (val==='-')                        { holidays++; }
    else if (val==='FD')                        { presentDays += 1; }
    else if (val==='HM' || val==='HE')          { presentDays += 0.5; absentDays += 0.5; }
    else if (typeof val==='number' && val>0)   { presentDays++; }
    else if (val==='P')                        { presentDays++; }
    else if (val==='H')                        { presentDays++; }
  }

  // Saved entry for this month
  var msSaved = monthlySal[msSelEmp+'::'+msYear+'-'+mm] || {};

  // Advance outstanding from ledger
  var advLedger = advances[msSelEmp] || [];
  var totalAdvGiven    = advLedger.reduce(function(s,a){ return s+Number(a.amount||0); },0);
  var totalAdvDeducted = advLedger.reduce(function(s,a){ return s+Number(a.deducted||0); },0);
  var outstandingAdv   = Math.max(0, totalAdvGiven - totalAdvDeducted);

  // Default values
  var salMonth = msSaved.salMonth !== undefined ? Number(msSaved.salMonth) : Number(m.rate||0);
  var advMonth = msSaved.advance  !== undefined ? Number(msSaved.advance)  : 0;
  var oldAdv   = msSaved.oldAdv   !== undefined ? Number(msSaved.oldAdv)   : outstandingAdv;
  var netAmt   = Math.max(0, salMonth - advMonth - oldAdv);

  // Fill employee details
  var el;
  el = document.getElementById('ms-calc-empid'); if(el) el.textContent = m.empId;
  el = document.getElementById('ms-emp-name');   if(el) el.textContent = m.name;
  el = document.getElementById('ms-calc-month'); if(el) el.textContent = mn[msMonth]+' '+msYear;

  // Fill salary input fields
  el = document.getElementById('ms-days-inp');        if(el) el.value = presentDays;
  el = document.getElementById('ms-sal-month-inp');   if(el) el.value = salMonth || '';
  el = document.getElementById('ms-advance-inp');     if(el) el.value = advMonth || '';
  el = document.getElementById('ms-old-advance-inp'); if(el) el.value = oldAdv   || '';

  // Net pay
  el = document.getElementById('ms-net-amount'); if(el) el.textContent = '\u20b9'+Math.round(netAmt).toLocaleString('en-IN');
  el = document.getElementById('ms-net-words');  if(el) el.textContent = numberToWords(Math.round(netAmt))+' Only';
}

function msClearFields() {
  var el;
  el = document.getElementById('ms-sal-month-inp');   if(el) el.value = '';
  el = document.getElementById('ms-advance-inp');     if(el) el.value = '';
  el = document.getElementById('ms-old-advance-inp'); if(el) el.value = '';
  updateMsNetLive();
}

/* ── Monthly Salary Sheet Table ──────────────────────────── */
function renderMonthlySalSheet() {
  const table   = document.getElementById('ms-sheet-table');
  const tbody   = document.getElementById('ms-sheet-body');
  const tfoot   = document.getElementById('ms-sheet-foot');
  const empty   = document.getElementById('ms-sheet-empty');
  if (!table || !tbody || !tfoot || !empty) return;

  const mm      = String(msMonth+1).padStart(2,'0');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const period  = monthNames[msMonth] + ' ' + msYear;

  // Get all monthly-salary employees
  const empList = Object.values(employeeMaster)
    .filter(m => !m.inactive && m.salaryType === 'monthly')
    .sort((a,b) => a.empId.localeCompare(b.empId));

  // Get saved entries for this month
  const rows = empList.map(m => {
    const key     = `${m.empId}::${msYear}-${mm}`;
    const saved   = monthlySal[key] || {};
    const salMonth= Number(saved.salMonth || 0);
    const adv     = Number(saved.advance  || 0);
    const oldAdv  = Number(saved.oldAdv   || 0);
    const netAmt  = Math.max(0, salMonth - adv - oldAdv);

    // Count present days
    const attKey  = `${m.empId}::${msYear}-${mm}`;
    const rec     = attendance[attKey] || {};
    const daysInMonth = new Date(msYear, msMonth+1, 0).getDate();
    let presentDays = 0;
    for (let d=1; d<=daysInMonth; d++) {
      const ds  = `${msYear}-${mm}-${String(d).padStart(2,'0')}`;
      const val = rec[ds];
      if      (val === 'FD')                    presentDays += 1;
      else if (val === 'HM' || val === 'HE')    presentDays += 0.5;
      else if (val === 'A' || val === '-')      {}
      else if (typeof val === 'number' && val > 0) presentDays += 1;
      else if (val === 'P' || val === 'H')      presentDays += 1;
    }

    return { m, salMonth, adv, oldAdv, netAmt, presentDays, hasSaved: !!saved.savedAt };
  }).filter(r => r.hasSaved); // only show saved entries

  if (!rows.length) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  table.style.display = 'table';
  empty.style.display = 'none';

  const waIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.004 2.003c-5.514 0-9.997 4.486-9.997 9.997 0 1.762.461 3.419 1.268 4.859L2 22l5.234-1.237A9.953 9.953 0 0012.004 22c5.514 0 9.996-4.483 9.996-9.997s-4.482-9.997-9.996-9.997z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  const pdfIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>`;
  const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

  tbody.innerHTML = rows.map(r => {
    const empId = r.m.empId.replace(/'/g, "\\'");
    return `<tr>
      <td><span class="emp-badge">${escHtml(r.m.empId)}</span></td>
      <td style="font-weight:600;white-space:nowrap;">${escHtml(r.m.name)}</td>
      <td class="hide-sm">${r.m.phone ? '+91 ' + r.m.phone : '—'}</td>
      <td>${r.presentDays}</td>
      <td class="hide-xs">${inr(r.salMonth)}</td>
      <td class="hide-xs">${inr(r.adv)}</td>
      <td class="hide-xs">${inr(r.oldAdv)}</td>
      <td class="net-pay">${inr(r.netAmt)}</td>
      <td><div class="row-actions">
        <button class="btn btn-edit" onclick="msSheetEdit('${empId}')">${editIcon} Edit</button>
        <button class="btn btn-wa"  onclick="msSheetWA('${empId}')">${waIcon} WA</button>
        <button class="btn btn-pdf" onclick="msSheetPdf('${empId}')">${pdfIcon} PDF</button>
        <button class="del-btn"     onclick="msSheetDelete('${empId}')">✕</button>
      </div></td>
    </tr>`;
  }).join('');

  const tG = rows.reduce((s,r) => s + r.salMonth, 0);
  const tA = rows.reduce((s,r) => s + r.adv, 0);
  const tO = rows.reduce((s,r) => s + r.oldAdv, 0);
  const tN = rows.reduce((s,r) => s + r.netAmt, 0);
  tfoot.innerHTML = `<tr>
    <td colspan="3">Total — ${rows.length} emp${rows.length!==1?'s':''} &nbsp;·&nbsp; ${period}</td>
    <td></td>
    <td class="hide-xs">${inr(tG)}</td>
    <td class="hide-xs">${inr(tA)}</td>
    <td class="hide-xs">${inr(tO)}</td>
    <td>${inr(tN)}</td>
    <td></td>
  </tr>`;
}

/* Row-action helpers for the monthly salary sheet */
function msSheetEdit(empId) {
  msPick(empId);
  document.getElementById('ms-calc-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function msSheetPdf(empId) {
  const prev = msSelEmp;
  msSelEmp = empId;
  buildMonthlySalPdf();
  msSelEmp = prev;
}

function msSheetWA(empId) {
  const prev = msSelEmp;
  msSelEmp = empId;
  shareMonthlyWhatsApp();
  msSelEmp = prev;
}

/* Generic styled confirm dialog for arbitrary actions (not tied to an employee record).
   Reuses the same visual classes as showConfirm() for consistency. */
function showAppConfirm(title, message, yesLabel, onYes) {
  const existing = document.getElementById('confirm-overlay'); if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay open';
  overlay.id = 'confirm-overlay';
  overlay.innerHTML = `<div class="confirm-box">
    <div class="confirm-icon-wrap"><div class="confirm-icon icon-delete">🗑️</div></div>
    <div class="confirm-body">
      <div class="confirm-title">${escHtml(title)}</div>
      <div class="confirm-msg">${message}</div>
    </div>
    <div class="confirm-footer">
      <button class="btn btn-confirm-no" id="confirm-no-btn">Cancel</button>
      <button class="btn btn-confirm-yes-delete" id="confirm-yes-btn">${escHtml(yesLabel || 'Yes, Delete')}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  document.getElementById('confirm-no-btn').addEventListener('click', closeConfirm);
  document.getElementById('confirm-yes-btn').addEventListener('click', () => { closeConfirm(); onYes(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) closeConfirm(); });
  function onEsc(e) { if (e.key === 'Escape') { closeConfirm(); document.removeEventListener('keydown', onEsc); } }
  document.addEventListener('keydown', onEsc);
}

function msSheetDelete(empId) {
  const mm  = String(msMonth+1).padStart(2,'0');
  const key = `${empId}::${msYear}-${mm}`;
  if (!monthlySal[key]) return;
  const mn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const empName = employeeMaster[empId]?.name || empId;
  showAppConfirm(
    'Delete Salary Entry?',
    `Delete the saved salary for <strong>${escHtml(empName)}</strong> — ${mn[msMonth]} ${msYear}?<br><span style="font-size:11px;color:var(--muted);">This cannot be undone.</span>`,
    'Yes, Delete',
    () => {
      delete monthlySal[key];
      saveMonthlySal();
      showToast('🗑️ Salary entry deleted.');
      renderMonthlySalSheet();
    }
  );
}

function saveMonthlySalEntry() {
  if (!msSelEmp) return;
  var mm      = String(msMonth+1).padStart(2,'0');
  var key     = msSelEmp + '::' + msYear + '-' + mm;
  var salMonth= parseFloat(document.getElementById('ms-sal-month-inp')   ? document.getElementById('ms-sal-month-inp').value   : 0) || 0;
  var adv     = parseFloat(document.getElementById('ms-advance-inp')     ? document.getElementById('ms-advance-inp').value     : 0) || 0;
  var oldAdv  = parseFloat(document.getElementById('ms-old-advance-inp') ? document.getElementById('ms-old-advance-inp').value : 0) || 0;
  var netAmt  = Math.max(0, salMonth - adv - oldAdv);

  if (!salMonth) { showToast('⚠️ Please enter Salary / Month.'); return; }

  // Record previous advance to compute delta for ledger
  var prevSaved = monthlySal[key] || {};
  var prevAdv   = Number(prevSaved.advance || 0);

  monthlySal[key] = { salMonth: salMonth, advance: adv, oldAdv: oldAdv, netAmt: netAmt, savedAt: new Date().toISOString() };
  saveMonthlySal();

  // Update advance ledger deduction delta
  var delta = adv - prevAdv;
  if (delta !== 0 && advances[msSelEmp] && advances[msSelEmp].length) {
    var remaining = Math.abs(delta);
    var sign = delta > 0 ? 1 : -1;
    var sorted = advances[msSelEmp].slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
    for (var i=0; i<sorted.length; i++) {
      if (remaining <= 0) break;
      var original = advances[msSelEmp].find(function(x){ return x.id === sorted[i].id; });
      if (!original) continue;
      var maxDeduct = Number(original.amount) - Number(original.deducted || 0);
      if (sign > 0) {
        var apply = Math.min(remaining, maxDeduct);
        original.deducted = Number(original.deducted || 0) + apply;
        remaining -= apply;
      } else {
        var apply2 = Math.min(remaining, Number(original.deducted || 0));
        original.deducted = Number(original.deducted || 0) - apply2;
        remaining -= apply2;
      }
    }
    saveAdvances();
  }

  showToast('✅ Monthly salary saved.');
  renderMonthlySalSheet();
  msClearPick();
}

/* ── Advance Ledger helpers ──────────────────────────────── */
/* ── Global Advance Ledger Modal (All Employees) ─────────── */
function openAdvanceLedgerModal() {
  const modal = document.getElementById('advance-ledger-modal');
  if (!modal) return;
  alCat = 'weekly'; alTab = 'current';
  ['weekly','monthly'].forEach(k => { const b = document.getElementById('al-cat-'+k); if(b) b.classList.toggle('hist-type-active', k==='weekly'); });
  ['current','old'].forEach(k => { const b = document.getElementById('al-tab-'+k); if(b) b.classList.toggle('active', k==='current'); });
  const curLabel = document.getElementById('al-tab-current-label');
  if (curLabel) curLabel.textContent = 'This Week';
  const search = document.getElementById('al-search');
  if (search) search.value = '';
  renderAdvanceLedgerModal();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAdvanceLedgerModal() {
  const modal = document.getElementById('advance-ledger-modal');
  if (modal) modal.classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}

function closeAdvanceLedgerOutside(e) {
  if (e.target === document.getElementById('advance-ledger-modal')) closeAdvanceLedgerModal();
}

let alCat = 'weekly';  // 'weekly' | 'monthly'
let alTab = 'current'; // 'current' | 'old'

function setAlCat(cat) {
  alCat = cat;
  ['weekly','monthly'].forEach(k => {
    const btn = document.getElementById('al-cat-'+k);
    if (btn) btn.classList.toggle('hist-type-active', k === cat);
  });
  // Update the "current" tab label: This Week vs This Month
  const curLabel = document.getElementById('al-tab-current-label');
  if (curLabel) curLabel.textContent = cat === 'monthly' ? 'This Month' : 'This Week';
  // Reset to current tab
  alTab = 'current';
  ['current','old'].forEach(k => {
    const btn = document.getElementById('al-tab-'+k);
    if (btn) btn.classList.toggle('active', k === 'current');
  });
  renderAdvanceLedgerModal();
}

function setAlTab(tab) {
  alTab = tab;
  ['current','old'].forEach(k => {
    const btn = document.getElementById('al-tab-'+k);
    if (btn) btn.classList.toggle('active', k === tab);
  });
  renderAdvanceLedgerModal();
}

function getWeekRange() {
  const today = new Date();
  const dow   = today.getDay();
  const diff  = dow === 0 ? 6 : dow - 1;
  const mon   = new Date(today); mon.setDate(today.getDate() - diff);
  const sun   = new Date(mon);   sun.setDate(mon.getDate() + 6);
  const fmt   = d => d.toISOString().slice(0,10);
  return { start: fmt(mon), end: fmt(sun) };
}

function getMonthRange() {
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const start = new Date(y, m, 1).toISOString().slice(0,10);
  const end   = new Date(y, m+1, 0).toISOString().slice(0,10);
  return { start, end };
}

/* ═══════════════════════════════════════════════════════════
   ADVANCE LEDGER — Colorful PDF Export (Credit/Debit format)
   Debit  = Advance Given (employee owes company)
   Credit = Deducted from Salary (repayment, reduces what's owed)
════════════════════════════════════════════════════════════ */

function exportEmployeeLedgerExcel(empId) {
  const m = employeeMaster[empId];
  if (!m) { showToast('⚠️ Employee not found.'); return; }
  buildLedgerPdf(m);
  showToast(`✅ Downloaded ${m.name}'s advance ledger PDF.`);
}

function exportAllLedgersExcel() {
  const allEmp = Object.values(employeeMaster)
    .filter(m => !m.inactive && (advances[m.empId] || []).length)
    .sort((a,b) => a.empId.localeCompare(b.empId));

  if (!allEmp.length) { showToast('⚠️ No employees with advance history found.'); return; }

  const {jsPDF} = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:'a4'});
  allEmp.forEach((m, idx) => {
    if (idx > 0) doc.addPage();
    buildLedgerPdf(m, doc);
  });
  doc.save('RK_Sports_Wear_All_Advance_Ledgers.pdf');
  showToast(`✅ Downloaded advance ledgers for ${allEmp.length} employee${allEmp.length!==1?'s':''}.`);
}

/* Builds one colorful ledger page. If `doc` is passed, draws onto it (multi-employee mode);
   otherwise creates a fresh single-page PDF and saves it (single-employee mode). */
function buildLedgerPdf(m, existingDoc) {
  const ledger = (advances[m.empId] || []).slice().sort((a,b) => a.date.localeCompare(b.date));
  const navy = [14,30,60], gold = [212,168,67], grey = [130,140,160], lgrey = [232,235,242];
  const debitClr = [200,40,40], creditClr = [14,107,58], dtxt = [40,50,70];

  const isStandalone = !existingDoc;
  const {jsPDF} = window.jspdf;
  const doc = existingDoc || new jsPDF({unit:'mm', format:'a4'});
  const W = doc.internal.pageSize.getWidth();
  const L = 14, R = W-14;

  // Header band
  doc.setFillColor(...navy); doc.rect(0,0,W,26,'F');
  if (window.RK_LOGO_B64) { try { doc.addImage(window.RK_LOGO_B64,'PNG',L,3,20,20); } catch(_){} }
  const cx = L+24;
  doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
  doc.text('RK SPORTS WEAR', cx, 11);
  doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.setTextColor(180,195,220);
  doc.text('Sri Complex, Near Udhayam Theatre, Manapparai - 621 306', cx, 17);
  doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.setTextColor(...gold);
  doc.text('ADVANCE LEDGER', R, 11, {align:'right'});
  doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.setTextColor(180,195,220);
  doc.text('Generated: '+new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}), R, 17, {align:'right'});

  let y = 36;

  // Employee info card (Name + ID only)
  doc.setFillColor(247,248,252); doc.roundedRect(L,y,R-L,20,2,2,'F');
  doc.setDrawColor(...lgrey); doc.setLineWidth(0.3); doc.roundedRect(L,y,R-L,20,2,2,'D');
  doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.setTextColor(...grey);
  doc.text('EMPLOYEE NAME', L+5, y+7);   doc.text('EMPLOYEE ID', L+(R-L)/2+5, y+7);
  doc.setFontSize(10.5); doc.setFont(undefined,'bold'); doc.setTextColor(...navy);
  doc.text(m.name, L+5, y+14.5);
  doc.text(m.empId, L+(R-L)/2+5, y+14.5);
  doc.setDrawColor(...lgrey); doc.setLineWidth(0.3); doc.line(L+(R-L)/2, y+3, L+(R-L)/2, y+17);
  y += 28;

  // Table header
  const cols = [
    {label:'Date',              w: (R-L)*0.14, align:'left'},
    {label:'Particulars',       w: (R-L)*0.34, align:'left'},
    {label:'Debit (Given)',     w: (R-L)*0.18, align:'right'},
    {label:'Credit (Deducted)', w: (R-L)*0.18, align:'right'},
    {label:'Balance',           w: (R-L)*0.16, align:'right'},
  ];
  const rowH = 8, headH = 9;

  function drawColumnLines(yTop, yBottom) {
    doc.setDrawColor(255,255,255); doc.setLineWidth(0.25);
    let lx = L;
    cols.forEach((c, idx) => {
      lx += c.w;
      if (idx < cols.length-1) doc.line(lx, yTop, lx, yBottom);
    });
  }
  function drawRowColumnLines(yTop, yBottom) {
    doc.setDrawColor(...lgrey); doc.setLineWidth(0.2);
    let lx = L;
    cols.forEach((c, idx) => {
      lx += c.w;
      if (idx < cols.length-1) doc.line(lx, yTop, lx, yBottom);
    });
  }

  doc.setFillColor(...navy); doc.rect(L,y,R-L,headH,'F');
  let cxPos = L;
  doc.setFontSize(7.5); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
  cols.forEach(c => {
    doc.text(c.label, c.align==='right' ? cxPos+c.w-3 : cxPos+3, y+6, {align: c.align==='right'?'right':'left'});
    cxPos += c.w;
  });
  drawColumnLines(y, y+headH);
  doc.setDrawColor(...navy); doc.setLineWidth(0.3); doc.rect(L,y,R-L,headH,'D');
  y += headH;

  // Build ledger rows: Debit row per advance given, Credit row per deduction applied
  const rows = [];
  let balance = 0;
  if (!ledger.length) {
    rows.push({date:'—', particulars:'No advance transactions recorded', debit:null, credit:null, balance:0});
  } else {
    ledger.forEach(a => {
      const amt = Number(a.amount||0), ded = Number(a.deducted||0);
      balance += amt;
      rows.push({date:a.date, particulars:'Advance Given'+(a.note?' - '+a.note:''), debit:amt, credit:null, balance});
      if (ded > 0) {
        balance -= ded;
        rows.push({date:a.date, particulars:'Deducted from Salary', debit:null, credit:ded, balance});
      }
    });
  }

  let i = 0;
  for (const row of rows) {
    // Page break if needed
    const H = doc.internal.pageSize.getHeight();
    if (y + rowH > H - 30) {
      doc.addPage();
      y = 16;
      doc.setFillColor(...navy); doc.rect(L,y,R-L,headH,'F');
      let cx2 = L;
      doc.setFontSize(7.5); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
      cols.forEach(c => { doc.text(c.label, c.align==='right'?cx2+c.w-3:cx2+3, y+6, {align:c.align==='right'?'right':'left'}); cx2+=c.w; });
      drawColumnLines(y, y+headH);
      doc.setDrawColor(...navy); doc.setLineWidth(0.3); doc.rect(L,y,R-L,headH,'D');
      y += headH;
    }

    const bg = i%2===0 ? [255,255,255] : [247,248,252];
    doc.setFillColor(...bg); doc.rect(L,y,R-L,rowH,'F');
    doc.setDrawColor(...lgrey); doc.setLineWidth(0.2); doc.rect(L,y,R-L,rowH,'D');
    drawRowColumnLines(y, y+rowH);

    let cx3 = L;
    doc.setFontSize(7.5); doc.setFont(undefined,'normal'); doc.setTextColor(...dtxt);
    doc.text(String(row.date), cx3+3, y+5.5); cx3 += cols[0].w;
    doc.text(String(row.particulars).slice(0,42), cx3+3, y+5.5); cx3 += cols[1].w;

    doc.setFont(undefined,'bold');
    if (row.debit != null) { doc.setTextColor(...debitClr); doc.text(inrPdf(row.debit), cx3+cols[2].w-3, y+5.5, {align:'right'}); }
    cx3 += cols[2].w;
    if (row.credit != null) { doc.setTextColor(...creditClr); doc.text(inrPdf(row.credit), cx3+cols[3].w-3, y+5.5, {align:'right'}); }
    cx3 += cols[3].w;
    doc.setTextColor(...navy); doc.text(inrPdf(row.balance), cx3+cols[4].w-3, y+5.5, {align:'right'});

    y += rowH;
    i++;
  }

  // Totals band
  const totalGiven    = ledger.reduce((s,a)=>s+Number(a.amount||0),0);
  const totalDeducted = ledger.reduce((s,a)=>s+Number(a.deducted||0),0);
  const outstanding   = Math.max(0, totalGiven-totalDeducted);
  y += 6;
  const bandH = 18;
  doc.setFillColor(...navy); doc.roundedRect(L,y,R-L,bandH,2,2,'F');
  const thirdW = (R-L)/3;
  doc.setFontSize(7); doc.setFont(undefined,'normal'); doc.setTextColor(200,210,230);
  doc.text('TOTAL GIVEN', L+thirdW*0+4, y+7);
  doc.text('TOTAL DEDUCTED', L+thirdW*1+4, y+7);
  doc.text('OUTSTANDING BALANCE', L+thirdW*2+4, y+7);
  doc.setFontSize(10.5); doc.setFont(undefined,'bold');
  doc.setTextColor(255,150,150); doc.text(inrPdf(totalGiven), L+thirdW*0+4, y+14);
  doc.setTextColor(150,230,180); doc.text(inrPdf(totalDeducted), L+thirdW*1+4, y+14);
  doc.setTextColor(...gold); doc.text(inrPdf(outstanding), L+thirdW*2+4, y+14);

  // Footer
  const H2 = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...lgrey); doc.line(L, H2-12, R, H2-12);
  doc.setFontSize(6.5); doc.setFont(undefined,'normal'); doc.setTextColor(160,170,185);
  doc.text('This is a computer-generated advance ledger statement.', W/2, H2-7, {align:'center'});

  if (isStandalone) {
    doc.save(`${m.empId}_${m.name.replace(/\s+/g,'_')}_Advance_Ledger.pdf`);
  }
  return doc;
}

function renderAdvanceLedgerModal() {
  const wrap = document.getElementById('al-list-wrap');
  if (!wrap) return;
  const q = (document.getElementById('al-search')?.value || '').trim().toLowerCase();

  // Get date range based on category and tab
  const isMonthly = alCat === 'monthly';
  const range = isMonthly ? getMonthRange() : getWeekRange();
  const rangeStart = range.start, rangeEnd = range.end;

  // Filter employees by salary type category
  const allEmp = Object.values(employeeMaster).filter(m => {
    if (m.inactive) return false;
    return isMonthly ? m.salaryType === 'monthly' : (m.salaryType||'weekly') === 'weekly';
  });
  let grandTotalOutstanding = 0;

  const rows = allEmp.map(m => {
    const ledger = advances[m.empId] || [];
    const filtered = ledger.filter(a => {
      if (alTab === 'current') return a.date >= rangeStart && a.date <= rangeEnd;
      if (alTab === 'old')     return a.date < rangeStart;
      return true;
    });
    const given       = filtered.reduce((s,a) => s + Number(a.amount||0), 0);
    const deducted    = filtered.reduce((s,a) => s + Number(a.deducted||0), 0);
    const outstanding = Math.max(0, given - deducted);
    return { m, ledger: filtered, fullLedger: ledger, given, deducted, outstanding };
  }).filter(r => {
    const matchQ = !q || r.m.name.toLowerCase().includes(q) || r.m.empId.toLowerCase().includes(q);
    return matchQ;
  }).sort((a,b) => b.outstanding - a.outstanding || a.m.empId.localeCompare(b.m.empId));

  allEmp.forEach(m => {
    const ledger   = advances[m.empId] || [];
    const filtered = ledger.filter(a => {
      if (alTab === 'current') return a.date >= rangeStart && a.date <= rangeEnd;
      if (alTab === 'old')     return a.date < rangeStart;
      return true;
    });
    grandTotalOutstanding += Math.max(0, filtered.reduce((s,a)=>s+Number(a.amount||0),0) - filtered.reduce((s,a)=>s+Number(a.deducted||0),0));
  });

  const totalEl = document.getElementById('al-total-outstanding');
  if (totalEl) totalEl.innerHTML = 'Total Outstanding: <strong>' + inr(grandTotalOutstanding) + '</strong>';

  if (!rows.length) {
    const catLabel = isMonthly ? 'monthly' : 'weekly';
    wrap.innerHTML = '<div style="text-align:center;padding:40px 10px;color:var(--muted);font-size:13px;">' + (q ? 'No employees match your search.' : `No ${catLabel} salary employees found.`) + '</div>';
    return;
  }

  const tabLabel = alTab === 'current'
    ? `<span style="font-size:10px;font-weight:700;color:var(--gold);background:rgba(212,168,67,.15);padding:2px 8px;border-radius:999px;margin-left:6px;">${isMonthly?'THIS MONTH':'THIS WEEK'}</span>`
    : '<span style="font-size:10px;font-weight:700;color:var(--muted);background:var(--offwhite);padding:2px 8px;border-radius:999px;margin-left:6px;">OLD</span>';

  wrap.innerHTML = rows.map(r => {
    const m = r.m;
    const photo    = empPhotos[m.empId] || '';
    const initials = m.name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const av = photo
      ? `<div style="width:40px;height:40px;border-radius:50%;background-image:url(${photo});background-size:cover;background-position:center;border:2px solid var(--border);flex-shrink:0;"></div>`
      : `<div style="width:40px;height:40px;border-radius:50%;background:var(--navy);color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>`;

    const ledgerHtml = r.ledger.length
      ? renderAdvanceLedgerRowsFiltered(r.ledger, m.empId)
      : `<div class="ms-ledger-empty" style="padding:10px 14px;">No entries for this period.</div>`;

    const today = new Date().toISOString().slice(0,10);
    const safeId = escHtml(m.empId);

    return `<div style="border:1.5px solid var(--border);border-radius:12px;margin-bottom:10px;overflow:hidden;">

      <!-- Employee header row — click to expand -->
      <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--offwhite);cursor:pointer;transition:background .15s;"
           onmouseover="this.style.background='#eaedf5'" onmouseout="this.style.background=''"
           onclick="alToggleRow('${safeId}')">
        ${av}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            <span style="font-size:10px;font-weight:800;color:#fff;background:var(--navy);padding:2px 8px;border-radius:999px;letter-spacing:.3px;">${safeId}</span>
            <span style="font-weight:700;font-size:13px;color:var(--navy);">${escHtml(m.name)}</span>
            ${tabLabel}
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${r.ledger.length} advance${r.ledger.length!==1?'s':''}</div>
        </div>
        <div style="text-align:right;margin-right:8px;">
          <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;">${alTab==='current'?(isMonthly?'This Month':'This Week'):'Old Balance'}</div>
          <div style="font-size:15px;font-weight:800;color:${r.outstanding>0?'var(--accent)':'var(--green)'};">${inr(r.outstanding)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <button onclick="event.stopPropagation();exportEmployeeLedgerExcel('${safeId}')" title="Download colorful PDF ledger"
            style="display:flex;align-items:center;gap:5px;height:28px;padding:0 10px;border-radius:6px;border:1.5px solid #c8e6c9;background:#e8f5e9;color:#1b5e20;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
            PDF
          </button>
          <span style="font-size:10px;font-weight:700;color:var(--navy);background:rgba(14,30,60,.08);padding:4px 10px;border-radius:6px;white-space:nowrap;">
            + Add / View
          </span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16" id="al-chev-${safeId}" style="color:var(--muted);transition:transform .2s;"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>

      <!-- Expanded panel: Add form + ledger -->
      <div id="al-row-${safeId}" style="display:none;">

        <!-- ── Inline Add Advance Form ── -->
        <div style="padding:14px 16px;background:#f8f9fc;border-bottom:1.5px solid var(--border);">
          <div style="font-size:10px;font-weight:800;color:var(--navy);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11" style="vertical-align:middle;margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Advance for ${escHtml(m.name)}
          </div>
          <div style="display:flex;gap:6px;margin-bottom:10px;">
            <button type="button" class="al-period-btn al-period-active" id="al-period-current-${safeId}" onclick="alSetPeriod('${safeId}', 'current', ${isMonthly})">${isMonthly?'This Month':'This Week'}</button>
            <button type="button" class="al-period-btn" id="al-period-old-${safeId}" onclick="alSetPeriod('${safeId}', 'old', ${isMonthly})">Old Advance</button>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
            <div class="field" style="margin:0;flex:1;min-width:120px;">
              <label style="font-size:10px;">Date</label>
              <input type="date" id="al-date-${safeId}" value="${today}" style="height:36px;width:100%;" />
            </div>
            <div class="field" style="margin:0;flex:1;min-width:120px;">
              <label style="font-size:10px;">Amount (₹)</label>
              <input type="number" id="al-amt-${safeId}" placeholder="e.g. 2000" min="1" style="height:36px;width:100%;" onkeydown="if(event.key==='Enter')alSaveAdvance('${safeId}')" />
            </div>
            <div class="field" style="margin:0;flex:2;min-width:160px;">
              <label style="font-size:10px;">Note (optional)</label>
              <input type="text" id="al-note-${safeId}" placeholder="e.g. Emergency advance" style="height:36px;width:100%;" onkeydown="if(event.key==='Enter')alSaveAdvance('${safeId}')" />
            </div>
            <button class="btn btn-primary" style="height:36px;padding:0 16px;white-space:nowrap;flex-shrink:0;" onclick="alSaveAdvance('${safeId}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><path d="M20 6L9 17l-5-5"/></svg>
              Save
            </button>
          </div>
          <div id="al-err-${safeId}" style="display:none;color:var(--accent);font-size:11px;margin-top:6px;"></div>
        </div>

        <!-- ── Date-wise Ledger ── -->
        <div style="padding:4px 0;">
          <div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;padding:8px 14px 4px;">Advance History</div>
          ${ledgerHtml}
        </div>

      </div>
    </div>`;
  }).join('');
}

function renderAdvanceLedgerRowsFiltered(list, empId) {
  const sorted = list.slice().sort((a,b) => b.date.localeCompare(a.date));

  // Group by date for date-wise view
  const byDate = {};
  sorted.forEach(a => {
    if (!byDate[a.date]) byDate[a.date] = [];
    byDate[a.date].push(a);
  });

  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

  let html = '<div class="ms-ledger-table">';

  dates.forEach(date => {
    const entries = byDate[date];
    const dayTotal = entries.reduce((s,a) => s + Number(a.amount||0), 0);
    const dayBal   = entries.reduce((s,a) => s + Math.max(0, Number(a.amount) - Number(a.deducted||0)), 0);
    const fmtDate  = new Date(date+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});

    // Date group header
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:var(--navy);color:#fff;font-size:10px;font-weight:700;letter-spacing:.4px;margin-top:4px;border-radius:4px;">'
      +'<span style="display:flex;align-items:center;gap:6px;">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
      + fmtDate
      +'</span>'
      +'<span style="color:var(--gold);">'+ entries.length +' entry'+(entries.length!==1?'s':'')+' &nbsp;·&nbsp; '+inr(dayTotal)+'</span>'
      +'</div>';

    // Rows for this date
    entries.forEach(a => {
      const bal = Math.max(0, Number(a.amount) - Number(a.deducted||0));
      const safeEmpId = empId.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const safeAdvId = a.id.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      html += '<div class="ms-ledger-row" style="background:var(--white);">'
        +'<span style="color:var(--muted);font-size:11px;">'+a.date+'</span>'
        +'<span style="color:var(--accent);font-weight:700;">'+inr(a.amount)+'</span>'
        +'<span style="color:var(--green);font-weight:700;">'+inr(a.deducted||0)+'</span>'
        +'<span style="font-weight:800;color:'+(bal>0?'var(--accent)':'var(--green)')+';">'+inr(bal)+'</span>'
        +'<span style="color:var(--muted);font-size:11px;">'+escHtml(a.note||'—')+'</span>'
        +'<span style="display:flex;gap:5px;justify-content:flex-end;">'
        +'<button class="edit-btn" title="Edit" onclick="openAddAdvanceModal(\''+safeEmpId+'\',\''+safeAdvId+'\')">✎</button>'
        +'<button class="del-btn" title="Delete" onclick="deleteAdvance(\''+safeEmpId+'\',\''+safeAdvId+'\')">✕</button>'
        +'</span></div>';
    });
  });

  html += '</div>';
  return html;
}

function alToggleRow(empId) {
  const row  = document.getElementById('al-row-' + empId);
  const chev = document.getElementById('al-chev-' + empId);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : 'block';
  if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
  // Auto-focus amount input when opening
  if (!isOpen) {
    setTimeout(() => {
      const amt = document.getElementById('al-amt-' + empId);
      if (amt) amt.focus();
    }, 100);
  }
}

/* ── Quick period toggle inside the inline Add Advance form ─
   "This Week/Month" presets today's date; "Old Advance" presets
   a date just before the current period so it's correctly
   classified as an old balance. The date field stays editable
   either way. */
function alSetPeriod(empId, period, isMonthly) {
  const curBtn = document.getElementById('al-period-current-' + empId);
  const oldBtn = document.getElementById('al-period-old-' + empId);
  if (curBtn) curBtn.classList.toggle('al-period-active', period === 'current');
  if (oldBtn) oldBtn.classList.toggle('al-period-active', period === 'old');

  const dateInp = document.getElementById('al-date-' + empId);
  if (!dateInp) return;

  if (period === 'current') {
    dateInp.value = new Date().toISOString().slice(0,10);
  } else {
    const range = isMonthly ? getMonthRange() : getWeekRange();
    const before = new Date(range.start + 'T00:00:00');
    before.setDate(before.getDate() - 1);
    dateInp.value = before.toISOString().slice(0,10);
  }
}

/* ── Save a new advance entry from the inline ledger form ──── */
function alSaveAdvance(empId) {
  const errEl  = document.getElementById('al-err-' + empId);
  const dateEl = document.getElementById('al-date-' + empId);
  const amtEl  = document.getElementById('al-amt-' + empId);
  const noteEl = document.getElementById('al-note-' + empId);
  if (!dateEl || !amtEl) return;

  const date   = dateEl.value.trim();
  const amount = parseFloat(amtEl.value) || 0;
  const note   = (noteEl?.value || '').trim();

  if (errEl) errEl.style.display = 'none';
  if (!date)   { if(errEl){errEl.textContent='Please select a date.';errEl.style.display='';} return; }
  if (!amount || amount <= 0) { if(errEl){errEl.textContent='Please enter a valid amount greater than 0.';errEl.style.display='';} return; }

  if (!advances[empId]) advances[empId] = [];
  advances[empId].push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    date, amount, deducted: 0, note,
    createdAt: new Date().toISOString()
  });
  saveAdvances();

  showToast(`✅ Advance ₹${amount.toLocaleString('en-IN')} added for ${employeeMaster[empId]?.name || empId}.`);

  // Clear inputs, keep the row expanded, and refresh the modal
  amtEl.value = '';
  if (noteEl) noteEl.value = '';
  renderMonthlySalCalc();
  renderAdvanceLedgerModal();
  // Re-open this employee's row after re-render
  setTimeout(() => {
    const row = document.getElementById('al-row-' + empId);
    if (row) row.style.display = 'block';
    const chev = document.getElementById('al-chev-' + empId);
    if (chev) chev.style.transform = 'rotate(180deg)';
  }, 30);
}

function renderAdvanceLedgerRows(empId) {
  const list = (advances[empId] || []).slice().sort((a,b) => b.date.localeCompare(a.date));
  if (!list.length) {
    return `<div class="ms-ledger-empty">No advances recorded yet. Use "Add Advance" to log one.</div>`;
  }
  return renderAdvanceLedgerRowsFiltered(list, empId);
}

function openAddAdvanceModal(empId, advId) {
  const m = employeeMaster[empId];
  if (!m) return;
  const modal = document.getElementById('add-advance-modal');
  if (!modal) return;

  const existing = advId ? (advances[empId] || []).find(a => a.id === advId) : null;

  document.getElementById('adv-modal-emp-name').textContent = m.name;
  document.getElementById('adv-modal-emp-id').textContent   = m.empId;

  const titleEl = document.getElementById('adv-modal-title');
  if (titleEl) titleEl.textContent = existing ? '✏️ Edit Advance' : '💰 Add Advance';

  const deductedHint = document.getElementById('adv-deducted-hint');
  if (existing && Number(existing.deducted||0) > 0) {
    if (deductedHint) {
      deductedHint.style.display = '';
      deductedHint.textContent = `Note: ₹${Number(existing.deducted).toLocaleString('en-IN')} of this advance has already been deducted from salary. Reducing the amount below ₹${Number(existing.deducted).toLocaleString('en-IN')} is not allowed.`;
    }
  } else if (deductedHint) {
    deductedHint.style.display = 'none';
  }

  document.getElementById('adv-date-inp').value   = existing ? existing.date : new Date().toISOString().slice(0,10);
  document.getElementById('adv-amount-inp').value = existing ? existing.amount : '';
  document.getElementById('adv-note-inp').value   = existing ? (existing.note||'') : '';
  document.getElementById('adv-error').style.display = 'none';

  const saveBtn = document.getElementById('adv-save-btn');
  if (saveBtn) saveBtn.innerHTML = existing
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg>Update Advance'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg>Save Advance';

  modal._empId = empId;
  modal._advId = advId || null;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(()=>document.getElementById('adv-amount-inp').focus(),100);
}

function closeAddAdvanceModal() {
  const modal = document.getElementById('add-advance-modal');
  if (modal) { modal.classList.remove('open'); modal._advId = null; }
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}

function closeAddAdvanceOutside(e) {
  if (e.target === document.getElementById('add-advance-modal')) closeAddAdvanceModal();
}

function saveAdvanceEntry() {
  const modal  = document.getElementById('add-advance-modal');
  const empId  = modal?._empId;
  const advId  = modal?._advId;
  const errEl  = document.getElementById('adv-error');
  if (!empId) return;

  const date   = document.getElementById('adv-date-inp').value.trim();
  const amount = parseFloat(document.getElementById('adv-amount-inp').value) || 0;
  const note   = document.getElementById('adv-note-inp').value.trim();

  if (!date)   { errEl.textContent='Please select a date.'; errEl.style.display=''; return; }
  if (!amount||amount<=0) { errEl.textContent='Please enter a valid amount greater than 0.'; errEl.style.display=''; return; }

  if (!advances[empId]) advances[empId] = [];

  if (advId) {
    // EDIT existing entry
    const existing = advances[empId].find(a => a.id === advId);
    if (!existing) { closeAddAdvanceModal(); return; }
    const alreadyDeducted = Number(existing.deducted||0);
    if (amount < alreadyDeducted) {
      errEl.textContent = `Amount cannot be less than ₹${alreadyDeducted.toLocaleString('en-IN')} (already deducted).`;
      errEl.style.display = '';
      return;
    }
    existing.date   = date;
    existing.amount = amount;
    existing.note   = note;
    existing.updatedAt = new Date().toISOString();
    saveAdvances();
    closeAddAdvanceModal();
    showToast(`✅ Advance updated for ${employeeMaster[empId]?.name||empId}.`);
  } else {
    // ADD new entry
    advances[empId].push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      date,
      amount,
      deducted: 0,
      note,
      createdAt: new Date().toISOString()
    });
    saveAdvances();
    closeAddAdvanceModal();
    showToast(`✅ Advance ₹${amount.toLocaleString('en-IN')} added for ${employeeMaster[empId]?.name||empId}.`);
  }

  renderMonthlySalCalc();
  if (document.getElementById('advance-ledger-modal')?.classList.contains('open')) renderAdvanceLedgerModal();
  if (currentEmpId === empId) renderEmpAdvanceLedger();
}

function deleteAdvance(empId, advId) {
  if (!advances[empId]) return;
  const idx = advances[empId].findIndex(a => a.id === advId);
  if (idx < 0) return;
  const a = advances[empId][idx];
  if (Number(a.deducted||0) > 0) {
    showMsg('Cannot Delete','This advance has already been partially or fully deducted from salary. Deleting it would cause inconsistency.<br><br>Set the deducted amount to 0 or adjust the monthly salary advance first.','warn');
    return;
  }
  showAppConfirm(
    'Delete Advance?',
    `Delete the <strong>₹${Number(a.amount).toLocaleString('en-IN')}</strong> advance dated ${a.date}?<br><span style="font-size:11px;color:var(--muted);">This cannot be undone.</span>`,
    'Yes, Delete',
    () => {
      advances[empId].splice(idx, 1);
      saveAdvances();
      showToast('🗑️ Advance entry deleted.');
      renderMonthlySalCalc();
      if (document.getElementById('advance-ledger-modal')?.classList.contains('open')) renderAdvanceLedgerModal();
      if (currentEmpId === empId) renderEmpAdvanceLedger();
    }
  );
}

function buildMonthlySalPdf() {
  const m = employeeMaster[msSelEmp]; if (!m) return;
  const mm = String(msMonth+1).padStart(2,'0');
  const attKey = `${msSelEmp}::${msYear}-${mm}`;
  const rec    = attendance[attKey] || {};
  const daysInMonth = new Date(msYear, msMonth+1, 0).getDate();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  let presentDays=0, absentDays=0, holidays=0;
  for (let d=1; d<=daysInMonth; d++) {
    const ds  = `${msYear}-${mm}-${String(d).padStart(2,'0')}`;
    const val = rec[ds];
    if (val==='A') absentDays++;
    else if (val==='-') holidays++;
    else if (val==='FD') presentDays += 1;
    else if (val==='HM' || val==='HE') { presentDays += 0.5; absentDays += 0.5; }
    else if (typeof val==='number'&&val>0) presentDays++;
    else if (val==='P'||val==='H') presentDays++;
  }

  const msSaved   = monthlySal[`${msSelEmp}::${msYear}-${mm}`] || {};
  const salMonth  = Number(msSaved.salMonth || m.rate || 0);
  const advAmt    = Number(msSaved.advance  || 0);
  const oldAdv    = Number(msSaved.oldAdv   || 0);
  const netAmt    = Math.max(0, salMonth - advAmt - oldAdv);
  const words     = numberToWords(Math.round(netAmt));
  const period    = monthNames[msMonth] + ' ' + msYear;
  const today     = new Date().toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});

  // Build a synthetic "emp" object shaped like the weekly receipt expects,
  // so we can reuse the exact same visual layout as buildIndividualPdf.
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'mm',format:'a4'});
  const W=doc.internal.pageSize.getWidth(); const H=doc.internal.pageSize.getHeight();
  const L=14,R=W-L,CW=R-L,LBL=38,VAL=L+LBL+4;

  doc.setFillColor(14,30,60); doc.rect(0,0,W,30,'F');
  if(window.RK_LOGO_B64){try{doc.addImage(window.RK_LOGO_B64,'PNG',L,3,24,24);}catch(_){}}
  const cx=L+28;
  doc.setFontSize(12);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);doc.text('RK SPORTS WEAR',cx,11);
  doc.setFontSize(7);doc.setFont(undefined,'normal');doc.setTextColor(180,195,220);doc.text('Sri Complex, Near Udhayam Theatre, Manapparai\u2013 621 306.  |  +91 99528 89854',cx,17);
  doc.setFontSize(7.5);doc.setFont(undefined,'italic');doc.setTextColor(180,195,220);doc.text('Sports is Our Identity',cx,23);
  doc.setFontSize(10);doc.setFont(undefined,'bold');doc.setTextColor(212,168,67);doc.text('Salary Receipt',R,10,{align:'right'});
  doc.setFontSize(7.5);doc.setFont(undefined,'normal');doc.setTextColor(180,195,220);doc.text('Month: '+period,R,17,{align:'right'});

  const boxW=56,boxH=24,boxX=R-boxW,boxY=54;
  doc.setDrawColor(180,215,195);doc.setLineWidth(0.4);doc.setFillColor(234,246,239);doc.roundedRect(boxX,boxY,boxW,boxH,2,2,'FD');
  doc.setFontSize(16);doc.setFont(undefined,'bold');doc.setTextColor(14,107,58);doc.text('Rs.'+salMonth.toLocaleString('en-IN'),boxX+boxW/2,boxY+13,{align:'center'});
  doc.setFontSize(7);doc.setFont(undefined,'normal');doc.setTextColor(60,140,100);doc.text('Gross Salary',boxX+boxW/2,boxY+18,{align:'center'});

  let y=36;
  doc.setFontSize(8);doc.setFont(undefined,'bold');doc.setTextColor(80,90,110);doc.text('EMPLOYEE SUMMARY',L,y+5);
  doc.setDrawColor(214,220,232);doc.setLineWidth(0.3);doc.line(L,y+7,R,y+7);
  y+=12;const rowH=9;
  const infoRows=[['Employee Name',m.name],['Employee ID',m.empId],['Phone Number',m.phone?'+91 '+m.phone:'\u2014'],['Address',m.addr||'\u2014'],['Pay Period',period],['Pay Date',today]];
  infoRows.forEach(([lbl,val])=>{
    doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(120,130,145);doc.text(lbl,L,y);doc.setTextColor(120,130,145);doc.text(':',L+LBL,y);
    doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);
    const valMaxW=boxX-VAL-4;
    if(lbl==='Address'&&doc.getTextWidth(val)>valMaxW){const lines=doc.splitTextToSize(val,valMaxW);doc.text(lines,VAL,y);y+=(lines.length-1)*5;}
    else{doc.text(val,VAL,y);}
    y+=rowH;
  });
  y+=4;
  const halfW=(CW-4)/2;
  doc.setDrawColor(214,220,232);doc.setLineWidth(0.3);doc.setFillColor(247,248,252);doc.roundedRect(L,y,halfW,14,1.5,1.5,'FD');
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(120,130,145);doc.text('Present Days',L+4,y+6);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);doc.text(': '+presentDays,L+32,y+6);
  const rx=L+halfW+4;doc.setFillColor(247,248,252);doc.roundedRect(rx,y,halfW,14,1.5,1.5,'FD');
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(120,130,145);doc.text('Absent Days',rx+4,y+6);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);doc.text(': '+absentDays,rx+32,y+6);
  y+=22;
  const tColW=(CW-4)/2,tHdrH=10,tRowH=10,tFtrH=10;
  doc.setFillColor(14,30,60);doc.rect(L,y,tColW,tHdrH,'F');doc.rect(L+tColW+4,y,tColW,tHdrH,'F');
  doc.setFontSize(8);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);
  doc.text('EARNINGS',L+3,y+6.5);doc.text('AMOUNT',L+tColW-3,y+6.5,{align:'right'});
  doc.text('DEDUCTIONS',L+tColW+7,y+6.5);doc.text('AMOUNT',L+tColW*2+4-3,y+6.5,{align:'right'});
  y+=tHdrH;
  const earnings=[['Monthly Salary',salMonth]];
  const deductions=[['Advance (This Month)',advAmt],['Old Advance',oldAdv]];
  const maxR=Math.max(earnings.length,deductions.length);
  for(let r=0;r<maxR;r++){
    const bg=r%2===0?[252,252,252]:[245,246,250];
    doc.setFillColor(...bg);doc.rect(L,y,tColW,tRowH,'F');doc.rect(L+tColW+4,y,tColW,tRowH,'F');
    doc.setFontSize(8);
    if(earnings[r]){doc.setFont(undefined,'normal');doc.setTextColor(40,50,70);doc.text(earnings[r][0],L+3,y+6.5);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);doc.text('Rs.'+Number(earnings[r][1]).toLocaleString('en-IN'),L+tColW-3,y+6.5,{align:'right'});}
    if(deductions[r]){doc.setFont(undefined,'normal');doc.setTextColor(40,50,70);doc.text(deductions[r][0],L+tColW+7,y+6.5);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);doc.text('Rs.'+Number(deductions[r][1]).toLocaleString('en-IN'),L+tColW*2+4-3,y+6.5,{align:'right'});}
    doc.setDrawColor(225,228,235);doc.setLineWidth(0.2);doc.line(L,y+tRowH,L+tColW,y+tRowH);doc.line(L+tColW+4,y+tRowH,L+tColW*2+4,y+tRowH);
    y+=tRowH;
  }
  doc.setFillColor(228,233,243);doc.rect(L,y,tColW,tFtrH,'F');doc.rect(L+tColW+4,y,tColW,tFtrH,'F');
  doc.setFontSize(8);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);
  doc.text('Gross Salary',L+3,y+6.5);doc.text('Rs.'+salMonth.toLocaleString('en-IN'),L+tColW-3,y+6.5,{align:'right'});
  doc.text('Total Deductions',L+tColW+7,y+6.5);doc.text('Rs.'+(advAmt+oldAdv).toLocaleString('en-IN'),L+tColW*2+4-3,y+6.5,{align:'right'});
  y+=tFtrH+6;
  const bandH=18;doc.setFillColor(14,30,60);doc.rect(L,y,CW,bandH,'F');
  doc.setFontSize(10);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);doc.text('TOTAL NET PAYABLE',L+4,y+7.5);
  doc.setFontSize(7.5);doc.setFont(undefined,'normal');doc.setTextColor(170,185,210);doc.text('Gross Salary \u2013 Total Deductions',L+4,y+14);
  doc.setFontSize(13);doc.setFont(undefined,'bold');doc.setTextColor(212,168,67);doc.text('Rs.'+netAmt.toLocaleString('en-IN'),R-4,y+12,{align:'right'});
  y+=bandH+10;
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(120,130,145);doc.text('Amount In Words :',R,y,{align:'right'});y+=6;
  doc.setFontSize(8.5);doc.setFont(undefined,'bold');doc.setTextColor(14,30,60);
  const wLine='Indian Rupee '+words+' Only';doc.text(doc.splitTextToSize(wLine,CW),R,y,{align:'right'});
  doc.setDrawColor(214,220,232);doc.setLineWidth(0.3);doc.line(L,H-14,R,H-14);
  doc.setFontSize(6.5);doc.setFont(undefined,'normal');doc.setTextColor(160,170,185);
  doc.text('-- This document has been automatically generated by RK Sports Wear Salary System; therefore, a signature is not required. --',W/2,H-8,{align:'center'});
  doc.save(period.replace(/\s+/g,'_')+'_Salary_'+m.empId+'_'+m.name.replace(/\s+/g,'_')+'.pdf');
}

/* ═══════════════════════════════════════════════════════════
   PDF — Monthly Overall (all monthly-salary employees)
════════════════════════════════════════════════════════════ */
function dlMonthlyOverall() {
  const monthlyEmps = Object.values(employeeMaster).filter(m => !m.inactive && m.salaryType === 'monthly');
  if (!monthlyEmps.length) { showMsg('No Employees','No monthly salary employees found. Add one first.','info'); return; }
  buildMonthlyOverallPdf(monthlyEmps);
}

function buildMonthlyOverallPdf(monthlyEmps) {
  const mm = String(msMonth+1).padStart(2,'0');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const period = monthNames[msMonth] + ' ' + msYear;

  const rowsData = monthlyEmps.map(m => {
    const msSaved  = monthlySal[`${m.empId}::${msYear}-${mm}`] || {};
    const salMonth = Number(msSaved.salMonth || m.rate || 0);
    const advAmt   = Number(msSaved.advance  || 0);
    const oldAdv   = Number(msSaved.oldAdv   || 0);
    const netAmt   = Math.max(0, salMonth - advAmt - oldAdv);
    return { m, salMonth, advAmt, oldAdv, netAmt };
  });

  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'mm',format:'a4',orientation:'landscape'});
  const W=doc.internal.pageSize.getWidth();const H=doc.internal.pageSize.getHeight();
  doc.setFillColor(14,30,60);doc.rect(0,0,W,26,'F');
  if(window.RK_LOGO_B64){try{doc.addImage(window.RK_LOGO_B64,'PNG',8,3,30,16);}catch(e){}}
  doc.setFontSize(14);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);doc.text('RK SPORTS WEAR',W/2,10,{align:'center'});
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(180,190,210);doc.text('Sri Complex,Near Udhayam Theatre, Manapparai\u2013 621 306 |  +91 99528 89854',W/2,16,{align:'center'});
  doc.setFontSize(9.5);doc.setFont(undefined,'bold');doc.setTextColor(212,168,67);doc.text('MONTHLY SALARY SHEET',W/2,23,{align:'center'});
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(80,90,110);doc.text('Month: '+period+'    |    Total Employees: '+rowsData.length,W/2,32,{align:'center'});
  const cols=[{h:'S.No',w:8},{h:'Emp ID',w:20},{h:'Name',w:36},{h:'Phone',w:30},{h:'Address',w:50},{h:'Salary',w:24},{h:'Advance',w:24},{h:'Old Adv',w:22},{h:'Net Pay',w:26}];
  const startX=10;let y=36;
  doc.setFillColor(14,30,60);doc.rect(startX,y,W-20,9,'F');doc.setFontSize(7.5);doc.setFont(undefined,'bold');doc.setTextColor(180,190,210);
  let x=startX;cols.forEach(c=>{doc.text(c.h,x+1.5,y+6);x+=c.w;});y+=9;
  rowsData.forEach((r,idx)=>{
    const vals=[String(idx+1),r.m.empId,r.m.name,r.m.phone?'+91 '+r.m.phone:'\u2014',r.m.addr||'\u2014',inrPdf(r.salMonth),inrPdf(r.advAmt),inrPdf(r.oldAdv),inrPdf(r.netAmt)];
    if(idx%2===0){doc.setFillColor(252,252,252);}else{doc.setFillColor(246,247,250);}
    doc.rect(startX,y,W-20,8,'F');doc.setFontSize(7.5);doc.setFont(undefined,'normal');doc.setTextColor(14,30,60);
    x=startX;vals.forEach((v,vi)=>{
      const maxW=cols[vi].w-3;let txt=String(v);
      if(doc.getTextWidth(txt)>maxW)txt=txt.substring(0,Math.floor(maxW/doc.getTextWidth('A'))-1)+'\u2026';
      if(vi===8){doc.setFont(undefined,'bold');doc.setTextColor(14,107,58);}else{doc.setFont(undefined,'normal');doc.setTextColor(14,30,60);}
      doc.text(txt,x+1.5,y+5.5);x+=cols[vi].w;
    });
    doc.setDrawColor(214,220,232);doc.setLineWidth(0.2);doc.line(startX,y+8,W-10,y+8);y+=8;
    if(y>H-22){doc.addPage('a4','landscape');y=16;}
  });

  // Totals row — matches weekly sheet template: Gross, Advance, Old Adv, Net Pay
  const tGross = rowsData.reduce((s,r)=>s+r.salMonth,0);
  const tAdv   = rowsData.reduce((s,r)=>s+r.advAmt,0);
  const tOld   = rowsData.reduce((s,r)=>s+r.oldAdv,0);
  const tNet   = rowsData.reduce((s,r)=>s+r.netAmt,0);

  doc.setFillColor(14,30,60);doc.rect(startX,y,W-20,11,'F');
  doc.setFontSize(8);doc.setFont(undefined,'bold');doc.setTextColor(255,255,255);
  doc.text('TOTAL ('+rowsData.length+' employees)',startX+2,y+7.5);

  // Column x-offsets: S.No,EmpID,Name,Phone,Address,Salary,Advance,OldAdv,NetPay
  let colX = startX + cols[0].w + cols[1].w + cols[2].w + cols[3].w + cols[4].w; // start of Salary col
  doc.setTextColor(255,255,255);       doc.text(inrPdf(tGross), colX+1.5, y+7.5); colX += cols[5].w;
  doc.setTextColor(255,255,255);       doc.text(inrPdf(tAdv),   colX+1.5, y+7.5); colX += cols[6].w;
  doc.setTextColor(255,255,255);       doc.text(inrPdf(tOld),   colX+1.5, y+7.5); colX += cols[7].w;
  doc.setTextColor(212,168,67);        doc.text(inrPdf(tNet),   colX+1.5, y+7.5);

  doc.setFontSize(7);doc.setFont(undefined,'normal');doc.setTextColor(160,170,185);doc.text('Generated by RK Sports Wear Salary System \u2014 computer generated document',W/2,H-6,{align:'center'});
  doc.save(period.replace(/\s+/g,'_')+'_RK_Sports_Wear_Monthly_Salary_Sheet.pdf');
}


/* ═══════════════════════════════════════════════════════════
   ATTENDANCE MODAL — SHIFT BASED
   Shift values: 0.5, 1, 1.5, 2, 'A' (absent), '-' (holiday)
════════════════════════════════════════════════════════════ */
let attYear    = new Date().getFullYear();
let attMonth   = new Date().getMonth();
let attSelDate = null;
let attSelEmp  = '';
let attMode    = 'admin';

/* Shift definitions — Holiday removed as requested */
const SHIFTS = [
  { val: 0.5,  label: '½ Shift',  title: 'Half Shift',      cls: 'att-s05',   color: '#e6a817' },
  { val: 1,    label: '1 Shift',  title: '1 Shift',          cls: 'att-s1',    color: '#2e7d32' },
  { val: 1.5,  label: '1½ Shift', title: '1½ Shifts',       cls: 'att-s15',   color: '#1565c0' },
  { val: 2,    label: '2 Shifts', title: '2 Shifts',         cls: 'att-s2',    color: '#6a0dad' },
  { val: 'A',  label: 'Absent',   title: 'Absent',           cls: 'att-absent',color: '#c62828' },
  // Monthly-salary employee specific marks
  { val: 'HM', label: 'Half (M)', title: 'Half Day — Morning Present, Evening Absent', cls: 'att-hm',  color: '#e6a817' },
  { val: 'HE', label: 'Half (E)', title: 'Half Day — Evening Present, Morning Absent', cls: 'att-he',  color: '#1565c0' },
  { val: 'FD', label: 'Full Day', title: 'Full Day',           cls: 'att-fd',  color: '#2e7d32' },
];

function getShiftInfo(val) {
  if (val === '' || val === null || val === undefined) return null;
  return SHIFTS.find(s => s.val === val) || null;
}
function getShiftDays(val) {
  if (typeof val === 'number') return val / (1); // shifts, not days
  if (val === 'P') return 1; // legacy
  if (val === 'H') return 0.5; // legacy
  if (val === 'FD') return 1;   // monthly: full day
  if (val === 'HM' || val === 'HE') return 0.5; // monthly: half day (morning/evening)
  return 0;
}

let attCat = 'all'; // 'all' | 'weekly' | 'monthly'

function setAttCat(cat) {
  attCat = cat;
  ['all','weekly','monthly'].forEach(k => {
    const btn = document.getElementById('att-cat-'+k);
    if (btn) btn.classList.toggle('att-cat-active', k === cat);
  });
  // Repopulate dropdown filtered by category
  const sel = document.getElementById('att-emp-filter');
  if (!sel) return;
  const prevVal = sel.value;
  const empList = Object.values(employeeMaster).filter(m => {
    if (m.inactive) return false;
    if (cat === 'weekly')  return (m.salaryType||'weekly') === 'weekly';
    if (cat === 'monthly') return m.salaryType === 'monthly';
    return true;
  });
  sel.innerHTML = '<option value="">— All '+(cat==='all'?'Employees':cat.charAt(0).toUpperCase()+cat.slice(1)+' Employees')+'—</option>'
    + empList.map(m => `<option value="${escHtml(m.empId)}">${escHtml(m.name)} (${escHtml(m.empId)})</option>`).join('');
  // Restore previous selection if still valid
  if (prevVal && empList.find(m => m.empId === prevVal)) sel.value = prevVal;
  else { sel.value = ''; attSelEmp = ''; }
  renderAttendanceCalendar();
}

function openAttendanceModal(mode) {
  attMode    = mode;
  attYear    = new Date().getFullYear();
  attMonth   = new Date().getMonth();
  attSelDate = null;
  attSelEmp  = mode === 'employee' ? currentEmpId : '';
  attCat     = 'all';

  document.getElementById('att-modal-label').textContent =
    mode === 'employee' ? 'My Attendance' : 'Attendance — All Employees';

  const filterWrap = document.getElementById('att-emp-filter-wrap');
  filterWrap.style.display = mode === 'admin' ? '' : 'none';
  if (mode === 'admin') {
    // Reset category tabs to 'all'
    ['all','weekly','monthly'].forEach(k => {
      const btn = document.getElementById('att-cat-'+k);
      if (btn) btn.classList.toggle('att-cat-active', k === 'all');
    });
    // Populate dropdown with all employees
    const sel = document.getElementById('att-emp-filter');
    sel.innerHTML = '<option value="">— All Employees —</option>' +
      Object.values(employeeMaster).filter(m=>!m.inactive).map(m =>
        `<option value="${escHtml(m.empId)}">${escHtml(m.name)} (${escHtml(m.empId)})</option>`
      ).join('');
    sel.value = '';
    attSelEmp = '';
  }

  // Build shift mark buttons - only shown for single employee view
  const markSec = document.getElementById('att-mark-section');
  markSec.style.display = mode === 'admin' ? 'none' : 'flex'; // hidden by default for admin until single emp selected
  if (mode === 'employee') {
    markSec.style.display = 'none'; // employee view: always read-only
  }

  document.getElementById('attendance-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderAttendanceCalendar();
}

function closeAttendanceModal() {
  document.getElementById('attendance-modal').classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}
function closeAttendanceOutside(e) {
  if (e.target === document.getElementById('attendance-modal')) closeAttendanceModal();
}

function attChangeMonth(delta) {
  attMonth += delta;
  if (attMonth > 11) { attMonth = 0; attYear++; }
  if (attMonth < 0)  { attMonth = 11; attYear--; }
  attSelDate = null;
  renderAttendanceCalendar();
}

function getAttKey(empId) {
  return `${empId}::${attYear}-${String(attMonth+1).padStart(2,'0')}`;
}
function getAttVal(empId, dateStr) {
  const key = getAttKey(empId);
  const v = attendance[key]?.[dateStr];
  return (v === undefined || v === null) ? '' : v;
}
function setAttVal(empId, dateStr, val) {
  // Block marking future dates
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  if (dateStr > todayStr) {
    showMsg('Future Date', 'You cannot mark attendance for a future date.<br>Today is <strong>' + todayStr + '</strong>.', 'warn');
    return;
  }
  const key = getAttKey(empId);
  if (!attendance[key]) attendance[key] = {};
  if (val === '') delete attendance[key][dateStr];
  else attendance[key][dateStr] = val;
  saveAttendance();
  // Auto-fill days worked for any employee currently selected in weekly salary form
  const selectedEmpId = document.getElementById('f-id')?.value?.trim();
  if (selectedEmpId) autoFillDaysWorked(selectedEmpId);
  // Live-refresh monthly salary calculator if it's open for this same employee
  if (typeof msSelEmp !== 'undefined' && msSelEmp === empId) renderMonthlySalCalc();
  // Live-refresh weekly calendar if visible
  if (weeklyCalVisible) renderWeeklyCalendar();
}

function markAttendanceShift(val) {
  if (!attSelDate && val !== '') {
    showMsg('No Date Selected', 'Please click a day on the calendar first, then mark its shift.', 'warn');
    return;
  }
  if (attMode !== 'admin') return;

  const empId = attSelEmp || null;
  if (!empId) {
    // Mark ALL active employees
    Object.values(employeeMaster).filter(m=>!m.inactive).forEach(m => setAttVal(m.empId, attSelDate, val));
  } else {
    setAttVal(empId, attSelDate, val);
  }
  renderAttendanceCalendar();
}

// Legacy support
function markAttendance(s) {
  const map = {'P':1,'A':'A','H':0.5,'-':'-',''  :''};
  markAttendanceShift(map[s] !== undefined ? map[s] : s);
}

function bulkMarkMonth() {
  const empId = attSelEmp;
  if (!empId) { showMsg('Select Employee', 'Please select a specific employee from the dropdown to bulk-mark.', 'warn'); return; }
  const daysInMonth = new Date(attYear, attMonth+1, 0).getDate();
  const mm = String(attMonth+1).padStart(2,'0');
  for (let d=1; d<=daysInMonth; d++) {
    const ds  = `${attYear}-${mm}-${String(d).padStart(2,'0')}`;
    const dow = new Date(attYear, attMonth, d).getDay();
    const cur = getAttVal(empId, ds);
    if (cur === '') {
      setAttVal(empId, ds, dow === 0 ? '-' : 1); // Sunday → holiday, others → 1 shift
    }
  }
  renderAttendanceCalendar();
  showToast('✅ Bulk marked — Sundays as Holiday, other days as 1 Shift.');
}

function renderAttendanceCalendar() {
  if (attMode === 'admin') {
    attSelEmp = document.getElementById('att-emp-filter')?.value || '';
  }
  // Show shift mark buttons only when a single employee is focused
  const markSec = document.getElementById('att-mark-section');
  const showMarkBtns = attMode === 'admin' && !!attSelEmp;
  if (showMarkBtns) {
    markSec.style.display = 'flex';
    const selEmpObj = employeeMaster[attSelEmp];
    const isMonthlyEmp = selEmpObj && selEmpObj.salaryType === 'monthly';

    // Monthly-salary employees get Half Day (Morning/Evening), Full Day, Absent.
    // Weekly-salary employees keep the shift-based buttons.
    const markBtns = isMonthlyEmp ? [
      { val: 'HM', label: 'Half Day – Morning', color: '#e6a817' },
      { val: 'HE', label: 'Half Day – Evening', color: '#1565c0' },
      { val: 'FD', label: 'Full Day',           color: '#2e7d32' },
      { val: 'A',  label: 'Absent',             color: '#c62828' },
    ] : [
      { val: 0.5,  label: '½ Shift',  color: '#e6a817' },
      { val: 1,    label: '1 Shift',  color: '#2e7d32' },
      { val: 1.5,  label: '1½ Shift', color: '#1565c0' },
      { val: 2,    label: '2 Shifts', color: '#6a0dad' },
      { val: 'A',  label: 'Absent',   color: '#c62828' },
    ];
    markSec.innerHTML = `<span style="font-size:11px;color:var(--muted);font-weight:600;white-space:nowrap;">Mark:</span>` +
      markBtns.map(s => {
        // Use data attribute to avoid JSON.stringify quoting issues with string values
        const dataVal = typeof s.val === 'string' ? `data-sval="${s.val}"` : `data-nval="${s.val}"`;
        return `<button class="btn att-mark-btn" ${dataVal}
          style="background:${s.color}20;border-color:${s.color}60;color:${s.color};"
          onclick="markAttendanceShift(this.dataset.nval!==undefined?Number(this.dataset.nval):this.dataset.sval)"
          >${s.label}</button>`;
      }).join('') +
      `<button class="btn btn-ghost" style="height:26px;padding:0 8px;font-size:10px;" onclick="markAttendanceShift('')">✕ Clear</button>`;
  } else {
    markSec.style.display = 'none';
  }

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('att-month-label').textContent = monthNames[attMonth] + ' ' + attYear;

  const wrap = document.getElementById('att-calendar-wrap');
  const daysInMonth = new Date(attYear, attMonth+1, 0).getDate();
  const firstDay    = new Date(attYear, attMonth, 1).getDay(); // 0=Sun

  let empsToShow = [];
  if (attMode === 'employee') {
    empsToShow = currentEmpId ? [employeeMaster[currentEmpId]].filter(Boolean) : [];
  } else {
    if (attSelEmp) {
      empsToShow = [employeeMaster[attSelEmp]].filter(Boolean);
    } else {
      empsToShow = Object.values(employeeMaster).filter(m => {
        if (m.inactive) return false;
        if (attCat === 'weekly')  return (m.salaryType||'weekly') === 'weekly';
        if (attCat === 'monthly') return m.salaryType === 'monthly';
        return true;
      });
    }
  }

  if (empsToShow.length === 1) {
    // ── SINGLE-EMPLOYEE calendar grid ─────────────────────
    const emp = empsToShow[0];
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    let html = `<div class="att-cal-grid">`;
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d =>
      html += `<div class="att-day-hdr">${d}</div>`
    );
    for (let i=0; i<firstDay; i++) html += `<div class="att-day-cell att-empty"></div>`;

    const todayFull = new Date();
    const todayStr2 = `${todayFull.getFullYear()}-${String(todayFull.getMonth()+1).padStart(2,'0')}-${String(todayFull.getDate()).padStart(2,'0')}`;

    for (let d=1; d<=daysInMonth; d++) {
      const mm  = String(attMonth+1).padStart(2,'0');
      const ds  = `${attYear}-${mm}-${String(d).padStart(2,'0')}`;
      const val = getAttVal(emp.empId, ds);
      const si  = getShiftInfo(val);
      const isToday    = ds === todayStr;
      const isSelected = ds === attSelDate;
      const isSun      = new Date(attYear, attMonth, d).getDay() === 0;
      const isFuture   = ds > todayStr2;

      html += `<div class="att-day-cell${si?' '+si.cls:''}${isToday?' att-today':''}${isSelected?' att-selected':''}${isSun&&!si?' att-sunday':''}${isFuture?' att-future':''}"
        onclick="attSelectDate('${ds}')" title="${isFuture?'Future date — cannot mark':si?si.title:isToday?'Today':''}">
        <span class="att-day-num">${d}</span>
        ${si ? `<span class="att-shift-badge" style="background:${si.color};">${si.label}</span>` : ''}
        ${isToday ? `<span class="att-today-dot"></span>` : ''}
      </div>`;
    }
    html += '</div>';
    wrap.innerHTML = html;
    renderAttSummary([emp]);

  } else {
    // ── MULTI-EMPLOYEE table view ──────────────────────────
    const mm = String(attMonth+1).padStart(2,'0');
    let html = `<div style="overflow-x:auto;"><table class="att-table"><thead><tr>
      <th style="min-width:130px;position:sticky;left:0;background:var(--navy);z-index:2;">Employee</th>`;
    for (let d=1; d<=daysInMonth; d++) {
      const dow = new Date(attYear, attMonth, d).getDay();
      html += `<th style="width:26px;font-size:9px;${dow===0?'color:#f88;':''}${dow===6?'color:#ffc;':''}">${d}</th>`;
    }
    html += `<th style="min-width:44px;background:#1a3a1a;color:#8fda8f;">Shifts</th>
             <th style="min-width:44px;background:#3a1a1a;color:#f88;">Abs</th></tr></thead><tbody>`;

    empsToShow.forEach(emp => {
      let totalShifts=0, absentDays=0;
      html += `<tr><td style="font-weight:600;font-size:11px;position:sticky;left:0;background:var(--white);z-index:1;white-space:nowrap;">${escHtml(emp.name)}<br><span style="font-size:9px;color:var(--muted);">${escHtml(emp.empId)}</span></td>`;
      for (let d=1; d<=daysInMonth; d++) {
        const ds  = `${attYear}-${mm}-${String(d).padStart(2,'0')}`;
        const val = getAttVal(emp.empId, ds);
        const si  = getShiftInfo(val);
        if (typeof val === 'number') totalShifts += val;
        else if (val==='P') totalShifts += 1;
        else if (val==='H') totalShifts += 0.5;
        else if (val==='FD') totalShifts += 1;
        else if (val==='HM' || val==='HE') { totalShifts += 0.5; absentDays += 0.5; }
        else if (val==='A') absentDays++;
        const dow = new Date(attYear, attMonth, d).getDay();
        const bgSun = dow===0 && !si ? 'background:#fff5f5;' : '';
        html += `<td class="${si?si.cls:''}" onclick="attSelectDateEmp('${ds}','${escHtml(emp.empId)}')"
          style="cursor:pointer;text-align:center;font-size:10px;font-weight:800;${bgSun}"
          title="${si?si.title:''}">${si?si.label:''}</td>`;
      }
      html += `<td style="text-align:center;color:var(--green);font-weight:800;font-size:12px;">${totalShifts}</td>
               <td style="text-align:center;color:var(--accent);font-weight:800;font-size:12px;">${absentDays}</td></tr>`;
    });
    html += '</tbody></table></div>';
    wrap.innerHTML = html;
    renderAttSummary(empsToShow);
  }
}

function attSelectDate(dateStr) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  if (dateStr > todayStr) {
    showMsg('Future Date', 'You cannot mark attendance for a future date.', 'warn');
    return;
  }
  attSelDate = dateStr;
  renderAttendanceCalendar();
}
function attSelectDateEmp(dateStr, empId) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  if (dateStr > todayStr) {
    showMsg('Future Date', 'You cannot mark attendance for a future date.', 'warn');
    return;
  }
  attSelDate = dateStr;
  attSelEmp  = empId;
  const sel = document.getElementById('att-emp-filter');
  if (sel) sel.value = empId;
  renderAttendanceCalendar();
}

function renderAttSummary(emps) {
  const bar = document.getElementById('att-summary-bar');
  const mm  = String(attMonth+1).padStart(2,'0');
  let totShifts=0, totAbsent=0, totHoliday=0, totDaysWorked=0;
  const isSingleMonthly = emps.length===1 && employeeMaster[emps[0]?.empId]?.salaryType === 'monthly';
  emps.forEach(emp => {
    const key = `${emp.empId}::${attYear}-${mm}`;
    const rec = attendance[key] || {};
    Object.values(rec).forEach(v => {
      if (typeof v==='number')      { totShifts += v; totDaysWorked += v; }
      else if (v==='P')             { totShifts += 1; totDaysWorked += 1; }
      else if (v==='H')             { totShifts += 0.5; totDaysWorked += 0.5; }
      else if (v==='FD')            { totDaysWorked += 1; }
      else if (v==='HM' || v==='HE'){ totDaysWorked += 0.5; totAbsent += 0.5; }
      else if (v==='A')             totAbsent++;
      else if (v==='-')             totHoliday++;
    });
  });

  if (isSingleMonthly) {
    bar.innerHTML = `
      <div class="att-sum-pill" style="background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;">Days Worked: <strong>${totDaysWorked}</strong></div>
      <div class="att-sum-pill" style="background:#ffebee;color:#c62828;border-color:#ef9a9a;">Absent: <strong>${totAbsent}</strong></div>`;
    return;
  }

  bar.innerHTML = `
    <div class="att-sum-pill" style="background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;">Total Shifts: <strong>${totShifts}</strong></div>
    <div class="att-sum-pill" style="background:#ffebee;color:#c62828;border-color:#ef9a9a;">Absent: <strong>${totAbsent}</strong></div>
    <div class="att-sum-pill" style="background:var(--offwhite);color:var(--navy);">Eff. Days: <strong>${(totShifts/(emps.length===1?(employeeMaster[emps[0]?.empId]?.shiftsPerDay||2):2)).toFixed(1)}</strong></div>`;
}

/* ── Escape key ─────────────────────────────────────────── */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closePreview();closeMasterModal();closeSettingsModal();closeHistoryModal();closeMsgBox();closeAttendanceModal();closeForgotModal();closeMonthlySalModal();closeAddAdvanceModal();closeAdvanceLedgerModal();closeEmpProfilePageModal();}
});
