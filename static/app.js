const API = {
  get: async (url) => (await fetch(url)).json(),
  put: async (url, data) => (await fetch(url, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)})).json(),
  post: async (url, data) => (await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)})).json()
};

let state = { calView: 'month', calDate: new Date(), selectedDate: null, catFilter: 'all', rateCat: 'all' };
const TODAY = new Date();
const START = new Date(2026, 6, 31);
const END = new Date(2026, 10, 28);

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtCN(d) {
  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initCalendar();
  initCourseTabs();
  initRateTabs();
  initRateSubmit();
  switchTab('today');
});

// =========== Tab Bar ===========
function initTabs() {
  document.getElementById('tabBar').addEventListener('click', e => {
    const tab = e.target.closest('.tab-item');
    if (!tab) return;
    switchTab(tab.dataset.tab);
  });
}
function switchTab(name) {
  document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page' + name[0].toUpperCase() + name.slice(1)));
  if (name === 'today') loadToday();
  else if (name === 'habits') loadHabits();
  else if (name === 'calendar') renderCalendar();
  else if (name === 'courses') loadCourses(state.catFilter);
  else if (name === 'stats') loadStats();
}

// =========== Today ===========
async function loadToday() {
  const opts = {year:'numeric',month:'long',day:'numeric',weekday:'long'};
  document.getElementById('todayDate').textContent = TODAY.toLocaleDateString('zh-CN', opts);

  const data = await API.get('/api/schedule?date=' + fmt(TODAY));
  const habits = await API.get('/api/habits?date=' + fmt(TODAY));
  const courses = await API.get('/api/courses');
  const stats = await API.get('/api/courses/stats');

  const ts = data.length;
  const done = data.filter(c => c.completed_sessions >= c.total_sessions).length;
  document.getElementById('todaySub').textContent = ts > 0 ? `今日 ${done}/${ts} 课已完成` : '今日暂无课程';

  // Habits
  const hList = document.getElementById('todayHabits');
  const activeHabits = habits.filter(h => h.log_id);
  hList.innerHTML = activeHabits.length > 0
    ? activeHabits.map(h => renderHabit(h)).join('')
    : '<div class="card-row" style="justify-content:center;color:var(--text2);">暂无习惯安排</div>';
  hList.querySelectorAll('.ring-chk').forEach(el => {
    el.addEventListener('click', () => toggleHabit(el.dataset.logId, el));
  });

  // Courses
  const cList = document.getElementById('todayCourses');
  cList.innerHTML = data.map(c => renderCourseRow(c)).join('');
  cList.querySelectorAll('.chk-circle').forEach(el => {
    el.addEventListener('click', () => toggleCourse(parseInt(el.dataset.cid), el));
  });

  // Stats panel
  const ov = stats.overall;
  document.getElementById('statsPanel').innerHTML = `
    <div class="stats-row">
      <div class="stat-cell"><div class="stat-num">${ov.done}</div><div class="stat-lbl">已完成</div></div>
      <div class="stat-cell"><div class="stat-num">${ov.total - ov.done}</div><div class="stat-lbl">待完成</div></div>
      <div class="stat-cell"><div class="stat-num">${ov.total > 0 ? Math.round(ov.done/ov.total*100) : 0}%</div><div class="stat-lbl">总进度</div></div>
    </div>`;

  document.getElementById('statsByCat').innerHTML = stats.by_category.map(s => {
    const pct = s.total_sessions > 0 ? Math.round(s.completed_sessions / s.total_sessions * 100) : 0;
    const color = s.category === '行测' ? '#1d1d1f' : s.category === '申论' ? '#3a3a3c' : '#8e8e93';
    return `<div class="prog-card">
      <div class="prog-header">
        <span class="prog-name">${s.category}</span>
        <span class="prog-text">${s.completed_sessions}/${s.total_sessions} (${pct}%)</span>
      </div>
      <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  }).join('');
}

// =========== Habits ===========
async function loadHabits() {
  const d = new Date();
  document.getElementById('habitsDate').textContent = d.toLocaleDateString('zh-CN', {year:'numeric',month:'long',day:'numeric',weekday:'long'});
  const habits = await API.get('/api/habits?date=' + fmt(d));
  const list = document.getElementById('habitsList');
  const active = habits.filter(h => h.log_id);
  list.innerHTML = active.length > 0
    ? active.map(h => renderHabit(h)).join('')
    : '<div class="card-row" style="justify-content:center;color:var(--text2);">今日无习惯</div>';
  list.querySelectorAll('.ring-chk').forEach(el => {
    el.addEventListener('click', () => toggleHabit(el.dataset.logId, el));
  });
  const done = active.filter(h => h.completed === 1).length;
  document.getElementById('habitsSub').textContent = `${done}/${active.length} 已完成`;
}

function renderHabit(h) {
  const done = h.completed === 1;
  return `<div class="card-row">
    <div class="ring-chk ${done ? 'done' : ''}" data-log-id="${h.log_id || ''}" data-hid="${h.id}"></div>
    <div class="row-info">
      <div class="row-title ${done ? 'done' : ''}">${h.name}</div>
      <div class="row-sub">${h.frequency === 'daily' ? '每日' : '隔日'}</div>
    </div>
  </div>`;
}

async function toggleHabit(logId, el) {
  if (!logId || logId === '' || logId === 'null') return;
  const isDone = el.classList.contains('done');
  el.classList.toggle('done', !isDone);
  try {
    await API.put(`/api/habits/${parseInt(logId)}`, {completed: !isDone});
    if (document.getElementById('pageHabits').classList.contains('active')) loadHabits();
  } catch(e) { el.classList.toggle('done', isDone); }
}

// =========== Calendar Table ===========
function initCalendar() {
  document.getElementById('calPrev').addEventListener('click', () => { navCal(-1); });
  document.getElementById('calNext').addEventListener('click', () => { navCal(1); });
  document.querySelectorAll('.view-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.calView = b.dataset.view;
      renderCalendar();
    });
  });
}

function navCal(dir) {
  if (state.calView === 'month') {
    state.calDate.setMonth(state.calDate.getMonth() + dir);
  } else {
    state.calDate.setDate(state.calDate.getDate() + dir * 7);
  }
  renderCalendar();
}

async function renderCalendar() {
  const y = state.calDate.getFullYear(), m = state.calDate.getMonth();
  let s, e;
  if (state.calView === 'month') {
    const first = new Date(y, m, 1), last = new Date(y, m+1, 0);
    s = new Date(first); s.setDate(s.getDate() - ((s.getDay()+6)%7));
    e = new Date(last); e.setDate(e.getDate() + (7 - ((last.getDay()+6)%7) - 1));
    document.getElementById('calTitle').textContent = `${y}年${m+1}月`;
  } else {
    const dow = (state.calDate.getDay()+6)%7;
    s = new Date(state.calDate); s.setDate(s.getDate() - dow);
    e = new Date(s); e.setDate(s.getDate() + 6);
    document.getElementById('calTitle').textContent = `${s.getMonth()+1}/${s.getDate()}-${e.getMonth()+1}/${e.getDate()}`;
  }

  const tableData = await API.get(`/api/schedule/table?start=${fmt(s)}&end=${fmt(e)}`);
  const dates = tableData.dates;
  const data = tableData.data;

  // Update title
  const setTitle = state.calView === 'month' ? `${y}年${m+1}月` : `${s.getMonth()+1}/${s.getDate()}-${e.getMonth()+1}/${e.getDate()}`;
  document.getElementById('calTitle').textContent = setTitle;

  const tbody = document.getElementById('calBody');
  tbody.innerHTML = '';

  const todayStr = fmt(TODAY);
  const weekdays = ['','一','二','三','四','五','六','日'];

  dates.forEach(d => {
    if (d < fmt(s) || d > fmt(e)) return;
    const dt = new Date(d);
    const isToday = d === todayStr;
    const isOther = state.calView === 'month' && dt.getMonth() !== m;
    const dayIdx = (dt.getDay() + 6) % 7 + 1;

    const dayData = data[d] || {行测:[], 申论:[]};
    const xcCourses = dayData['行测'] || [];
    const slCourses = dayData['申论'] || [];
    const allCourses = [...xcCourses, ...slCourses];
    const total = allCourses.length;
    const done = allCourses.filter(c => c.course_done).length;

    const tr = document.createElement('tr');
    tr.className = (isToday ? 'today-row' : '') + (isOther ? ' other-month-row' : '');

    // Date cell
    tr.innerHTML = `
      <td class="date-cell">${d.substring(5)}</td>
      <td class="day-cell">${weekdays[dayIdx]}</td>
      <td class="xc-cell">${renderCourseChips(xcCourses, 'xc')}</td>
      <td class="sl-cell">${renderCourseChips(slCourses, 'sl')}</td>
      <td class="pct-cell">${total > 0 ? done + '/' + total : '-'}</td>
    `;

    tbody.appendChild(tr);
  });

  // Attach click handlers to chips
  // Course chip left-click: toggle completion
  tbody.querySelectorAll('.course-chip').forEach(el => {
    el.addEventListener('click', async (e) => {
      const cid = parseInt(el.dataset.cid);
      const isComplete = el.classList.contains('complete');
      await API.put(`/api/courses/${cid}/progress`, {completed: !isComplete});
      renderCalendar();
      loadCalRightPanel();
    });
    // Right-click: context menu
    el.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const sid = parseInt(el.dataset.sid);
      const cid = parseInt(el.dataset.cid);
      if (!sid) return;
      // Find the date from the parent row
      const row = el.closest('tr');
      const dateEl = row ? row.querySelector('.date-cell') : null;
      const dateStr = dateEl ? dateEl.textContent.trim().replace('/','-') : '';
      const fullDate = dateStr ? '2026-' + dateStr : '';
      showChipMenu(sid, cid, fullDate);
    });
  });

  // Right panel
  loadCalRightPanel();
  loadCalRightDetail();
}

function renderCourseChips(courses, cls) {
  if (!courses || courses.length === 0) return '<span class="cal-empty">-</span>';
  return courses.map(c => {
    const done = c.course_done;
    const sid = c.id || 0;
    return `<span class="course-chip ${cls} ${done ? 'complete' : ''}" data-cid="${c.course_id}" data-sid="${sid}" title="右键编辑">${c.short_name || ''}</span>`;
  }).join(' ');
}

async function loadCalRightPanel() {
  const courses = await API.get('/api/courses');
  document.getElementById('calCourseList').innerHTML = courses.map(c => {
    const pct = c.total_sessions > 0 ? Math.round(c.completed_sessions / c.total_sessions * 100) : 0;
    const color = c.category === '行测' ? '#1d1d1f' : '#3a3a3c';
    const badge = c.category === '行测' ? 'badge-xc' : 'badge-sl';
    return `<div class="prog-card">
      <div class="prog-header">
        <div>
          <div class="prog-name">${c.name}</div>
          <div class="prog-meta">${c.completed_sessions}/${c.total_sessions} 课时</div>
        </div>
        <span class="badge ${badge}">${c.category}</span>
      </div>
      <div class="prog-bar-track"><div class="prog-bar-fill ${pct === 100 ? 'done' : ''}" style="width:${pct}%;background:${color}"></div></div>
      <div class="prog-text">${pct}%</div>
    </div>`;
  }).join('');
}

async function loadCalRightDetail() {
  const detail = document.getElementById('calRightDetail');
  const todayCourses = await API.get('/api/schedule?date=' + fmt(TODAY));
  if (todayCourses.length === 0) {
    detail.innerHTML = '<div class="card-row" style="justify-content:center;color:var(--text2);">今日无课程</div>';
    return;
  }
  detail.innerHTML = todayCourses.map(c => renderCourseRow(c)).join('');
  detail.querySelectorAll('.chk-circle').forEach(el => {
    el.addEventListener('click', () => toggleCourse(parseInt(el.dataset.cid), el));
  });
}

// =========== Course Row (shared) ===========
function renderCourseRow(c) {
  const name = c.short_name || c.course_name || c.name || '';
  const session = c.session_label ? c.session_label.replace(/[「【].*?[」】]/g,'').trim() : '';
  const display = session || name;
  const done = c.completed_sessions >= c.total_sessions;
  const badge = c.category === '申论' ? 'badge-sl' : 'badge-xc';
  return `<div class="card-row">
    <div class="chk-circle ${done ? 'done' : ''}" data-cid="${c.course_id || c.id}"></div>
    <div class="row-info">
      <div class="row-title ${done ? 'done' : ''}">${display}</div>
      <div class="row-sub">${c.total_sessions || ''}课时</div>
    </div>
    <span class="badge ${badge}">${c.category || ''}</span>
  </div>`;
}

async function toggleCourse(courseId, el) {
  if (!courseId) return;
  const isDone = el.classList.contains('done');
  el.classList.toggle('done', !isDone);
  try {
    await API.put(`/api/courses/${courseId}/progress`, {completed: !isDone});
    // Refresh whichever view is active
    const activePage = document.querySelector('.page.active');
    if (activePage) {
      const id = activePage.id;
      if (id === 'pageToday') loadToday();
      else if (id === 'pageCalendar') { renderCalendar(); }
    }
  } catch(e) { el.classList.toggle('done', isDone); }
}

// =========== Courses Tab ===========
function initCourseTabs() {
  document.getElementById('courseTabs').addEventListener('click', e => {
    const tab = e.target.closest('.pill');
    if (!tab) return;
    document.querySelectorAll('#courseTabs .pill').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.catFilter = tab.dataset.cat;
    loadCourses(state.catFilter);
  });
}

async function loadCourses(cat) {
  const url = cat === 'all' ? '/api/courses' : `/api/courses?category=${cat}`;
  const courses = await API.get(url);
  const grid = document.getElementById('courseGrid');
  grid.innerHTML = courses.map(c => {
    const pct = c.total_sessions > 0 ? Math.round(c.completed_sessions / c.total_sessions * 100) : 0;
    const color = c.category === '行测' ? '#1d1d1f' : '#3a3a3c';
    const badge = c.category === '行测' ? 'badge-xc' : 'badge-sl';
    return `<div class="prog-card">
      <div class="prog-header">
        <div>
          <div class="prog-name">${c.name}</div>
          <div class="prog-meta">${c.completed_sessions}/${c.total_sessions} 课时</div>
        </div>
        <span class="badge ${badge}">${c.category}</span>
      </div>
      <div class="prog-bar-track"><div class="prog-bar-fill ${pct === 100 ? 'done' : ''}" style="width:${pct}%;background:${color}"></div></div>
      <div class="prog-text">${pct}%</div>
    </div>`;
  }).join('');

  // Stats on right
  const stats = await API.get('/api/courses/stats');
  const colors = {"行测":"#1d1d1f","申论":"#3a3a3c","健身":"#8e8e93"};
  document.getElementById('statsBars').innerHTML = stats.by_category.map(s => {
    const pct = s.total_sessions > 0 ? Math.round(s.completed_sessions / s.total_sessions * 100) : 0;
    return `<div class="prog-card">
      <div class="prog-header">
        <span class="prog-name">${s.category}</span>
        <span class="prog-meta">${s.completed_sessions}/${s.total_sessions} (${pct}%)</span>
      </div>
      <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${pct}%;background:${colors[s.category]||'#1d1d1f'}"></div></div>
    </div>`;
  }).join('');
  loadTips();
}

// =========== Stats ===========
function initRateTabs() {
  document.getElementById('rateTabs').addEventListener('click', e => {
    const tab = e.target.closest('.pill');
    if (!tab) return;
    document.querySelectorAll('#rateTabs .pill').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.rateCat = tab.dataset.rcat;
    loadRateChart();
  });
}
function initRateSubmit() {
  document.getElementById('rateSubmit').addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('rateValue').value);
    const note = document.getElementById('rateNote').value;
    if (isNaN(val) || val < 0 || val > 100) { alert('请输入0-100'); return; }
    const cat = state.rateCat === 'all' ? '行测' : state.rateCat;
    await API.post(`/api/correct-rates?category=${cat}`, {rate: val, note});
    document.getElementById('rateValue').value = '';
    document.getElementById('rateNote').value = '';
    loadRateChart();
  });
}

async function loadStats() {
  const stats = await API.get('/api/courses/stats');
  const colors = {"行测":"#1d1d1f","申论":"#3a3a3c","健身":"#8e8e93"};
  document.getElementById('statsPanelRight').innerHTML = stats.by_category.map(s => {
    const pct = s.total_sessions > 0 ? Math.round(s.completed_sessions / s.total_sessions * 100) : 0;
    return `<div class="prog-card">
      <div class="prog-header">
        <span class="prog-name">${s.category}</span>
        <span class="prog-meta">${s.completed_sessions}/${s.total_sessions} (${pct}%)</span>
      </div>
      <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${pct}%;background:${colors[s.category]||'#1d1d1f'}"></div></div>
    </div>`;
  }).join('');
  await loadRateChart();
  loadStatsTips();
}

async function loadRateChart() {
  const data = await API.get('/api/correct-rates');
  const container = document.getElementById('rateChart');
  let filtered = data;
  if (state.rateCat !== 'all') filtered = data.filter(r => r.category === state.rateCat);
  if (filtered.length === 0) {
    container.innerHTML = '<div class="chart-empty">暂无正确率数据<br><span style="font-size:12px;">刷题后在上方录入</span></div>';
    return;
  }
  filtered.sort((a,b) => a.date.localeCompare(b.date));
  const colors = {"行测":"#1d1d1f","申论":"#3a3a3c","健身":"#8e8e93"};
  const w = Math.max(container.clientWidth - 24, 260);
  const h = 180;
  const pad = {top:16, right:16, bottom:24, left:6};
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const grouped = {};
  filtered.forEach(r => { if(!grouped[r.category]) grouped[r.category]=[]; grouped[r.category].push(r); });
  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<line x1="${pad.left}" y1="${pad.top}" x2="${w-pad.right}" y2="${pad.top}" stroke="#e8e8ed" stroke-dasharray="4,2"/>`;
  svg += `<line x1="${pad.left}" y1="${pad.top+ch/2}" x2="${w-pad.right}" y2="${pad.top+ch/2}" stroke="#e8e8ed" stroke-dasharray="4,2"/>`;
  svg += `<line x1="${pad.left}" y1="${pad.top+ch}" x2="${w-pad.right}" y2="${pad.top+ch}" stroke="#e8e8ed"/>`;

  Object.keys(grouped).forEach((cat, ci) => {
    const points = grouped[cat];
    const color = colors[cat] || '#1d1d1f';
    const xStep = cw / Math.max(points.length-1, 1);
    let path = '';
    points.forEach((p, i) => {
      const x = pad.left + i * xStep;
      const y = pad.top + ch - (p.rate/100*ch);
      if (i === 0) path += `M${x},${y}`;
      else path += ` L${x},${y}`;
    });
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    points.forEach((p, i) => {
      const x = pad.left + i * xStep;
      const y = pad.top + ch - (p.rate/100*ch);
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="${color}" stroke="white" stroke-width="1.5"/>`;
    });
    if (Object.keys(grouped).length > 1) {
      svg += `<rect x="${pad.left+6}" y="${pad.top+6+ci*16}" width="8" height="8" rx="2" fill="${color}"/>`;
      svg += `<text x="${pad.left+18}" y="${pad.top+13+ci*16}" font-size="10" fill="#1d1d1f">${cat}</text>`;
    }
  });
  svg += '</svg>';
  container.innerHTML = svg;
}

function loadTips() {
  document.getElementById('tipsCard').innerHTML = getTipText();
}
function loadStatsTips() {
  document.getElementById('statsTips').innerHTML = getTipText();
}
function getTipText() {
  const now = new Date();
  if (now < START) return '备考计划尚未开始，建议提前预习行测基础题型。';
  if (now > END) return '课程阶段已结束，进入刷题冲刺期：每天一套行测真题限时120分钟，申论每周2-3篇大作文，重点复习错题，调整作息。';
  const total = Math.round((END-START)/(1000*60*60*24))+1;
  const passed = Math.round((now-START)/(1000*60*60*24))+1;
  const phase = passed <= 21
    ? '听课打基础阶段：跟上各科课程节奏，课后整理笔记，政治理论多花时间记忆。'
    : (passed <= 42
      ? '强化巩固阶段：行测开始专项练习，申论多动笔写，注意各科交叉复习。'
      : '冲刺收尾阶段：课程进入尾声，准备大量刷题，建议开始模考练习。');
  return `备考第 ${passed}/${total} 天 (${Math.round(passed/total*100)}%)。${phase}`;
}

// =========== Course Management ===========
async function showAddCourseModal() {
  const name = prompt('课程名称（如：粉笔-数量关系）');
  if (!name) return;
  const cat = prompt('分类（行测/申论/健身）', '行测');
  if (!cat || !['行测','申论','健身'].includes(cat)) return;
  const total = parseInt(prompt('总课时数', '1')) || 1;
  await API.post(`/api/courses?name=${encodeURIComponent(name)}&category=${encodeURIComponent(cat)}&total_sessions=${total}`);
  loadCourses(state.catFilter);
}

async function importCourses() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await fetch('/api/courses/import', { method: 'POST', body: form });
      const data = await r.json();
      alert(`导入完成！新增 ${data.added} 门课程`);
      loadCourses(state.catFilter);
      renderCalendar();
    } catch(err) {
      alert('导入失败：' + err.message);
    }
  };
  input.click();
}

// Calendar chip context menu
let contextMenu = null;

function showChipMenu(scheduleId, courseId, dateStr) {
  // Remove existing menu
  if (contextMenu) contextMenu.remove();

  const menu = document.createElement('div');
  menu.style.cssText = `
    position: fixed; z-index: 300;
    background: white; border-radius: 10px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    padding: 4px 0; min-width: 140px;
    font-size: 14px;
  `;

  const items = [
    { label: '修改日期', action: async () => {
      const newDate = prompt('新日期 (YYYY-MM-DD)', dateStr || '');
      if (!newDate) return;
      await API.put(`/api/schedule/${scheduleId}/date?date=${newDate}`);
      renderCalendar();
    }},
    { label: '删除此项', action: async () => {
      if (!confirm('确定删除此项课程安排？')) return;
      await API.delete(`/api/schedule/${scheduleId}`);
      renderCalendar();
    }},
    { label: '取消', action: () => {} }
  ];

  items.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.style.cssText = `
      display: block; width: 100%; padding: 10px 16px;
      border: none; background: none; text-align: left;
      cursor: pointer; font-size: 14px; font-family: inherit;
      ${i < items.length - 1 ? 'border-bottom: 0.5px solid #e8e8ed;' : ''}
    `;
    if (i === items.length - 1) btn.style.color = '#ff3b30';
    btn.onclick = async () => {
      menu.remove();
      contextMenu = null;
      await item.action();
    };
    menu.appendChild(btn);
  });

  // Position near click
  menu.style.left = '50%';
  menu.style.top = '50%';
  menu.style.transform = 'translate(-50%, -50%)';
  document.body.appendChild(menu);
  contextMenu = menu;

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', closeMenu, { once: true });
  }, 10);
}

function closeMenu() {
  if (contextMenu) { contextMenu.remove(); contextMenu = null; }
}

// Attach context menu to course chips
// This is handled in renderCalendar by adding right-click handler
