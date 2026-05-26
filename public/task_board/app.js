/**
 * TaskBoard — app.js
 * ルーター・全画面レンダリング・UI ロジック
 */

/* ============================================================
   ルーター
   ============================================================ */
let _currentPage = 'dashboard';

function navigate(page) {
  _currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${page}`);
  if (navEl) navEl.classList.add('active');
  renderPage(page);
  updateMorningBadge();
}

function renderPage(page) {
  const main = document.getElementById('main-content');
  main.innerHTML = '';
  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'morning':   renderMorningCheck(); break;
    case 'tasks':     renderTodayTasks(); break;
    case 'projects':  renderProjects(); break;
    case 'settings':  renderSettings(); break;
    default:          renderDashboard();
  }
}

/* ============================================================
   モーダル
   ============================================================ */
function openModal(contentHTML, title) {
  const overlay = document.getElementById('modal-overlay');
  const modal   = document.getElementById('modal');
  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title" id="modal-title-text">${title}</span>
      <button class="modal-close" onclick="closeModal()" aria-label="閉じる">✕</button>
    </div>
    ${contentHTML}
  `;
  overlay.classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function closeModalIfOutside(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

/* ============================================================
   トースト通知
   ============================================================ */
function showToast(message, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, 3200);
}

/* ============================================================
   共通ヘルパー
   ============================================================ */
/** メンバーアバター HTML */
function avatarHTML(member, size = 32) {
  if (!member) {
    return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.floor(size*0.38)}px;background:#334155">?</div>`;
  }
  const initials = member.name.replace(/\s/g, '').slice(0, 2);
  return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.floor(size*0.38)}px;background:${member.color}">${initials}</div>`;
}

/** タスクのフェーズ名取得 */
function getPhaseName(task) {
  if (!task.phaseId || !task.projectId) return '';
  const proj = DB.Projects.get(task.projectId);
  if (!proj) return '';
  return proj.phases?.find(p => p.id === task.phaseId)?.name ?? '';
}

/** タスクのプロジェクト表示名 */
function getProjectLabel(task) {
  if (!task.projectId) return '';
  const p = DB.Projects.get(task.projectId);
  return p ? `${p.clientName} / ${p.name}` : '（削除済みPJ）';
}

/** タスク担当者名 */
function getTaskOwnerLabel(task) {
  const member = DB.Members.get(task.memberId);
  return member ? member.name : '未設定';
}

/** 未登録案件の窓口デフォルト。佐久間/私/自分がいなければ先頭メンバー */
function getDefaultOwnerMemberId() {
  const members = DB.Members.all();
  const me = members.find(m => /佐久間|私|自分/.test(m.name));
  if (me) return me.id;
  const created = DB.Members.add({ name: '佐久間さん', color: '#3b82f6' });
  return created.id;
}

/** 残日数バッジ HTML */
function dayChipHTML(dateStr) {
  const d = DB.daysLeft(dateStr);
  if (d === null) return '';
  if (d < 0)  return `<span class="day-chip day-chip-over">超過 ${Math.abs(d)}日</span>`;
  if (d <= 3) return `<span class="day-chip day-chip-danger">残${d}日</span>`;
  if (d <= 7) return `<span class="day-chip day-chip-warn">残${d}日</span>`;
  return `<span class="day-chip day-chip-ok">残${d}日</span>`;
}

/** SVG アイコン小（stroke） */
function icon(path, size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${path}</svg>`;
}

/* ============================================================
   ダッシュボード
   ============================================================ */
function renderDashboard() {
  const main     = document.getElementById('main-content');
  const projects = DB.Projects.active();
  const members  = DB.Members.all();
  const todayTasks = DB.Tasks.todayTasks();
  const totalH   = todayTasks.reduce((s, t) => s + (t.estimatedHours || 0), 0);

  main.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h2>ダッシュボード</h2>
        <p>${new Date().toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric', weekday:'long' })}</p>
      </div>
    </div>
    <div class="page-body fade-in">

      <!-- 統計カード -->
      <div class="grid-3" style="margin-bottom:20px">
        <div class="stat-card">
          <div class="stat-value">${projects.length}</div>
          <div class="stat-label">進行中プロジェクト</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${todayTasks.length}</div>
          <div class="stat-label">本日の登録タスク数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalH.toFixed(1)}<span style="font-size:16px;font-weight:500">h</span></div>
          <div class="stat-label">本日の総稼働予定</div>
        </div>
      </div>

      <!-- プロジェクト進行状況 -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-title">
          ${icon('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>')}
          プロジェクト進行状況
        </div>
        ${renderDashProjectProgress(projects)}
      </div>

      <div class="grid-2" style="margin-bottom:16px">
        <!-- メンバー稼働状況 -->
        <div class="card">
          <div class="card-title">
            ${icon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>')}
            メンバー稼働状況（本日）
          </div>
          ${renderDashWorkload(members, todayTasks)}
        </div>

        <!-- 未完了トレンド -->
        <div class="card">
          <div class="card-title">
            ${icon('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>')}
            未完了タスクのトレンド
          </div>
          ${renderDashIncompleteTrend(members)}
        </div>
      </div>

      <!-- 納品日カレンダー -->
      <div class="card">
        <div class="card-title">
          ${icon('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>')}
          納品日カレンダー
        </div>
        ${renderDashCalendar(projects)}
      </div>

    </div>
  `;
}

/* ── ① プロジェクト進行状況 ── */
function renderDashProjectProgress(projects) {
  if (!projects.length) {
    return `<div class="empty-state" style="padding:24px">
      <div class="icon">📋</div>
      <div class="title">進行中のプロジェクトがありません</div>
      <div class="sub"><button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navigate('projects')">プロジェクトを追加</button></div>
    </div>`;
  }
  return projects.map(p => {
    const phases = p.phases || [];
    const stepsHTML = phases.map((ph, i) => {
      const cls = ph.status === 'done' ? 'done' : ph.status === 'active' ? 'active' : 'pending';
      const prefix = ph.status === 'done' ? '✓ ' : '';
      const arrow = i < phases.length - 1 ? '<span class="phase-arrow">›</span>' : '';
      return `<span class="phase-step ${cls}">${prefix}${ph.name}</span>${arrow}`;
    }).join('');
    return `
      <div style="padding:12px 0;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:14px">${p.clientName}</span>
          <span style="font-size:12px;color:var(--text-2)">${p.name}</span>
          ${p.deliveryDate ? dayChipHTML(p.deliveryDate) : ''}
          ${p.deliveryDate ? `<span style="font-size:11px;color:var(--text-3)">納品：${DB.fmtDate(p.deliveryDate)}</span>` : ''}
        </div>
        <div class="phase-steps">
          ${stepsHTML || '<span style="color:var(--text-3);font-size:12px">フェーズ未設定</span>'}
        </div>
      </div>
    `;
  }).join('');
}

/* ── ② メンバー稼働状況 ── */
const WL_COLORS = ['#6366f1','#a855f7','#ec4899','#f59e0b','#10b981','#06b6d4','#ef4444','#84cc16'];

function renderDashWorkload(members, todayTasks) {
  if (!members.length) {
    return `<div class="empty-state" style="padding:20px">
      <div class="icon">👥</div>
      <div class="title">メンバー未登録</div>
    </div>`;
  }
  const MAX_H = 8;
  return members.map(m => {
    const mTasks = todayTasks.filter(t => t.memberId === m.id);
    const total  = mTasks.reduce((s, t) => s + (t.estimatedHours || 0), 0);
    if (!mTasks.length) {
      return `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:8px">
            ${avatarHTML(m, 28)}
            <span style="font-size:13px;font-weight:500">${m.name}</span>
            <span class="tag" style="background:var(--warning-lite);color:var(--warning);margin-left:auto">未登録</span>
          </div>
        </div>`;
    }
    const segs = mTasks.map((t, i) => {
      const pct = Math.min(((t.estimatedHours || 0) / MAX_H) * 100, 100);
      return `<div class="workload-seg" style="width:${pct}%;background:${WL_COLORS[i % WL_COLORS.length]};opacity:.8" title="${getProjectLabel(t)}: ${t.estimatedHours}h"></div>`;
    }).join('');
    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          ${avatarHTML(m, 28)}
          <span style="font-size:13px;font-weight:500">${m.name}</span>
          <span style="font-size:13px;font-weight:700;color:var(--primary);margin-left:auto">${total}h</span>
        </div>
        <div class="workload-bar"><div class="workload-segments">${segs}</div></div>
        <div style="margin-top:4px">
          ${mTasks.map(t => {
            const pLabel = getProjectLabel(t);
            return `<div style="font-size:11px;color:var(--text-2)">・${pLabel ? pLabel.split('/')[1]?.trim() || pLabel : 'タスク'} ${t.estimatedHours}h</div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
}

/* ── ④ 未完了タスクのトレンド ── */
function renderDashIncompleteTrend(members) {
  if (!members.length) {
    return `<div class="empty-state" style="padding:20px"><div class="icon">📊</div><div class="title">データなし</div></div>`;
  }
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const allTasks = DB.Tasks.all();

  const headers = days.map(d => {
    const dt = new Date(d + 'T00:00:00');
    return `<th>${dt.getMonth()+1}/${dt.getDate()}</th>`;
  }).join('');

  const rows = members.map(m => {
    const streak = DB.Tasks.consecutiveIncompleteDays(m.id);
    const cells = days.map(day => {
      const dt = allTasks.filter(t => t.memberId === m.id && t.date === day);
      if (!dt.length) return `<td><span style="color:var(--text-3);font-size:11px">－</span></td>`;
      const hasIncomplete = dt.some(t => t.completed === false);
      const allDone       = dt.every(t => t.completed === true);
      const anyUnchecked  = dt.some(t => t.completed === null);
      if (allDone)      return `<td><span style="color:var(--success);font-size:14px">✓</span></td>`;
      if (hasIncomplete) return `<td><span style="color:var(--danger);font-size:14px">✗</span></td>`;
      if (anyUnchecked)  return `<td><span style="font-size:10px;color:var(--warning)">未確</span></td>`;
      return `<td>－</td>`;
    }).join('');
    const streakHTML = streak > 0 ? `<span class="streak-chip">🔥${streak}日</span>` : '';
    return `
      <tr>
        <td style="padding-right:8px;white-space:nowrap">
          <div style="display:flex;align-items:center;gap:5px">
            ${avatarHTML(m, 20)}
            <span style="font-size:12px">${m.name}</span>
            ${streakHTML}
          </div>
        </td>
        ${cells}
      </tr>`;
  }).join('');

  return `
    <div style="overflow-x:auto">
      <table class="trend-table">
        <thead><tr><th></th>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:12px;font-size:11px;color:var(--text-3);display:flex;gap:12px;flex-wrap:wrap">
      <span><span style="color:var(--success)">✓</span> 全完了</span>
      <span><span style="color:var(--danger)">✗</span> 未完了あり</span>
      <span>🔥 連続未完了</span>
    </div>`;
}

/* ── ⑤ 納品日カレンダー ── */
function renderDashCalendar(projects) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();

  // イベントマップ構築
  const events = {};
  projects.forEach(p => {
    if (p.deliveryDate) {
      (events[p.deliveryDate] = events[p.deliveryDate] || []).push({ label: `🎯 ${p.name}`, type: 'delivery' });
    }
    (p.phases || []).forEach(ph => {
      if (ph.dueDate) {
        (events[ph.dueDate] = events[ph.dueDate] || []).push({ label: `📌 ${p.name}：${ph.name}`, type: 'phase' });
      }
    });
  });

  let calHTML = `<div class="grid-2" style="gap:24px">`;
  for (let offset = 0; offset < 2; offset++) {
    const y  = (month + offset >= 12) ? year + 1 : year;
    const mo = (month + offset) % 12;
    const firstDow   = new Date(y, mo, 1).getDay();
    const daysInMon  = new Date(y, mo + 1, 0).getDate();
    const monthLabel = new Date(y, mo, 1).toLocaleDateString('ja-JP', { year:'numeric', month:'long' });

    let cells = '';
    ['日','月','火','水','木','金','土'].forEach(w => {
      cells += `<div class="cal-head">${w}</div>`;
    });
    for (let i = 0; i < firstDow; i++) cells += '<div></div>';
    for (let d = 1; d <= daysInMon; d++) {
      const dateStr = `${y}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateStr === DB.today();
      const evList  = events[dateStr] || [];
      const hasEv   = evList.length > 0;
      const tip     = evList.map(e => e.label).join('\n');
      cells += `
        <div class="cal-day ${isToday ? 'today' : ''} ${hasEv && !isToday ? 'has-event' : ''}"
             title="${tip}">
          <span>${d}</span>
          ${hasEv ? '<div class="cal-day-dot"></div>' : ''}
        </div>`;
    }
    calHTML += `
      <div>
        <div style="text-align:center;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px">${monthLabel}</div>
        <div class="cal-grid">${cells}</div>
      </div>`;
  }
  calHTML += `</div>`;

  // 今後のイベント一覧
  const upcoming = Object.entries(events)
    .filter(([d]) => d >= DB.today())
    .sort(([a],[b]) => a.localeCompare(b))
    .slice(0, 8);

  if (upcoming.length) {
    calHTML += `<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:8px">今後のイベント</div>`;
    upcoming.forEach(([date, evs]) => {
      calHTML += `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:12px;color:var(--text-2);min-width:130px">${DB.fmtDate(date)}</span>
          <span style="font-size:12px;flex:1">${evs.map(e => e.label).join('　')}</span>
          ${dayChipHTML(date)}
        </div>`;
    });
    calHTML += `</div>`;
  }
  return calHTML;
}

/* ============================================================
   朝のチェック
   ============================================================ */
function renderMorningCheck() {
  const main        = document.getElementById('main-content');
  const yesterdayTasks = DB.Tasks.yesterdayTasks();

  if (!yesterdayTasks.length) {
    main.innerHTML = `
      <div class="page-header"><div class="page-header-left">
        <h2>朝のチェック</h2>
        <p>${DB.fmtDate(DB.yesterday())} のタスク確認</p>
      </div></div>
      <div class="page-body fade-in">
        <div class="empty-state" style="margin-top:40px">
          <div class="icon">☀️</div>
          <div class="title">前日のタスクはありません</div>
          <div class="sub">「今日のタスク」からタスクを登録してください</div>
        </div>
      </div>`;
    updateMorningBadge();
    return;
  }

  // メンバーごとにグループ化
  const byMember = {};
  yesterdayTasks.forEach(t => {
    (byMember[t.memberId] = byMember[t.memberId] || []).push(t);
  });

  const unchecked = yesterdayTasks.filter(t => t.completed === null).length;
  const bannerHTML = unchecked === 0
    ? `<div class="banner banner-success">✓ 全員のチェックが完了しています！お疲れ様でした。</div>`
    : `<div class="banner banner-warning">⚠ ${unchecked}件のタスクが未確認です</div>`;

  const memberBlocks = Object.entries(byMember).map(([memberId, tasks]) => {
    const member   = DB.Members.get(memberId);
    const taskRows = tasks.map(t => morningTaskRow(t)).join('');
    const doneCount = tasks.filter(t => t.completed === true).length;
    const failCount = tasks.filter(t => t.completed === false).length;
    return `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          ${avatarHTML(member, 38)}
          <div>
            <div style="font-size:15px;font-weight:700">${member ? member.name : '（不明）'}</div>
            <div style="font-size:11px;color:var(--text-2)">
              ${tasks.length}件 　✓${doneCount}　✗${failCount}　未${tasks.length - doneCount - failCount}
            </div>
          </div>
        </div>
        ${taskRows}
      </div>`;
  }).join('');

  main.innerHTML = `
    <div class="page-header"><div class="page-header-left">
      <h2>朝のチェック</h2>
      <p>${DB.fmtDate(DB.yesterday())} のタスク確認</p>
    </div></div>
    <div class="page-body fade-in">
      ${bannerHTML}
      ${memberBlocks}
    </div>`;
  updateMorningBadge();
}

function morningTaskRow(task) {
  const phaseName   = getPhaseName(task);
  const projectLabel = getProjectLabel(task);
  const ownerLabel = getTaskOwnerLabel(task);
  const isDone   = task.completed === true;
  const isFail   = task.completed === false;

  const reasonHTML = isFail ? `
    <div style="margin-top:7px">
      <input type="text" class="form-input" style="font-size:12px;padding:5px 10px"
             placeholder="未完了の理由を入力..."
             value="${escHtml(task.incompleteReason || '')}"
             onchange="saveIncompleteReason('${task.id}', this.value)"
             id="reason-${task.id}">
    </div>` : '';

  return `
    <div class="task-row" id="morning-task-${task.id}">
      <div style="display:flex;gap:5px;padding-top:2px">
        <button class="check-btn ${isDone ? 'done' : ''}"
                onclick="markTaskComplete('${task.id}')"
                title="完了としてマーク" aria-label="完了">✓</button>
        <button class="check-btn ${isFail ? 'fail' : ''}"
                style="font-size:12px"
                onclick="markTaskFail('${task.id}')"
                title="未完了としてマーク" aria-label="未完了">✗</button>
      </div>
      <div class="flex-1">
        <div class="task-title" style="${isDone ? 'text-decoration:line-through;opacity:.45' : ''}">${escHtml(task.content)}</div>
        <div class="task-meta">
          <span>担当：${escHtml(ownerLabel)}</span>
          ${projectLabel ? `<span>${projectLabel}</span>` : ''}
          ${phaseName ? `<span class="tag tag-phase">${phaseName}</span>` : ''}
          <span class="tag-hours">${task.estimatedHours}h</span>
        </div>
        ${reasonHTML}
      </div>
    </div>`;
}

function markTaskComplete(taskId) {
  DB.Tasks.setCompletion(taskId, true, '');
  renderMorningCheck();
  showToast('完了としてマークしました', 'success');
}

function markTaskFail(taskId) {
  const task = DB.Tasks.get(taskId);
  if (!task) return;
  // トグル動作：既に失敗ならリセット
  if (task.completed === false) {
    DB.Tasks.setCompletion(taskId, null, '');
  } else {
    DB.Tasks.setCompletion(taskId, false, '');
  }
  renderMorningCheck();
}

function saveIncompleteReason(taskId, reason) {
  DB.Tasks.update(taskId, { incompleteReason: reason });
}

function updateMorningBadge() {
  const unchecked = DB.Tasks.yesterdayTasks().filter(t => t.completed === null).length;
  const badge = document.getElementById('morning-badge');
  if (!badge) return;
  if (unchecked > 0) {
    badge.textContent = unchecked;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* ============================================================
   今日のタスク
   ============================================================ */
let _taskFilter = { memberId: '', projectId: '' };
let _taskFormData = { memberId: '', projectId: '', phaseId: '', content: '', estimatedHours: 1, note: '' };
let _bulkTaskData = { memberId: '', ownerMemberId: '', text: '', preview: null };

function renderTodayTasks() {
  const main       = document.getElementById('main-content');
  const members    = DB.Members.all();
  const projects   = DB.Projects.active();
  const todayTasks = DB.Tasks.todayTasks();

  // フィルタ適用
  const filtered = todayTasks.filter(t => {
    if (_taskFilter.memberId  && t.memberId  !== _taskFilter.memberId)  return false;
    if (_taskFilter.projectId && t.projectId !== _taskFilter.projectId) return false;
    return true;
  });

  const totalH = filtered.reduce((s, t) => s + (t.estimatedHours || 0), 0);

  // メンバーグループ
  const byMember = {};
  filtered.forEach(t => (byMember[t.memberId] = byMember[t.memberId] || []).push(t));

  const memberOpts  = members.map(m => `<option value="${m.id}" ${_taskFilter.memberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const projectOpts = projects.map(p => `<option value="${p.id}" ${_taskFilter.projectId === p.id ? 'selected' : ''}>${p.clientName} / ${p.name}</option>`).join('');

  main.innerHTML = `
    <div class="page-header"><div class="page-header-left">
      <h2>今日のタスク</h2>
      <p>${DB.fmtDate(DB.today())} の作業予定</p>
    </div></div>
    <div class="page-body fade-in">

      <div class="action-row">
        <div class="filter-bar">
          <select class="form-select" style="width:145px" id="filter-member"
                  onchange="_taskFilter.memberId=this.value;renderTodayTasks()">
            <option value="">全メンバー</option>${memberOpts}
          </select>
          <select class="form-select" style="width:210px" id="filter-project"
                  onchange="_taskFilter.projectId=this.value;renderTodayTasks()">
            <option value="">全プロジェクト</option>${projectOpts}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:13px;color:var(--text-2)">合計 <strong style="color:var(--primary)">${totalH}h</strong></span>
          <button class="btn btn-ghost" onclick="openBulkTaskModal()">
            一括入力
          </button>
          <button class="btn btn-primary" id="add-task-btn" onclick="openTaskModal(null)">
            ${icon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')}
            タスク追加
          </button>
        </div>
      </div>

      ${Object.keys(byMember).length === 0
        ? `<div class="empty-state">
            <div class="icon">📝</div>
            <div class="title">タスクがありません</div>
            <div class="sub" style="margin-top:10px">
              <button class="btn btn-primary btn-sm" onclick="openTaskModal(null)">タスクを追加する</button>
            </div>
          </div>`
        : Object.entries(byMember).map(([memberId, tasks]) => {
            const member = DB.Members.get(memberId);
            const mTotal = tasks.reduce((s, t) => s + (t.estimatedHours || 0), 0);
            return `
              <div class="card" style="margin-bottom:12px">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                  ${avatarHTML(member, 36)}
                  <div>
                    <div style="font-size:15px;font-weight:700">${member ? member.name : '（不明）'}</div>
                    <div style="font-size:11px;color:var(--text-2)">${tasks.length}件 / ${mTotal}h</div>
                  </div>
                </div>
                ${tasks.map(t => todayTaskRow(t)).join('')}
              </div>`;
          }).join('')}
    </div>`;
}

function todayTaskRow(task) {
  const phaseName    = getPhaseName(task);
  const projectLabel = getProjectLabel(task);
  const ownerLabel = getTaskOwnerLabel(task);
  return `
    <div class="task-row" id="task-row-${task.id}">
      <div class="task-accent-bar"></div>
      <div class="flex-1">
        <div class="task-title">${escHtml(task.content)}</div>
        ${task.note ? `<div class="task-note">備考：${escHtml(task.note)}</div>` : ''}
        <div class="task-meta">
          <span>担当：${escHtml(ownerLabel)}</span>
          ${projectLabel ? `<span>${projectLabel}</span>` : '<span style="color:var(--text-3)">プロジェクト未選択</span>'}
          ${phaseName ? `<span class="tag tag-phase">${phaseName}</span>` : ''}
          <span class="tag-hours">${task.estimatedHours}h</span>
        </div>
      </div>
      <div style="display:flex;gap:5px;align-items:center;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="openTaskModal('${task.id}')">編集</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">削除</button>
      </div>
    </div>`;
}

/* ─ タスクモーダル ─ */
function openTaskModal(editId) {
  const members  = DB.Members.all();
  const projects = DB.Projects.active();
  if (!members.length) {
    showToast('先にメンバーを登録してください', 'error');
    navigate('settings');
    return;
  }

  if (editId) {
    const t = DB.Tasks.get(editId);
    if (t) _taskFormData = { ...t };
  } else {
    _taskFormData = { memberId: '', projectId: '', phaseId: '', content: '', estimatedHours: 1, note: '' };
  }

  const memberOpts  = members.map(m =>
    `<option value="${m.id}" ${_taskFormData.memberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const projectOpts = `<option value="">プロジェクトを選択...</option>` +
    projects.map(p =>
      `<option value="${p.id}" ${_taskFormData.projectId === p.id ? 'selected' : ''}>${p.clientName} / ${p.name}</option>`).join('');
  const curPhases = _taskFormData.projectId ? (DB.Projects.get(_taskFormData.projectId)?.phases || []) : [];
  const phaseOpts = `<option value="">フェーズなし</option>` +
    curPhases.map(ph =>
      `<option value="${ph.id}" ${_taskFormData.phaseId === ph.id ? 'selected' : ''}>${ph.name}</option>`).join('');

  openModal(`
    <div class="form-group">
      <label class="form-label">担当者 *</label>
      <select class="form-select" id="tf-member" onchange="_taskFormData.memberId=this.value">
        <option value="">選択してください</option>${memberOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">プロジェクト</label>
      <select class="form-select" id="tf-project"
              onchange="_taskFormData.projectId=this.value;_taskFormData.phaseId='';refreshModalPhases()">
        ${projectOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">フェーズ</label>
      <select class="form-select" id="tf-phase" onchange="_taskFormData.phaseId=this.value">
        ${phaseOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">タスク内容 *</label>
      <textarea class="form-textarea" id="tf-content"
                placeholder="作業の説明を入力..."
                oninput="_taskFormData.content=this.value">${escHtml(_taskFormData.content || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">備考・問いかけ</label>
      <textarea class="form-textarea" id="tf-note"
                placeholder="困っていること、全員への確認、助けてほしいことなど"
                oninput="_taskFormData.note=this.value">${escHtml(_taskFormData.note || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">予測稼働時間（0.5h 単位）</label>
      <div class="hours-stepper">
        <button class="hours-btn" onclick="stepHours(-0.5)" type="button">－</button>
        <span class="hours-display" id="tf-hours-display">${_taskFormData.estimatedHours || 1}h</span>
        <button class="hours-btn" onclick="stepHours(0.5)" type="button">＋</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" id="task-save-btn"
              onclick="${editId ? `saveTask('${editId}')` : 'saveTask(null)'}">
        ${editId ? '更新する' : '追加する'}
      </button>
    </div>
  `, editId ? 'タスクを編集' : 'タスクを追加');
}

function refreshModalPhases() {
  const phases = _taskFormData.projectId
    ? (DB.Projects.get(_taskFormData.projectId)?.phases || []) : [];
  const sel = document.getElementById('tf-phase');
  if (!sel) return;
  sel.innerHTML = `<option value="">フェーズなし</option>` +
    phases.map(ph => `<option value="${ph.id}">${ph.name}</option>`).join('');
}

function stepHours(delta) {
  _taskFormData.estimatedHours = Math.max(0.5, Math.min(24,
    parseFloat((_taskFormData.estimatedHours || 1)) + delta));
  const disp = document.getElementById('tf-hours-display');
  if (disp) disp.textContent = `${_taskFormData.estimatedHours}h`;
}

function saveTask(editId) {
  const memberId = document.getElementById('tf-member')?.value;
  const content  = document.getElementById('tf-content')?.value?.trim();
  const note     = document.getElementById('tf-note')?.value?.trim() || '';
  if (!memberId) { showToast('担当者を選択してください', 'error'); return; }
  if (!content)  { showToast('タスク内容を入力してください', 'error'); return; }

  const payload = {
    memberId,
    projectId: _taskFormData.projectId || null,
    phaseId:   _taskFormData.phaseId   || null,
    content,
    note,
    estimatedHours: _taskFormData.estimatedHours || 1,
  };

  if (editId) {
    DB.Tasks.update(editId, payload);
    showToast('タスクを更新しました', 'success');
  } else {
    DB.Tasks.add(payload);
    showToast('タスクを追加しました', 'success');
  }
  closeModal();
  renderTodayTasks();
}

function deleteTask(taskId) {
  if (!confirm('このタスクを削除しますか？')) return;
  DB.Tasks.remove(taskId);
  showToast('タスクを削除しました', 'info');
  renderTodayTasks();
}

/* ─ タスク一括入力 ─ */
function openBulkTaskModal() {
  let members = DB.Members.all();
  if (!members.length) {
    showToast('先にメンバーを登録してください', 'error');
    navigate('settings');
    return;
  }

  if (!_bulkTaskData.ownerMemberId) _bulkTaskData.ownerMemberId = getDefaultOwnerMemberId();
  members = DB.Members.all();

  const memberOpts = members.map(m =>
    `<option value="${m.id}" ${_bulkTaskData.memberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const ownerOpts = members.map(m =>
    `<option value="${m.id}" ${_bulkTaskData.ownerMemberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');

  openModal(`
    <div class="form-group">
      <label class="form-label">タスク担当者 *</label>
      <select class="form-select" id="bulk-member">
        <option value="">選択してください</option>${memberOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">未登録案件の窓口</label>
      <select class="form-select" id="bulk-owner">
        <option value="">未入力なら私</option>${ownerOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">タスク本文 *</label>
      <textarea class="form-textarea bulk-textarea" id="bulk-text"
                placeholder="プロジェクト名, タスク, 時間, 内容, 備考&#10;〇〇株式会社 パンフレット, 表紙修正, 1, 赤字反映と画像差し替え, 写真素材の確認をお願いします&#10;△△商事 Web更新, お知らせ更新, 0.5, 原稿を反映して公開確認, 公開前にURL確認をお願いします">${escHtml(_bulkTaskData.text || '')}</textarea>
      <div class="form-help">
        1行に1タスク。最後の備考には、困っていること・全員への確認・助けてほしいことを書けます。
      </div>
    </div>
    <div id="bulk-preview">${_bulkTaskData.preview ? bulkPreviewHTML(_bulkTaskData.preview) : ''}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="copyBulkTaskTemplate()">依頼文をコピー</button>
      <button class="btn btn-ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-ghost" onclick="previewBulkTasks()">確認する</button>
      <button class="btn btn-primary" onclick="saveBulkTasks()">登録する</button>
    </div>
  `, 'タスク一括入力');
}

function previewBulkTasks() {
  const memberId = document.getElementById('bulk-member')?.value || '';
  const ownerMemberId = document.getElementById('bulk-owner')?.value || '';
  const text = document.getElementById('bulk-text')?.value || '';
  _bulkTaskData = { memberId, ownerMemberId, text, preview: parseBulkTaskText(text) };

  const previewEl = document.getElementById('bulk-preview');
  if (previewEl) previewEl.innerHTML = bulkPreviewHTML(_bulkTaskData.preview);
}

function saveBulkTasks() {
  const memberId = document.getElementById('bulk-member')?.value || '';
  const ownerMemberId = document.getElementById('bulk-owner')?.value || getDefaultOwnerMemberId();
  const text = document.getElementById('bulk-text')?.value || '';
  if (!memberId) { showToast('タスク担当者を選択してください', 'error'); return; }
  if (!ownerMemberId) { showToast('先にメンバーを登録してください', 'error'); return; }

  const parsed = parseBulkTaskText(text);
  const totalTasks = parsed.groups.reduce((sum, group) => sum + group.tasks.length, 0);
  if (!totalTasks) { showToast('登録できるタスクが見つかりません', 'error'); return; }

  parsed.groups.forEach(group => {
    const project = group.projectName
      ? findOrCreateBulkProject(group.projectName, ownerMemberId)
      : null;

    group.tasks.forEach(task => {
      DB.Tasks.add({
        memberId,
        projectId: project?.id || null,
        phaseId: null,
        content: task.content,
        note: task.note || '',
        estimatedHours: task.hours,
      });
    });
  });

  _bulkTaskData = { memberId, ownerMemberId, text: '', preview: null };
  closeModal();
  showToast(`${totalTasks}件のタスクを登録しました`, 'success');
  renderTodayTasks();
}

function parseBulkTaskText(text) {
  const chatParsed = parseChatTaskRows(text);
  if (chatParsed.groups.length) return chatParsed;

  const lines = (text || '').split(/\r?\n/).map(line => line.replace(/\t/g, '  '));
  const groups = [];
  let current = null;

  lines.forEach(raw => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    const isProjectLine = /^[・★]/.test(trimmed);
    const cleaned = cleanBulkLine(trimmed);
    const task = taskFromBulkLine(cleaned);

    if (isProjectLine) {
      if (current) groups.push(current);
      current = { projectName: task.content, tasks: [], sourceHours: task.hours };
      return;
    }

    if (!current) current = { projectName: '', tasks: [], sourceHours: null };
    current.tasks.push(task);
  });

  if (current) groups.push(current);

  groups.forEach(group => {
    if (!group.tasks.length && group.projectName) {
      group.tasks.push({ content: group.projectName, hours: group.sourceHours || 1 });
      group.projectName = '';
    }
  });

  return { groups: groups.filter(group => group.tasks.length) };
}

function parseChatTaskRows(text) {
  const rows = [];
  let labelled = {};

  (text || '').split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line) {
      pushLabelledTask(rows, labelled);
      labelled = {};
      return;
    }
    if (/^(プロジェクト名|プロジェクト|案件名|案件|タスク|作業|時間|工数|内容|詳細|備考|コメント|相談)\s*[:：]/.test(line)) {
      const [, key, value] = line.match(/^(プロジェクト名|プロジェクト|案件名|案件|タスク|作業|時間|工数|内容|詳細|備考|コメント|相談)\s*[:：]\s*(.*)$/) || [];
      if (key) {
        const normalizedKey = normalizeChatTaskKey(key);
        labelled[normalizedKey] = value.trim();
      }
      return;
    }

    const cells = splitTaskRow(line);
    if (cells.length >= 3 && !isBulkHeaderRow(cells)) {
      rows.push(rowToTask(cells));
    }
  });
  pushLabelledTask(rows, labelled);

  const groupsByProject = {};
  rows.filter(Boolean).forEach(row => {
    const projectName = row.projectName || '';
    if (!groupsByProject[projectName]) groupsByProject[projectName] = { projectName, tasks: [] };
    groupsByProject[projectName].tasks.push({
      content: row.content,
      hours: row.hours,
      note: row.note,
    });
  });

  return { groups: Object.values(groupsByProject).filter(group => group.tasks.length) };
}

function splitTaskRow(line) {
  return line
    .split(/\t|,|、/)
    .map(cell => cell.trim())
    .filter(Boolean);
}

function isBulkHeaderRow(cells) {
  return /^プロジェクト名タスク時間内容(備考|コメント|相談)?$/.test(cells.join('').replace(/\s/g, ''));
}

function normalizeChatTaskKey(key) {
  if (/プロジェクト|案件/.test(key)) return 'projectName';
  if (/タスク|作業/.test(key)) return 'task';
  if (/時間|工数/.test(key)) return 'hours';
  if (/備考|コメント|相談/.test(key)) return 'note';
  return 'detail';
}

function pushLabelledTask(rows, data) {
  if (!data || !Object.keys(data).length) return;
  if (!data.projectName && !data.task && !data.detail) return;
  rows.push(rowToTask([data.projectName || '', data.task || '', data.hours || '', data.detail || '', data.note || '']));
}

function rowToTask(cells) {
  const [projectName = '', taskName = '', hoursText = '', detail = '', ...noteParts] = cells;
  const hours = extractHours(hoursText);
  const contentParts = [taskName, detail].map(s => s.trim()).filter(Boolean);
  const note = noteParts.join('、').trim();
  return {
    projectName: projectName.trim(),
    content: contentParts.join(' - ') || '未入力タスク',
    hours,
    note,
  };
}

function extractHours(value) {
  const normalized = normalizeNumberText(String(value || ''));
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Math.max(0.5, parseFloat(match[1])) : 1;
}

async function copyBulkTaskTemplate() {
  const template = [
    '明日のタスクを以下の形式で送ってください。',
    '',
    '#task',
    'プロジェクト名, タスク, 時間, 内容, 備考',
    '例）〇〇株式会社 パンフレット, 表紙修正, 1, 赤字反映と画像差し替え, 写真素材の確認をお願いします',
    '例）△△商事 Web更新, お知らせ更新, 0.5, 原稿を反映して公開確認, 公開前にURL確認をお願いします',
    '',
    '※ 備考には、困っていること・全員への確認・助けてほしいことを書いてください。',
  ].join('\n');

  try {
    await navigator.clipboard.writeText(template);
    showToast('依頼文をコピーしました', 'success');
  } catch {
    showToast('コピーできませんでした。手動で選択してください', 'error');
  }
}

function cleanBulkLine(line) {
  return line
    .replace(/^[・★\s]+/, '')
    .replace(/^[➕＋+👉→\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function taskFromBulkLine(line) {
  const normalized = normalizeNumberText(line);
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:時間|h)/i);
  const hours = match ? Math.max(0.5, parseFloat(match[1])) : 1;
  const content = normalized.replace(/([0-9]+(?:\.[0-9]+)?)\s*(?:時間|h)/ig, '').trim();
  return { content: content || '未入力タスク', hours };
}

function normalizeNumberText(text) {
  const zen = '０１２３４５６７８９．';
  const han = '0123456789.';
  return text
    .replace(/[０-９．]/g, ch => han[zen.indexOf(ch)])
    .replace(/一時間/g, '1時間')
    .replace(/１時間/g, '1時間');
}

function findOrCreateBulkProject(projectName, ownerMemberId) {
  const parsed = parseProjectName(projectName);
  const projects = DB.Projects.active();
  const found = projects.find(p =>
    normalizeMatchText(`${p.clientName} ${p.name}`) === normalizeMatchText(`${parsed.clientName} ${parsed.name}`));
  if (found) return found;

  const isRecurring = Boolean(parsed.recurringSeries);
  return DB.Projects.add({
    clientName: parsed.clientName,
    name: parsed.name,
    projectType: isRecurring ? 'recurring' : 'provisional',
    recurringSeries: parsed.recurringSeries,
    ownerMemberId,
    isProvisional: true,
    detailsDueAt: tomorrowDate(),
  });
}

function parseProjectName(projectName) {
  const normalized = normalizeNumberText(projectName).replace(/\s+/g, ' ').trim();
  const monthly = normalized.match(/(.+?)\s*([0-9]{1,2})月号/);
  if (monthly) {
    const clientName = monthly[1].trim();
    const monthName = `${parseInt(monthly[2], 10)}月号`;
    return {
      clientName,
      name: monthName,
      recurringSeries: `${clientName} 月号`,
    };
  }

  const parts = normalized.split(/[／/]/).map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { clientName: parts[0], name: parts.slice(1).join(' / '), recurringSeries: '' };
  }
  return { clientName: normalized, name: '仮プロジェクト', recurringSeries: '' };
}

function normalizeMatchText(text) {
  return normalizeNumberText(text).replace(/\s+/g, '').toLowerCase();
}

function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function bulkPreviewHTML(parsed) {
  if (!parsed.groups.length) {
    return `<div class="bulk-preview empty">登録候補がありません</div>`;
  }

  return `
    <div class="bulk-preview">
      <div class="bulk-preview-title">登録前の確認</div>
      ${parsed.groups.map(group => {
        const project = group.projectName ? parseProjectName(group.projectName) : null;
        return `
          <div class="bulk-preview-group">
            <div class="bulk-project-name">
              ${project
                ? `${project.recurringSeries ? '<span class="status-badge recurring">定期</span>' : '<span class="status-badge provisional">仮登録</span>'} ${escHtml(project.clientName)} / ${escHtml(project.name)}`
                : '<span class="status-badge personal">個人タスク</span>'}
            </div>
            <ul>
              ${group.tasks.map(task => `
                <li>
                  <div>
                    ${escHtml(task.content)}
                    ${task.note ? `<div class="bulk-note">備考：${escHtml(task.note)}</div>` : ''}
                  </div>
                  <span>${task.hours}h</span>
                </li>`).join('')}
            </ul>
          </div>`;
      }).join('')}
    </div>`;
}

/* ============================================================
   プロジェクト
   ============================================================ */
let _projectView = 'active'; // 'active' | 'archived'

function renderProjects() {
  const main     = document.getElementById('main-content');
  const projects = _projectView === 'active' ? DB.Projects.active() : DB.Projects.archived();

  main.innerHTML = `
    <div class="page-header"><div class="page-header-left">
      <h2>プロジェクト</h2>
      <p>プロジェクトとフェーズの管理</p>
    </div></div>
    <div class="page-body fade-in">

      <div class="action-row">
        <div class="tab-bar" style="margin-bottom:0">
          <button class="btn ${_projectView==='active'   ? 'btn-primary' : 'btn-ghost'}"
                  onclick="_projectView='active';renderProjects()">進行中</button>
          <button class="btn ${_projectView==='archived' ? 'btn-primary' : 'btn-ghost'}"
                  onclick="_projectView='archived';renderProjects()">アーカイブ</button>
        </div>
        <button class="btn btn-primary" id="add-project-btn" onclick="openProjectModal(null)">
          ${icon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')}
          プロジェクト追加
        </button>
      </div>

      ${projects.length === 0
        ? `<div class="empty-state">
            <div class="icon">📂</div>
            <div class="title">${_projectView==='active' ? '進行中のプロジェクトがありません' : 'アーカイブはありません'}</div>
            ${_projectView==='active' ? '<div class="sub" style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="openProjectModal(null)">プロジェクトを追加</button></div>' : ''}
          </div>`
        : projects.map(p => projectCard(p)).join('')}
    </div>`;
}

function projectCard(project) {
  const phases    = project.phases || [];
  const allTasks  = DB.Tasks.all();
  const owner = project.ownerMemberId ? DB.Members.get(project.ownerMemberId) : null;
  const statusBadges = [
    project.projectType === 'recurring' ? '<span class="status-badge recurring">定期案件</span>' : '',
    project.isProvisional ? '<span class="status-badge provisional">仮登録</span>' : '',
  ].filter(Boolean).join('');

  const stepsHTML = phases.map((ph, i) => {
    const cls    = ph.status === 'done' ? 'done' : ph.status === 'active' ? 'active' : 'pending';
    const prefix = ph.status === 'done' ? '✓ ' : '';
    const arrow  = i < phases.length - 1 ? '<span class="phase-arrow">›</span>' : '';
    return `<span class="phase-step ${cls}" data-clickable
                  onclick="cyclePhaseStatus('${project.id}','${ph.id}')"
                  title="クリックでステータス変更">
              ${prefix}${ph.name}
            </span>${arrow}`;
  }).join('');

  const progressBars = phases.map(ph => {
    const pTasks = allTasks.filter(t => t.projectId === project.id && t.phaseId === ph.id);
    if (!pTasks.length) return '';
    const done = pTasks.filter(t => t.completed === true).length;
    const pct  = Math.round(done / pTasks.length * 100);
    return `
      <div style="margin-bottom:7px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <span style="font-size:12px;color:var(--text-2)">${ph.name}</span>
          <span style="font-size:11px;color:var(--text-3)">${done}/${pTasks.length} タスク</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).filter(Boolean).join('');

  const archiveBtn = project.archived
    ? `<button class="btn btn-success btn-sm" onclick="restoreProject('${project.id}')">復元</button>`
    : `<button class="btn btn-ghost  btn-sm" onclick="archiveProject('${project.id}')">アーカイブ</button>`;

  return `
    <div class="card" style="margin-bottom:14px" id="project-card-${project.id}">
      <!-- ヘッダー -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:800;font-size:15px">${escHtml(project.clientName)}</span>
            <span style="color:var(--text-2);font-size:13px">/ ${escHtml(project.name)}</span>
            ${statusBadges}
            ${project.deliveryDate ? dayChipHTML(project.deliveryDate) : ''}
          </div>
          <div style="font-size:11.5px;color:var(--text-3);margin-top:3px;display:flex;gap:12px;flex-wrap:wrap">
            ${project.deliveryDate ? `<span>納品日：${DB.fmtDate(project.deliveryDate)}</span>` : ''}
            ${project.budget ? `<span>予算：¥${Number(project.budget).toLocaleString()}</span>` : ''}
            ${project.recurringSeries ? `<span>定期案件：${escHtml(project.recurringSeries)}</span>` : ''}
            <span>窓口：${owner ? escHtml(owner.name) : '未設定'}</span>
            ${project.detailsDueAt ? `<span>詳細登録期限：${DB.fmtDate(project.detailsDueAt)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="openProjectModal('${project.id}')">編集</button>
          ${archiveBtn}
          <button class="btn btn-danger btn-sm" onclick="deleteProject('${project.id}')">削除</button>
        </div>
      </div>

      <!-- フェーズステッパー -->
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <div class="phase-steps" style="flex:1">
          ${stepsHTML || '<span style="color:var(--text-3);font-size:12px">フェーズ未設定</span>'}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="openPhaseEditor('${project.id}')">
          ${icon('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',12)}
          フェーズ編集
        </button>
      </div>

      <!-- フェーズ進捗バー -->
      ${progressBars ? `<div style="border-top:1px solid var(--border);padding-top:12px">${progressBars}</div>` : ''}
    </div>`;
}

/* ─ フェーズステータス循環 ─ */
function cyclePhaseStatus(projectId, phaseId) {
  const p = DB.Projects.get(projectId);
  if (!p) return;
  const cycle = { pending: 'active', active: 'done', done: 'pending' };
  const phases = p.phases.map(ph =>
    ph.id === phaseId ? { ...ph, status: cycle[ph.status] || 'pending' } : ph);
  DB.Projects.updatePhases(projectId, phases);
  renderProjects();
}

/* ─ フェーズ編集モーダル ─ */
function openPhaseEditor(projectId) {
  const p = DB.Projects.get(projectId);
  if (!p) return;
  const phases = p.phases || [];

  const rows = phases.map((ph, i) => phaseEditorRow(projectId, ph, i)).join('');

  openModal(`
    <div id="phase-editor-list">${rows}</div>
    <button class="btn btn-ghost" style="width:100%;margin-top:8px"
            onclick="addPhaseToProject('${projectId}')">＋ フェーズを追加</button>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="savePhaseEditor('${projectId}')">保存する</button>
    </div>
  `, 'フェーズ編集');
}

function phaseEditorRow(projectId, ph, i) {
  return `
    <div class="phase-editor-row" id="ph-row-${ph.id}">
      <span style="color:var(--text-3);font-size:11px;min-width:18px;text-align:right">${i+1}</span>
      <input type="text" value="${escHtml(ph.name)}" id="ph-name-${ph.id}" placeholder="フェーズ名">
      <select class="form-select" style="width:105px;font-size:12px;padding:5px 8px" id="ph-status-${ph.id}">
        <option value="pending" ${ph.status==='pending' ? 'selected' : ''}>未着手</option>
        <option value="active"  ${ph.status==='active'  ? 'selected' : ''}>進行中</option>
        <option value="done"    ${ph.status==='done'    ? 'selected' : ''}>完了</option>
      </select>
      <input type="date" id="ph-due-${ph.id}" value="${ph.dueDate || ''}"
             style="background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:6px;
                    padding:5px 8px;color:var(--text-1);font-size:12px;font-family:inherit;outline:none;width:140px;color-scheme:dark">
      <button class="btn btn-danger btn-sm btn-icon"
              onclick="removePhaseFromEditor('${projectId}','${ph.id}')">✕</button>
    </div>`;
}

function addPhaseToProject(projectId) {
  const p = DB.Projects.get(projectId);
  if (!p) return;
  const newPh = { id: DB.genId(), name: '新フェーズ', status: 'pending', dueDate: '', order: (p.phases||[]).length };
  DB.Projects.updatePhases(projectId, [...(p.phases||[]), newPh]);
  openPhaseEditor(projectId);
}

function removePhaseFromEditor(projectId, phaseId) {
  const p = DB.Projects.get(projectId);
  if (!p) return;
  DB.Projects.updatePhases(projectId, (p.phases||[]).filter(ph => ph.id !== phaseId));
  openPhaseEditor(projectId);
}

function savePhaseEditor(projectId) {
  const p = DB.Projects.get(projectId);
  if (!p) return;
  const updated = (p.phases||[]).map(ph => {
    const nameEl   = document.getElementById(`ph-name-${ph.id}`);
    const statusEl = document.getElementById(`ph-status-${ph.id}`);
    const dueEl    = document.getElementById(`ph-due-${ph.id}`);
    return {
      ...ph,
      name:    nameEl   ? nameEl.value.trim() || ph.name : ph.name,
      status:  statusEl ? statusEl.value : ph.status,
      dueDate: dueEl    ? dueEl.value : ph.dueDate,
    };
  });
  DB.Projects.updatePhases(projectId, updated);
  closeModal();
  showToast('フェーズを保存しました', 'success');
  renderProjects();
}

/* ─ プロジェクト追加/編集モーダル ─ */
function openProjectModal(editId) {
  const project   = editId ? DB.Projects.get(editId) : null;
  const templates = DB.Templates.all();
  const tplOpts   = templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  const ownerDefault = project?.ownerMemberId || (!editId ? getDefaultOwnerMemberId() : '');
  const members   = DB.Members.all();
  const memberOpts = members.map(m =>
    `<option value="${m.id}" ${ownerDefault === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const type = project?.projectType || 'standard';

  openModal(`
    <div class="form-group">
      <label class="form-label">プロジェクト種別</label>
      <select class="form-select" id="pj-type">
        <option value="standard" ${type === 'standard' ? 'selected' : ''}>通常プロジェクト</option>
        <option value="recurring" ${type === 'recurring' ? 'selected' : ''}>定期プロジェクト</option>
        <option value="provisional" ${type === 'provisional' ? 'selected' : ''}>仮プロジェクト</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">クライアント名 *</label>
      <input class="form-input" id="pj-client" placeholder="例：〇〇株式会社" value="${escHtml(project?.clientName||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">プロジェクト名 *</label>
      <input class="form-input" id="pj-name" placeholder="例：会社案内パンフレット" value="${escHtml(project?.name||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">納品日</label>
      <input type="date" class="form-input" id="pj-delivery" value="${project?.deliveryDate||''}">
    </div>
    <div class="form-group">
      <label class="form-label">予算（円）</label>
      <input type="number" class="form-input" id="pj-budget" placeholder="例：500000" value="${project?.budget||''}">
    </div>
    <div class="form-group">
      <label class="form-label">定期案件名</label>
      <input class="form-input" id="pj-recurring" placeholder="例：明治安田 月号" value="${escHtml(project?.recurringSeries||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">窓口担当</label>
      <select class="form-select" id="pj-owner">
        <option value="">未設定</option>${memberOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">詳細登録期限</label>
      <input type="date" class="form-input" id="pj-details-due" value="${project?.detailsDueAt||''}">
    </div>
    ${!editId ? `
      <div class="form-group">
        <label class="form-label">フェーズテンプレート</label>
        <select class="form-select" id="pj-template">
          <option value="">テンプレートを選択...</option>${tplOpts}
        </select>
      </div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${editId ? `saveProjectEdit('${editId}')` : 'saveProjectNew()'}">
        ${editId ? '更新する' : '作成する'}
      </button>
    </div>
  `, editId ? 'プロジェクトを編集' : 'プロジェクトを追加');
}

function saveProjectNew() {
  const clientName = document.getElementById('pj-client')?.value?.trim();
  const name       = document.getElementById('pj-name')?.value?.trim();
  if (!clientName || !name) { showToast('クライアント名とプロジェクト名は必須です', 'error'); return; }
  const projectType = document.getElementById('pj-type')?.value || 'standard';
  DB.Projects.add({
    clientName, name,
    deliveryDate: document.getElementById('pj-delivery')?.value || '',
    budget:       document.getElementById('pj-budget')?.value   || '',
    templateId:   document.getElementById('pj-template')?.value || '',
    projectType,
    recurringSeries: document.getElementById('pj-recurring')?.value?.trim() || '',
    ownerMemberId:   document.getElementById('pj-owner')?.value || getDefaultOwnerMemberId(),
    isProvisional:   projectType === 'provisional',
    detailsDueAt:    document.getElementById('pj-details-due')?.value || '',
  });
  closeModal();
  showToast('プロジェクトを作成しました', 'success');
  renderProjects();
}

function saveProjectEdit(projectId) {
  const clientName = document.getElementById('pj-client')?.value?.trim();
  const name       = document.getElementById('pj-name')?.value?.trim();
  if (!clientName || !name) { showToast('クライアント名とプロジェクト名は必須です', 'error'); return; }
  const projectType = document.getElementById('pj-type')?.value || 'standard';
  DB.Projects.update(projectId, {
    clientName, name,
    deliveryDate: document.getElementById('pj-delivery')?.value || '',
    budget:       document.getElementById('pj-budget')?.value   || '',
    projectType,
    recurringSeries: document.getElementById('pj-recurring')?.value?.trim() || '',
    ownerMemberId:   document.getElementById('pj-owner')?.value || '',
    isProvisional:   projectType === 'provisional',
    detailsDueAt:    document.getElementById('pj-details-due')?.value || '',
  });
  closeModal();
  showToast('プロジェクトを更新しました', 'success');
  renderProjects();
}

function archiveProject(id) {
  DB.Projects.archive(id);
  showToast('アーカイブしました', 'info');
  renderProjects();
}

function restoreProject(id) {
  DB.Projects.restore(id);
  showToast('復元しました', 'success');
  renderProjects();
}

function deleteProject(id) {
  if (!confirm('このプロジェクトを削除しますか？\n（タスクとの紐付けは保持されます）')) return;
  DB.Projects.remove(id);
  showToast('プロジェクトを削除しました', 'info');
  renderProjects();
}

/* ============================================================
   設定
   ============================================================ */
const MEMBER_COLORS = [
  '#6366f1','#a855f7','#ec4899','#ef4444','#f97316',
  '#f59e0b','#10b981','#06b6d4','#3b82f6','#84cc16',
];
let _selectedColor = MEMBER_COLORS[0];
let _settingsTab   = 'members'; // 'members' | 'templates'

function renderSettings() {
  const main      = document.getElementById('main-content');
  const members   = DB.Members.all();
  const templates = DB.Templates.all();

  main.innerHTML = `
    <div class="page-header"><div class="page-header-left">
      <h2>設定</h2>
      <p>メンバー・テンプレートの管理</p>
    </div></div>
    <div class="page-body fade-in">
      <div class="tab-bar">
        <button class="btn ${_settingsTab==='members'   ? 'btn-primary' : 'btn-ghost'}"
                onclick="_settingsTab='members';renderSettings()">メンバー管理</button>
        <button class="btn ${_settingsTab==='templates' ? 'btn-primary' : 'btn-ghost'}"
                onclick="_settingsTab='templates';renderSettings()">テンプレート管理</button>
      </div>
      ${_settingsTab === 'members' ? membersTabHTML(members) : templatesTabHTML(templates)}
    </div>`;
}

/* ─ メンバータブ ─ */
function membersTabHTML(members) {
  const memberCards = members.length === 0
    ? `<div class="empty-state"><div class="icon">👥</div><div class="title">メンバーが登録されていません</div></div>`
    : members.map(m => `
        <div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;padding:14px 18px">
          ${avatarHTML(m, 42)}
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">${escHtml(m.name)}</div>
            <div style="font-size:11px;color:var(--text-3);display:flex;align-items:center;gap:5px;margin-top:2px">
              <span style="width:10px;height:10px;border-radius:50%;background:${m.color};display:inline-block"></span>
              ${m.color}
            </div>
          </div>
          <div style="display:flex;gap:5px">
            <button class="btn btn-ghost btn-sm" onclick="openMemberModal('${m.id}')">編集</button>
            <button class="btn btn-danger btn-sm" onclick="deleteMember('${m.id}')">削除</button>
          </div>
        </div>`).join('');

  return `
    <div class="action-row">
      <span style="font-size:13px;color:var(--text-2)">${members.length}名登録済み</span>
      <button class="btn btn-primary" id="add-member-btn" onclick="openMemberModal(null)">
        ${icon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')}
        メンバー追加
      </button>
    </div>
    ${memberCards}`;
}

function openMemberModal(editId) {
  const member = editId ? DB.Members.get(editId) : null;
  _selectedColor = member ? member.color : MEMBER_COLORS[0];

  const swatches = MEMBER_COLORS.map(c => `
    <div class="color-swatch ${c === _selectedColor ? 'selected' : ''}"
         style="background:${c}" id="swatch-${c.slice(1)}"
         onclick="selectMemberColor('${c}')" title="${c}"></div>`).join('');

  openModal(`
    <div class="form-group">
      <label class="form-label">名前 *</label>
      <input class="form-input" id="mem-name" placeholder="例：田中 健太" value="${escHtml(member?.name||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">アバターカラー</label>
      <div class="color-grid" id="color-grid">${swatches}</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${editId ? `saveMemberEdit('${editId}')` : 'saveMemberNew()'}">
        ${editId ? '更新する' : '追加する'}
      </button>
    </div>
  `, editId ? 'メンバーを編集' : 'メンバーを追加');
}

function selectMemberColor(color) {
  _selectedColor = color;
  document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
  document.getElementById(`swatch-${color.slice(1)}`)?.classList.add('selected');
}

function saveMemberNew() {
  const name = document.getElementById('mem-name')?.value?.trim();
  if (!name) { showToast('名前を入力してください', 'error'); return; }
  DB.Members.add({ name, color: _selectedColor });
  closeModal();
  showToast('メンバーを追加しました', 'success');
  renderSettings();
}

function saveMemberEdit(memberId) {
  const name = document.getElementById('mem-name')?.value?.trim();
  if (!name) { showToast('名前を入力してください', 'error'); return; }
  DB.Members.update(memberId, { name, color: _selectedColor });
  closeModal();
  showToast('メンバーを更新しました', 'success');
  renderSettings();
}

function deleteMember(memberId) {
  if (!confirm('このメンバーを削除しますか？\n（タスクの担当者情報は保持されます）')) return;
  DB.Members.remove(memberId);
  showToast('メンバーを削除しました', 'info');
  renderSettings();
}

/* ─ テンプレートタブ ─ */
function templatesTabHTML(templates) {
  const tplCards = templates.length === 0
    ? `<div class="empty-state"><div class="icon">📄</div><div class="title">テンプレートがありません</div></div>`
    : templates.map(t => {
        const phasePills = t.phases.map((ph, i) =>
          `<span style="font-size:11px;padding:2px 8px;background:var(--bg-glass);border:1px solid var(--border);border-radius:4px;color:var(--text-2)">${i+1}.${ph}</span>`
        ).join('<span style="color:var(--text-3);font-size:10px">›</span>');
        return `
          <div class="card" style="margin-bottom:8px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-weight:700;font-size:14px">${escHtml(t.name)}</span>
                ${t.custom ? '<span class="tag tag-custom">カスタム</span>' : ''}
              </div>
              <div style="display:flex;gap:5px">
                <button class="btn btn-ghost btn-sm" onclick="openTemplateModal('${t.id}')">編集</button>
                ${t.custom ? `<button class="btn btn-danger btn-sm" onclick="deleteTemplate('${t.id}')">削除</button>` : ''}
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
              ${t.phases.length ? phasePills : '<span style="color:var(--text-3);font-size:12px">フェーズなし（ブランク）</span>'}
            </div>
          </div>`;
      }).join('');

  return `
    <div class="action-row">
      <span style="font-size:13px;color:var(--text-2)">${templates.length}件</span>
      <button class="btn btn-primary" id="add-template-btn" onclick="openTemplateModal(null)">
        ${icon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>')}
        テンプレート追加
      </button>
    </div>
    ${tplCards}`;
}

/* ─ テンプレートモーダル ─ */
function openTemplateModal(editId) {
  const tpl    = editId ? DB.Templates.get(editId) : null;
  const phases = tpl ? [...tpl.phases] : [''];

  openModal(`
    <div class="form-group">
      <label class="form-label">テンプレート名 *</label>
      <input class="form-input" id="tpl-name" placeholder="例：広告制作" value="${escHtml(tpl?.name||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">フェーズ構成</label>
      <div id="tpl-phases-list">
        ${phases.map((ph, i) => tplPhaseRow(ph, i)).join('')}
      </div>
      <button class="btn btn-ghost" style="width:100%;margin-top:6px"
              onclick="addTplPhaseRow()">＋ フェーズを追加</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${editId ? `saveTemplateEdit('${editId}')` : 'saveTemplateNew()'}">
        ${editId ? '更新する' : '作成する'}
      </button>
    </div>
  `, editId ? 'テンプレートを編集' : 'テンプレートを追加');
}

function tplPhaseRow(value, i) {
  return `
    <div style="display:flex;gap:6px;margin-bottom:6px" id="tpl-row-${i}">
      <span style="min-width:18px;text-align:right;font-size:11px;color:var(--text-3);padding-top:9px">${i+1}</span>
      <input class="form-input" style="flex:1" placeholder="フェーズ名" value="${escHtml(value)}" id="tpl-ph-${i}">
      <button class="btn btn-danger btn-sm btn-icon" onclick="document.getElementById('tpl-row-${i}').remove()">✕</button>
    </div>`;
}

let _tplRowCount = 0;
function addTplPhaseRow() {
  const list = document.getElementById('tpl-phases-list');
  if (!list) return;
  _tplRowCount++;
  const id  = `tpl-dyn-${_tplRowCount}`;
  const idx = list.children.length + 1;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
  div.id = id;
  div.innerHTML = `
    <span style="min-width:18px;text-align:right;font-size:11px;color:var(--text-3);padding-top:9px">${idx}</span>
    <input class="form-input" style="flex:1" placeholder="フェーズ名" id="tf-dyn-ph-${_tplRowCount}">
    <button class="btn btn-danger btn-sm btn-icon" onclick="document.getElementById('${id}').remove()">✕</button>`;
  list.appendChild(div);
}

function getTemplatePhases() {
  return Array.from(document.querySelectorAll('[id^="tpl-ph-"], [id^="tf-dyn-ph-"]'))
    .map(el => el.value.trim()).filter(Boolean);
}

function saveTemplateNew() {
  const name = document.getElementById('tpl-name')?.value?.trim();
  if (!name) { showToast('テンプレート名を入力してください', 'error'); return; }
  DB.Templates.add({ name, phases: getTemplatePhases() });
  closeModal();
  showToast('テンプレートを作成しました', 'success');
  renderSettings();
}

function saveTemplateEdit(tplId) {
  const name = document.getElementById('tpl-name')?.value?.trim();
  if (!name) { showToast('テンプレート名を入力してください', 'error'); return; }
  DB.Templates.update(tplId, { name, phases: getTemplatePhases() });
  closeModal();
  showToast('テンプレートを更新しました', 'success');
  renderSettings();
}

function deleteTemplate(tplId) {
  if (!confirm('このテンプレートを削除しますか？')) return;
  DB.Templates.remove(tplId);
  showToast('テンプレートを削除しました', 'info');
  renderSettings();
}

/* ============================================================
   ユーティリティ
   ============================================================ */
/** HTML エスケープ */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============================================================
   キーボードショートカット
   ============================================================ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

/* ============================================================
   サイドバー日付
   ============================================================ */
function updateSidebarDate() {
  const el = document.getElementById('sidebar-date');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleDateString('ja-JP', { month:'numeric', day:'numeric', weekday:'short' });
  }
}

/* ============================================================
   アプリ初期化
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  await DB.initStore();
  DB.seedDemoData();       // 初回のみデモデータを投入
  updateSidebarDate();
  updateMorningBadge();
  navigate('dashboard');
});
