/**
 * TaskBoard — app.js
 * ルーター・全画面レンダリング・UI ロジック
 */
const APP_BUILD_LABEL = 'Chatwork納品日送信版 2026-06-04-01';

/* ============================================================
   ルーター
   ============================================================ */
let _currentPage = 'dashboard';
let _personalMemberId = '';

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
    case 'morning':   _currentPage = 'tasks'; renderTodayTasks(); break;
    case 'tasks':     renderTodayTasks(); break;
    case 'projectReview': renderProjectReviewFromUrl(); break;
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

function normalizeNameText(value) {
  return String(value ?? '')
    .replace(/さん|様|氏/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function findMemberByName(name) {
  const target = normalizeNameText(name);
  if (!target) return null;
  const members = DB.Members.all();
  const exact = members.find(m => normalizeNameText(m.name) === target);
  if (exact) return exact;

  return members.find(m => {
    const memberName = normalizeNameText(m.name);
    return memberName.length >= 3 && target.includes(memberName);
  }) || null;
}

function findProjectByName(name) {
  const target = normalizeMatchText(name);
  if (!target) return null;
  return DB.Projects.active().find(p =>
    normalizeMatchText(`${p.clientName} ${p.name}`) === target ||
    normalizeMatchText(`${p.clientName}/${p.name}`) === target ||
    normalizeMatchText(p.clientName) === target ||
    normalizeMatchText(p.name) === target
  ) || null;
}

function findSimilarProjects(name, limit = 5) {
  const target = normalizeProjectSearchText(name);
  if (!target) return [];
  return DB.Projects.active()
    .map(project => {
      const label = `${project.clientName} ${project.name} ${project.recurringSeries || ''}`;
      const score = projectSimilarityScore(target, normalizeProjectSearchText(label));
      return { project, score };
    })
    .filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.project);
}

function normalizeProjectSearchText(value) {
  return normalizeMatchText(value)
    .replace(/仮プロジェクト|プロジェクト|案件|制作|運用|記事/g, '');
}

function projectSimilarityScore(target, candidate) {
  if (!target || !candidate) return 0;
  if (candidate === target) return 100;
  if (candidate.includes(target) || target.includes(candidate)) return 50;

  const targetTokens = projectTokens(target);
  const candidateTokens = projectTokens(candidate);
  let score = 0;
  targetTokens.forEach(token => {
    if (candidate.includes(token)) score += token.length >= 4 ? 3 : 1;
  });
  candidateTokens.forEach(token => {
    if (target.includes(token)) score += token.length >= 4 ? 2 : 1;
  });
  return score;
}

function projectTokens(value) {
  const chunks = String(value || '').split(/[・／/_,，、\s]+/).filter(Boolean);
  const tokens = new Set(chunks);
  const compact = String(value || '');
  for (let i = 0; i < compact.length - 1; i += 1) {
    tokens.add(compact.slice(i, i + 2));
  }
  return Array.from(tokens).filter(token => token.length >= 2);
}

/** 未登録案件の窓口デフォルト。佐久間/私/自分がいなければ先頭メンバー */
function getDefaultOwnerMemberId() {
  const members = DB.Members.all();
  const me = members.find(m => /佐久間|私|自分/.test(m.name));
  if (me) return me.id;
  const created = DB.Members.add({ name: '佐久間さん', color: '#3b82f6' });
  return created.id;
}

function normalizeMemberToken(value) {
  return decodeURIComponent(String(value ?? ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function resolveMemberFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('member') || params.get('user') || '';
  if (!raw) return null;

  const token = normalizeMemberToken(raw);
  return DB.Members.all().find(m =>
    normalizeMemberToken(m.id) === token ||
    normalizeMemberToken(m.name) === token
  ) || null;
}

function getMemberPageUrl(memberId) {
  const url = new URL(window.location.href);
  url.searchParams.set('member', memberId);
  return url.toString();
}

function getMemberProjectEditUrl(memberId, projectId) {
  const url = new URL(window.location.href);
  if (memberId) url.searchParams.set('member', memberId);
  url.searchParams.set('project', projectId);
  return url.toString();
}

async function copyMemberPageUrl(memberId) {
  const url = getMemberPageUrl(memberId);
  try {
    await navigator.clipboard.writeText(url);
    showToast('個人ページURLをコピーしました', 'success');
  } catch {
    window.prompt('このURLをコピーしてください', url);
  }
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
let _morningFilter = { memberId: '', projectId: '', date: '' };

function renderMorningCheck() {
  const main        = document.getElementById('main-content');
  const members     = DB.Members.all();
  const projects    = DB.Projects.active();
  const selectedDate = _morningFilter.date || DB.today();
  const selectedMemberId = _morningFilter.memberId || '';
  const dateTasks = DB.Tasks.byDate(selectedDate);
  const filteredTasks = dateTasks.filter(t => {
    if (selectedMemberId && t.memberId !== selectedMemberId) return false;
    if (_morningFilter.projectId && t.projectId !== _morningFilter.projectId) return false;
    return true;
  });
  const personalMember = _personalMemberId ? DB.Members.get(_personalMemberId) : null;
  const memberOpts = members.map(m => `<option value="${m.id}" ${selectedMemberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const projectOpts = projects.map(p => `<option value="${p.id}" ${_morningFilter.projectId === p.id ? 'selected' : ''}>${p.clientName} / ${p.name}</option>`).join('');

  if (!filteredTasks.length) {
    main.innerHTML = `
      <div class="page-header"><div class="page-header-left">
        <h2>${personalMember ? `${escHtml(personalMember.name)}さんの朝チェック` : '朝のチェック'}</h2>
        <p>${DB.fmtDate(selectedDate)} の作業量確認${personalMember ? '・個人ページ' : ''}</p>
      </div></div>
      <div class="page-body fade-in">
        ${morningFilterBarHTML(memberOpts, projectOpts, selectedDate, selectedMemberId)}
        <div class="empty-state" style="margin-top:40px">
          <div class="icon">☀️</div>
          <div class="title">この条件のタスクはありません</div>
          <div class="sub">メンバー・プロジェクト・日付を変えるか、「今日のタスク」から登録してください</div>
        </div>
      </div>`;
    updateMorningBadge();
    return;
  }

  // メンバーごとにグループ化
  const byMember = {};
  filteredTasks.forEach(t => {
    (byMember[t.memberId] = byMember[t.memberId] || []).push(t);
  });

  const unchecked = filteredTasks.filter(t => t.completed === null).length;
  const totalH = filteredTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
  const carryCount = filteredTasks.filter(t => t.carriedFromTaskId).length;
  const bannerHTML = unchecked === 0
    ? `<div class="banner banner-success">✓ この日のチェックは完了しています。</div>`
    : `<div class="banner banner-warning">⚠ ${unchecked}件が未確認です。合計 ${totalH}h${carryCount ? `、繰り越し ${carryCount}件` : ''} あります。</div>`;

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
              ${tasks.length}件 / ${tasks.reduce((s, t) => s + (t.estimatedHours || 0), 0)}h 　✓${doneCount}　✗${failCount}　未${tasks.length - doneCount - failCount}
            </div>
          </div>
        </div>
        ${taskRows}
      </div>`;
  }).join('');

  main.innerHTML = `
    <div class="page-header"><div class="page-header-left">
      <h2>${personalMember ? `${escHtml(personalMember.name)}さんの朝チェック` : '朝のチェック'}</h2>
      <p>${DB.fmtDate(selectedDate)} の作業量確認${personalMember ? '・個人ページ' : ''}</p>
    </div></div>
    <div class="page-body fade-in">
      ${morningFilterBarHTML(memberOpts, projectOpts, selectedDate, selectedMemberId)}
      ${morningLoadSummaryHTML(filteredTasks, members, selectedMemberId)}
      ${bannerHTML}
      ${memberBlocks}
    </div>`;
  updateMorningBadge();
}

function morningFilterBarHTML(memberOpts, projectOpts, selectedDate, selectedMemberId) {
  return `
    <div class="action-row">
      <div class="filter-bar">
        <select class="form-select" style="width:145px" id="morning-filter-member"
                onchange="_morningFilter.memberId=this.value;renderMorningCheck()">
          <option value="">全メンバー</option>${memberOpts}
        </select>
        <select class="form-select" style="width:210px" id="morning-filter-project"
                onchange="_morningFilter.projectId=this.value;renderMorningCheck()">
          <option value="">全プロジェクト</option>${projectOpts}
        </select>
        <input type="date" class="form-input" style="width:150px" id="morning-filter-date"
               value="${selectedDate}" onchange="_morningFilter.date=this.value;renderMorningCheck()">
        <button class="btn btn-ghost btn-sm" onclick="_morningFilter.date=DB.today();renderMorningCheck()">今日</button>
        <button class="btn btn-ghost btn-sm" onclick="_morningFilter.date=DB.yesterday();renderMorningCheck()">昨日</button>
        ${_personalMemberId || selectedMemberId ? `<button class="btn btn-ghost btn-sm" onclick="_morningFilter.memberId='';renderMorningCheck()">全メンバー表示</button>` : ''}
      </div>
    </div>`;
}

function morningLoadSummaryHTML(tasks, members, selectedMemberId) {
  const targetMembers = selectedMemberId
    ? members.filter(m => m.id === selectedMemberId)
    : members.filter(m => tasks.some(t => t.memberId === m.id));

  if (!targetMembers.length) return '';

  const cards = targetMembers.map(member => {
    const memberTasks = tasks.filter(t => t.memberId === member.id);
    const totalH = memberTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
    const carryCount = memberTasks.filter(t => t.carriedFromTaskId).length;
    const unchecked = memberTasks.filter(t => t.completed === null).length;
    const loadClass = totalH >= 8 ? 'danger' : totalH >= 6 ? 'warn' : 'normal';
    return `
      <div class="morning-load-card ${loadClass}">
        <div class="morning-load-head">
          ${avatarHTML(member, 30)}
          <div>
            <div class="morning-load-name">${escHtml(member.name)}</div>
            <div class="morning-load-sub">${memberTasks.length}件 / ${totalH}h</div>
          </div>
        </div>
        <div class="morning-load-tags">
          <span>未確認 ${unchecked}</span>
          <span>繰越 ${carryCount}</span>
        </div>
      </div>`;
  }).join('');

  return `<div class="morning-load-grid">${cards}</div>`;
}

function morningTaskRow(task) {
  const phaseName   = getPhaseName(task);
  const projectLabel = getProjectLabel(task);
  const ownerLabel = getTaskOwnerLabel(task);
  const originDate = sourceDateForTask(task);
  const isCarry = Boolean(task.carriedFromTaskId);
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
    <div class="task-row ${isCarry ? 'task-row-carry' : ''}" id="morning-task-${task.id}">
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
          ${taskDateTagHTML(originDate, { carried: isCarry })}
          ${isCarry ? `<span class="tag tag-carry">繰り越し</span>` : ''}
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
    if (task.date < DB.today()) DB.Tasks.carryOverTask(taskId);
  }
  renderMorningCheck();
}

function saveIncompleteReason(taskId, reason) {
  DB.Tasks.update(taskId, { incompleteReason: reason });
}

function updateMorningBadge() {
  const unchecked = DB.Tasks.todayTasks().filter(t => t.completed === null).length;
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
let _taskFilter = { memberId: '', projectId: '', date: '', startDate: '', endDate: '', showCompleted: false };
let _taskFormData = { memberId: '', projectId: '', phaseId: '', content: '', estimatedHours: 1, note: '', date: '' };
let _bulkTaskData = { memberId: '', ownerMemberId: '', date: '', text: '', preview: null };
const CHATWORK_ROOM_KEY = 'tb_chatwork_room_id';
const CHATWORK_IMPORT_KEY = 'tb_chatwork_import_key';

function getTaskRange() {
  const start = _taskFilter.startDate || _taskFilter.date || DB.today();
  const end = _taskFilter.endDate || _taskFilter.date || start;
  return start <= end ? { start, end } : { start: end, end: start };
}

function getTaskDefaultDate() {
  const range = getTaskRange();
  return range.start === range.end ? range.start : DB.today();
}

function setTaskFilterStartDate(value) {
  _taskFilter.startDate = value || DB.today();
  if (!_taskFilter.endDate) _taskFilter.endDate = _taskFilter.startDate;
  _taskFilter.date = _taskFilter.startDate;
  renderTodayTasks();
}

function setTaskFilterEndDate(value) {
  _taskFilter.endDate = value || (_taskFilter.startDate || DB.today());
  _taskFilter.date = _taskFilter.startDate || _taskFilter.endDate;
  renderTodayTasks();
}

function setTaskFilterToday() {
  const today = DB.today();
  _taskFilter.date = today;
  _taskFilter.startDate = today;
  _taskFilter.endDate = today;
  renderTodayTasks();
}

async function refreshTaskData(options = {}) {
  const ok = await DB.reloadCloudStore?.();
  if (!options.silent) {
    showToast(ok ? '最新のタスクを読み込みました' : '最新データを確認できませんでした', ok ? 'success' : 'error');
  }
  renderTodayTasks();
  updateMorningBadge();
}

async function toggleCompletedVisibility() {
  _taskFilter.showCompleted = !_taskFilter.showCompleted;
  await refreshTaskData({ silent: true });
}

function taskRangeLabel(range) {
  if (range.start === range.end) return `${DB.fmtDate(range.start)} の作業予定`;
  return `${DB.fmtDate(range.start)}〜${DB.fmtDate(range.end)} のタスク`;
}

function renderTodayTasks() {
  const main       = document.getElementById('main-content');
  const members    = DB.Members.all();
  const projects   = DB.Projects.active();
  const range = getTaskRange();
  const dateTasks = DB.Tasks.byDateRange(range.start, range.end);
  const personalMember = _personalMemberId ? DB.Members.get(_personalMemberId) : null;

  // フィルタ適用
  const filtered = dateTasks.filter(t => {
    if (_taskFilter.memberId  && t.memberId  !== _taskFilter.memberId)  return false;
    if (_taskFilter.projectId && t.projectId !== _taskFilter.projectId) return false;
    if (!_taskFilter.showCompleted && t.completed === true) return false;
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
      <h2>${personalMember ? `${escHtml(personalMember.name)}さんのタスク` : '今日のタスク'}</h2>
      <p>${taskRangeLabel(range)}${personalMember ? '・個人ページ' : ''}</p>
    </div></div>
    <div class="page-body fade-in">
      ${personalMember ? `
        <div class="banner banner-info">
          ${avatarHTML(personalMember, 28)}
          <span>このURLは ${escHtml(personalMember.name)}さん用です。プロジェクト画面では全体の進行状況も確認できます。</span>
          <button class="btn btn-ghost btn-sm" onclick="_taskFilter.memberId='';renderTodayTasks()">全メンバー表示</button>
        </div>
      ` : ''}
      ${renderSharedAskPanel(range.start)}
      ${_taskFilter.memberId ? renderMemberAskPanel(_taskFilter.memberId) : ''}

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
          <input type="date" class="form-input" style="width:150px" id="filter-start-date"
                 value="${range.start}" onchange="setTaskFilterStartDate(this.value)" title="開始日">
          <span style="font-size:13px;color:var(--text-2)">〜</span>
          <input type="date" class="form-input" style="width:150px" id="filter-end-date"
                 value="${range.end}" onchange="setTaskFilterEndDate(this.value)" title="終了日">
          <button class="btn btn-ghost btn-sm" onclick="setTaskFilterToday()">今日</button>
          <button class="btn btn-ghost btn-sm" onclick="refreshTaskData()">
            最新に更新
          </button>
          <button class="btn btn-ghost btn-sm" onclick="toggleCompletedVisibility()">
            ${_taskFilter.showCompleted ? '未完了のみ' : '完了済みも表示'}
          </button>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:13px;color:var(--text-2)">合計 <strong style="color:var(--primary)">${totalH}h</strong></span>
          <button class="btn btn-ghost" onclick="importChatworkTasksDirect()">
            TASK取得
          </button>
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
  const projectHTML = taskProjectDisplayHTML(task);
  const ownerLabel = getTaskOwnerLabel(task);
  const linkedAsk = getTaskLinkedAsk(task.id);
  const originDate = sourceDateForTask(task);
  const isCarry = Boolean(task.carriedFromTaskId);
  const isDone = task.completed === true;
  return `
    <div class="task-row ${isCarry ? 'task-row-carry' : ''} ${isDone ? 'task-row-done' : ''}" id="task-row-${task.id}">
      <button class="check-btn ${isDone ? 'done' : ''}"
              onclick="toggleTodayTaskComplete('${task.id}')"
              title="${isDone ? '未完了に戻す' : '完了にする'}"
              aria-label="${isDone ? '未完了に戻す' : '完了にする'}">✓</button>
      <div class="task-accent-bar"></div>
      <div class="flex-1">
        <div class="task-title">${escHtml(task.content)}</div>
        ${task.note ? `<div class="task-note">備考：${escHtml(task.note)}</div>` : ''}
        <div class="task-meta">
          ${taskDateTagHTML(originDate, { carried: isCarry })}
          <span>担当：${escHtml(ownerLabel)}</span>
          ${projectHTML}
          ${phaseName ? `<span class="tag tag-phase">${phaseName}</span>` : ''}
          ${isCarry ? '<span class="tag tag-carry tag-carry-strong">繰り越し</span>' : ''}
          ${isDone ? '<span class="tag tag-done">完了</span>' : ''}
          ${linkedAsk ? '<span class="tag tag-ask">確認あり</span>' : ''}
          <span class="tag-hours">${task.estimatedHours}h</span>
        </div>
      </div>
      <div style="display:flex;gap:5px;align-items:center;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="openTaskModal('${task.id}')">編集</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">削除</button>
      </div>
    </div>`;
}

function taskProjectDisplayHTML(task) {
  const projectLabel = getProjectLabel(task);
  if (projectLabel) return `<span>${escHtml(projectLabel)}</span>`;
  if (task.sourceProjectName) {
    return `<span class="tag tag-missing-project">プロジェクト確認待ち：${escHtml(task.sourceProjectName)}</span>`;
  }
  return '<span style="color:var(--text-3)">プロジェクト未選択</span>';
}

async function toggleTodayTaskComplete(taskId) {
  const task = DB.Tasks.get(taskId);
  if (!task) return;
  DB.Tasks.setCompletion(taskId, task.completed === true ? null : true, '');
  await DB.syncCloudStore?.();
  renderTodayTasks();
  updateMorningBadge();
}

function taskDateTagHTML(dateStr, options = {}) {
  const carriedClass = options.carried ? ' tag-date-carry' : '';
  const label = options.label || relativeDateLabel(dateStr);
  return `<span class="tag tag-date tag-date-${dateTone(dateStr)}${carriedClass}" title="${escHtml(DB.fmtDate(dateStr))}">${escHtml(label)}</span>`;
}

function sourceDateForTask(task) {
  if (!task?.carriedFromTaskId) return task?.date || '';
  return getCarryOriginTask(task)?.date || task.date;
}

function getCarryOriginTask(task) {
  let current = task;
  const seen = new Set();
  while (current?.carriedFromTaskId && !seen.has(current.id)) {
    seen.add(current.id);
    const previous = DB.Tasks.get(current.carriedFromTaskId);
    if (!previous) break;
    current = previous;
  }
  return current || task;
}

function relativeDateLabel(dateStr, baseDate = DB.today()) {
  if (!dateStr) return '日付なし';
  const date = new Date(dateStr + 'T00:00:00');
  const base = new Date(baseDate + 'T00:00:00');
  const diff = Math.round((base - date) / 86400000);
  if (diff === 0) return '今日';
  if (diff === 1) return '昨日';
  if (diff > 1 && diff <= 6) return `${diff}日前`;
  if (diff < 0) return DB.fmtDate(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function dateTone(dateStr) {
  if (!dateStr) return '0';
  let sum = 0;
  String(dateStr).split('').forEach(ch => { sum += ch.charCodeAt(0); });
  return String((sum % 6) + 1);
}

function renderMemberAskPanel(memberId) {
  const toMe = DB.Asks.byMember(memberId)
    .filter(a => a.status !== 'done')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const fromMe = DB.Asks.fromMember(memberId)
    .filter(a => a.status !== 'done')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  if (!toMe.length && !fromMe.length) return '';

  return `
    <div class="ask-panel">
      ${toMe.length ? `
        <div class="ask-section">
          <div class="ask-section-title">あなた宛の進行確認</div>
          ${toMe.map(askCardHTML).join('')}
        </div>
      ` : ''}
      ${fromMe.length ? `
        <div class="ask-section">
          <div class="ask-section-title">自分が出した進行確認</div>
          ${fromMe.map(askCardHTML).join('')}
        </div>
      ` : ''}
    </div>`;
}

function renderSharedAskPanel(selectedDate) {
  const asks = DB.Asks.all()
    .filter(a => a.status !== 'done')
    .filter(a => !_taskFilter.memberId || a.toMemberId === _taskFilter.memberId || a.fromMemberId === _taskFilter.memberId || a.toName === '全員')
    .filter(a => !_taskFilter.projectId || a.projectId === _taskFilter.projectId)
    .sort((a, b) => String(a.dueText || a.date || '').localeCompare(String(b.dueText || b.date || '')));

  if (!asks.length) return '';
  return `
    <div class="ask-panel ask-panel-shared">
      <div class="ask-section">
        <div class="ask-section-title">共有確認・お願い</div>
        <div class="form-help">進行に関わる確認だけをここに残します。作業上の細かい相談は個別に確認してください。</div>
        ${asks.map(ask => askCardHTML(ask, selectedDate)).join('')}
      </div>
    </div>`;
}

function askCardHTML(ask, selectedDate = DB.today()) {
  const fromMember = ask.fromMemberId ? DB.Members.get(ask.fromMemberId) : null;
  const toMember = ask.toMemberId ? DB.Members.get(ask.toMemberId) : null;
  const projectLabel = ask.projectId ? projectLabelById(ask.projectId) : ask.projectName;
  const relatedTask = ask.taskId ? DB.Tasks.get(ask.taskId) : null;
  const typeClass = normalizeAskType(ask.type);
  return `
    <div class="ask-card ${typeClass}">
      <div class="ask-main">
        <div class="ask-head">
          <span class="ask-type">${escHtml(ask.type || '質問')}</span>
          ${ask.date ? taskDateTagHTML(ask.date, { label: relativeDateLabel(ask.date, selectedDate) }) : ''}
          ${projectLabel ? `<span class="ask-project">${escHtml(projectLabel)}</span>` : ''}
          ${ask.dueText ? `<span class="ask-due">期限：${escHtml(ask.dueText)}</span>` : ''}
        </div>
        ${relatedTask ? `<div class="ask-related">関連タスク：${escHtml(relatedTask.content)}</div>` : ''}
        <div class="ask-content">${escHtml(ask.content)}</div>
        <div class="ask-meta">
          ${fromMember ? `依頼元：${escHtml(fromMember.name)}` : ''}
          ${toMember ? `宛先：${escHtml(toMember.name)}` : ask.toName ? `宛先：${escHtml(ask.toName)}` : ''}
        </div>
      </div>
      <div class="ask-actions">
        <button class="btn btn-ghost btn-sm" onclick="copyAskReplyMessage('${ask.id}')">返信文</button>
        <button class="btn btn-success btn-sm" onclick="completeAsk('${ask.id}')">完了</button>
      </div>
    </div>`;
}

function normalizeAskType(type) {
  if (/確認/.test(type)) return 'confirm';
  if (/依頼|お願い/.test(type)) return 'request';
  if (/共有/.test(type)) return 'share';
  return 'question';
}

function projectLabelById(projectId) {
  const p = DB.Projects.get(projectId);
  return p ? `${p.clientName} / ${p.name}` : '';
}

function getTaskLinkedAsk(taskId) {
  if (!taskId) return null;
  return DB.Asks.all().find(a => a.taskId === taskId && a.status !== 'done') || null;
}

function completeAsk(askId) {
  DB.Asks.update(askId, { status: 'done', completedAt: new Date().toISOString() });
  showToast('進行確認を完了にしました', 'success');
  renderTodayTasks();
}

async function copyAskReplyMessage(askId) {
  const ask = DB.Asks.get(askId);
  if (!ask) return;
  const member = ask.toMemberId ? DB.Members.get(ask.toMemberId) : null;
  const message = [
    '#askreply',
    `${ask.type || '質問'}：${ask.content}`,
    `返信：`,
    member ? `送信者：${member.name}` : '',
  ].filter(Boolean).join('\n');

  try {
    await navigator.clipboard.writeText(message);
    showToast('返信用フォーマットをコピーしました', 'success');
  } catch {
    window.prompt('この文章をコピーしてください', message);
  }
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
    _taskFormData = {
      memberId: _taskFilter.memberId || _personalMemberId || '',
      projectId: '',
      phaseId: '',
      content: '',
      estimatedHours: 1,
      note: '',
      date: getTaskDefaultDate(),
    };
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
  const linkedAsk = editId ? getTaskLinkedAsk(editId) : null;
  const askMemberOpts = `<option value="">宛先を選択...</option>` + members.map(m =>
    `<option value="${m.id}" ${linkedAsk?.toMemberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');

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
      <label class="form-label">作業日 *</label>
      <input type="date" class="form-input" id="tf-date"
             value="${_taskFormData.date || DB.today()}"
             onchange="_taskFormData.date=this.value">
    </div>
    <div class="form-group">
      <label class="form-label">タスク内容 *</label>
      <textarea class="form-textarea" id="tf-content"
                placeholder="作業の説明を入力..."
                oninput="_taskFormData.content=this.value">${escHtml(_taskFormData.content || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">備考</label>
      <textarea class="form-textarea" id="tf-note"
                placeholder="作業メモ、補足、引き継ぎのメモなど"
                oninput="_taskFormData.note=this.value">${escHtml(_taskFormData.note || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">予測稼働時間（0.25h 単位）</label>
      <div class="hours-stepper">
        <button class="hours-btn" onclick="stepHours(-0.25)" type="button">－</button>
        <span class="hours-display" id="tf-hours-display">${_taskFormData.estimatedHours || 1}h</span>
        <button class="hours-btn" onclick="stepHours(0.25)" type="button">＋</button>
      </div>
    </div>
    <div class="task-ask-box">
      <div class="task-ask-title">進行に関わる確認</div>
      <div class="form-help">次の工程・納期・判断に影響する確認だけを入れます。個人的な作業相談はここに残さず、直接確認してください。</div>
      <div class="task-ask-grid">
        <div class="form-group">
          <label class="form-label">誰に</label>
          <select class="form-select" id="tf-ask-to">${askMemberOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">いつまでに</label>
          <input type="text" class="form-input" id="tf-ask-due"
                 value="${escHtml(linkedAsk?.dueText || '')}"
                 placeholder="例：今日中 / 5/29 / 午前中">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">内容</label>
        <textarea class="form-textarea" id="tf-ask-content"
                  placeholder="例：この画像で次工程へ進めてよいか確認してください">${escHtml(linkedAsk?.content || '')}</textarea>
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
  const next = Math.max(0.25, Math.min(24,
    parseFloat((_taskFormData.estimatedHours || 1)) + delta));
  _taskFormData.estimatedHours = Math.round(next * 4) / 4;
  const disp = document.getElementById('tf-hours-display');
  if (disp) disp.textContent = `${_taskFormData.estimatedHours}h`;
}

function saveTask(editId) {
  const memberId = document.getElementById('tf-member')?.value;
  const content  = document.getElementById('tf-content')?.value?.trim();
  const note     = document.getElementById('tf-note')?.value?.trim() || '';
  const taskDate = document.getElementById('tf-date')?.value || DB.today();
  const askPayload = readTaskAskForm();
  if (!memberId) { showToast('担当者を選択してください', 'error'); return; }
  if (!content)  { showToast('タスク内容を入力してください', 'error'); return; }
  if (askPayload.hasAny && (!askPayload.toMemberId || !askPayload.dueText || !askPayload.content)) {
    showToast('進行確認は「誰に」「いつまでに」「内容」を入力してください', 'error');
    return;
  }

  const payload = {
    memberId,
    projectId: _taskFormData.projectId || null,
    phaseId:   _taskFormData.phaseId   || null,
    content,
    note,
    date: taskDate,
    estimatedHours: _taskFormData.estimatedHours || 1,
    sourceProjectName: _taskFormData.projectId ? '' : (_taskFormData.sourceProjectName || ''),
    needsProjectReview: _taskFormData.projectId ? false : Boolean(_taskFormData.needsProjectReview),
  };

  let savedTask;
  if (editId) {
    DB.Tasks.update(editId, payload);
    savedTask = DB.Tasks.get(editId);
    showToast('タスクを更新しました', 'success');
  } else {
    savedTask = DB.Tasks.add(payload);
    showToast('タスクを追加しました', 'success');
  }
  saveTaskLinkedAsk(savedTask, askPayload);
  closeModal();
  renderTodayTasks();
}

function readTaskAskForm() {
  const toMemberId = document.getElementById('tf-ask-to')?.value || '';
  const dueText = document.getElementById('tf-ask-due')?.value?.trim() || '';
  const content = document.getElementById('tf-ask-content')?.value?.trim() || '';
  return {
    toMemberId,
    dueText,
    content,
    hasAny: Boolean(toMemberId || dueText || content),
  };
}

function saveTaskLinkedAsk(task, askPayload) {
  if (!task) return;
  const existing = getTaskLinkedAsk(task.id);
  if (!askPayload.hasAny) {
    if (existing) DB.Asks.remove(existing.id);
    return;
  }

  const project = task.projectId ? DB.Projects.get(task.projectId) : null;
  const patch = {
    type: '確認',
    fromMemberId: task.memberId,
    toMemberId: askPayload.toMemberId,
    toName: '',
    content: askPayload.content,
    projectId: task.projectId || null,
    projectName: project ? `${project.clientName} / ${project.name}` : '',
    dueText: askPayload.dueText,
    status: 'open',
    date: task.date,
    taskId: task.id,
  };

  if (existing) {
    DB.Asks.update(existing.id, patch);
  } else {
    DB.Asks.add(patch);
  }
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

  if (!_bulkTaskData.date) _bulkTaskData.date = getTaskDefaultDate();
  if (!_bulkTaskData.memberId) _bulkTaskData.memberId = _taskFilter.memberId || _personalMemberId || '';

  const memberOpts = members.map(m =>
    `<option value="${m.id}" ${_bulkTaskData.memberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const ownerOpts = members.map(m =>
    `<option value="${m.id}" ${_bulkTaskData.ownerMemberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const showChatworkImport = !_personalMemberId && !_taskFilter.memberId;

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
      <label class="form-label">作業日 *</label>
      <input type="date" class="form-input" id="bulk-date" value="${_bulkTaskData.date || DB.today()}">
    </div>
    ${showChatworkImport ? `<div class="chatwork-import-box">
      <div class="task-ask-title">Chatworkから取得</div>
      <div class="form-help">最新100件から #task / #ask を含む投稿だけ取得します。取得後、内容を確認してから登録してください。</div>
      <div class="chatwork-import-grid">
        <div class="form-group">
          <label class="form-label">ルームID</label>
          <input type="text" class="form-input" id="cw-room-id"
                 value="${escHtml(getSavedChatworkRoomId())}"
                 placeholder="例：123456789">
        </div>
        <div class="form-group">
          <label class="form-label">取り込みキー</label>
          <input type="password" class="form-input" id="cw-import-key"
                 value="${escHtml(getSavedChatworkImportKey())}"
                 placeholder="未設定なら空でOK">
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" onclick="importChatworkMessages()">Chatwork取得</button>
    </div>` : ''}
    <div class="form-group">
      <label class="form-label">タスク本文 *</label>
      <textarea class="form-textarea bulk-textarea" id="bulk-text"
                placeholder="6月2日&#10;#task&#10;A社サイト制作 / トップページデザイン / 1 / 画像差し替え&#10;+ / 画像制作 / 1 / バナー用画像の制作&#10;? / 原稿確認 / 0.25 / プロジェクト名が不明&#10;&#10;#ask&#10;確認 / 田中さん / A社LPの画像方向を確認してください / A社サイト制作 / 今日中">${escHtml(_bulkTaskData.text || '')}</textarea>
      <div class="form-help">
        #task と #ask を同じ本文に貼れます。区切りは「,」または「/」です。日付だけの行を書くと、その下の行に同じ日付が入ります。「+」は直前と同じプロジェクト、「?」は未設定です。
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
  const date = document.getElementById('bulk-date')?.value || DB.today();
  const text = document.getElementById('bulk-text')?.value || '';
  _bulkTaskData = { memberId, ownerMemberId, date, text, preview: parseBulkInput(text) };

  const previewEl = document.getElementById('bulk-preview');
  if (previewEl) previewEl.innerHTML = bulkPreviewHTML(_bulkTaskData.preview);
}

function getSavedChatworkRoomId() {
  const roomId = String(localStorage.getItem(CHATWORK_ROOM_KEY) || '').trim();
  if (!roomId) return '';
  if (/^\d+$/.test(roomId)) return roomId;
  localStorage.removeItem(CHATWORK_ROOM_KEY);
  return '';
}

function getSavedChatworkImportKey() {
  return localStorage.getItem(CHATWORK_IMPORT_KEY) || '';
}

async function importChatworkMessages() {
  const roomId = document.getElementById('cw-room-id')?.value?.trim() || '';
  const importKey = document.getElementById('cw-import-key')?.value?.trim() || '';
  const textarea = document.getElementById('bulk-text');
  if (!roomId) {
    showToast('ChatworkのルームIDを入力してください', 'error');
    return;
  }
  if (!textarea) return;

  localStorage.setItem(CHATWORK_ROOM_KEY, roomId);
  if (importKey) localStorage.setItem(CHATWORK_IMPORT_KEY, importKey);

  try {
    showToast('Chatworkから取得しています', 'info');
    const res = await fetch(`/api/chatwork/messages?roomId=${encodeURIComponent(roomId)}&force=1`, {
      headers: importKey ? { 'x-taskboard-key': importKey } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Chatwork取得に失敗しました', 'error');
      return;
    }

    const text = chatworkMessagesToBulkText(data.messages || []);
    if (!text) {
      showToast('#task / #ask を含む投稿が見つかりませんでした', 'info');
      return;
    }

    if (textarea.value.trim() && !confirm('今の入力欄をChatworkの内容で置き換えますか？')) return;
    textarea.value = text;
    _bulkTaskData.text = text;
    previewBulkTasks();
    showToast(`${data.importedCount || 0}件のChatwork投稿を取り込みました`, 'success');
  } catch {
    showToast('Chatwork取得APIに接続できませんでした。公開版で設定を確認してください', 'error');
  }
}

async function importChatworkTasksDirect() {
  let roomId = getSavedChatworkRoomId();
  const importKey = getSavedChatworkImportKey();
  const targetDate = getTaskDefaultDate();
  const ownerMemberId = getDefaultOwnerMemberId();

  try {
    showToast('ChatworkからTASK部屋を確認しています', 'info');
    const roomQuery = /^\d+$/.test(roomId) ? `roomId=${encodeURIComponent(roomId)}&` : '';
    const res = await fetch(`/api/chatwork/messages?${roomQuery}force=1`, {
      headers: importKey ? { 'x-taskboard-key': importKey } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Chatwork取得に失敗しました', 'error');
      return;
    }

    roomId = String(data.roomId || roomId || '').trim();
    if (roomId) localStorage.setItem(CHATWORK_ROOM_KEY, roomId);

    const result = importChatworkMessageList({
      roomId,
      messages: data.messages || [],
      targetDate,
      ownerMemberId,
    });

    if (result.importedMessages === 0 && result.skippedDuplicates > 0) {
      showToast('新しく取り込むTASKはありませんでした', 'info');
    } else if (result.importedMessages === 0) {
      showToast('#task / #ask の新規投稿が見つかりませんでした', 'info');
    } else {
      showToast(`${result.taskCount}件のタスク、${result.askCount}件の確認を取り込みました`, 'success');
    }

    if (result.unknownMembers.length) {
      showToast(`未登録メンバーの投稿は未取り込みです：${result.unknownMembers.join('、')}`, 'error');
    }
    if (result.projectReviews.length) {
      showToast(`プロジェクト確認が必要な投稿が ${result.projectReviews.length}件あります`, 'info');
      await notifyProjectReviewsToChatwork(roomId, result.projectReviews, importKey);
    }

    _taskFilter.date = targetDate;
    _taskFilter.startDate = targetDate;
    _taskFilter.endDate = targetDate;
    renderTodayTasks();
    updateMorningBadge();
  } catch {
    showToast('Chatwork取得APIに接続できませんでした。Vercel設定を確認してください', 'error');
  }
}

function importChatworkMessageList({ roomId, messages, targetDate, ownerMemberId }) {
  const result = {
    importedMessages: 0,
    skippedDuplicates: 0,
    taskCount: 0,
    askCount: 0,
    unknownMembers: [],
    projectReviews: [],
  };

  (messages || []).forEach(message => {
    const messageId = String(message.message_id || '');
    if (!messageId) return;
    if (DB.ChatworkImports.has(roomId, messageId)) {
      result.skippedDuplicates++;
      return;
    }

    const accountName = message.account?.name || '';
    const member = findMemberByName(accountName);
    if (!member) {
      if (accountName && !result.unknownMembers.includes(accountName)) result.unknownMembers.push(accountName);
      return;
    }

    const normalizedBody = normalizeChatworkBody(message.body || '');
    const parsed = parseBulkInput(normalizedBody);
    const taskResult = saveParsedChatworkTasks(parsed.tasks, member.id, targetDate, ownerMemberId);
    const taskCount = taskResult.count;
    const askCount = saveParsedChatworkAsks(parsed.asks, member.id, targetDate);

    if (taskCount || askCount) {
      DB.ChatworkImports.add({
        roomId,
        messageId,
        accountName,
        taskCount,
        askCount,
      });
      result.importedMessages++;
      result.taskCount += taskCount;
      result.askCount += askCount;
      if (taskResult.reviewGroups.length) {
        const review = DB.ProjectReviews.add({
          roomId,
          messageId,
          accountName,
          memberId: member.id,
          groups: taskResult.reviewGroups,
        });
        if (review) result.projectReviews.push(review);
      }
    }
  });

  return result;
}

async function notifyProjectReviewsToChatwork(roomId, reviews, importKey = '') {
  for (const review of reviews) {
    const body = projectReviewChatworkMessage(review);
    try {
      const res = await fetch('/api/chatwork/reply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(importKey ? { 'x-taskboard-key': importKey } : {}),
        },
        body: JSON.stringify({ roomId, body }),
      });
      if (!res.ok) throw new Error('reply failed');
    } catch {
      console.warn('Chatwork project review reply failed:', review.id);
      showToast('プロジェクト確認URLのChatwork返信に失敗しました', 'error');
    }
  }
}

function projectReviewChatworkMessage(review) {
  const member = review.memberId ? DB.Members.get(review.memberId) : null;
  const reviewUrl = getProjectReviewUrl(review.id);
  const lines = [];
  review.groups.forEach((group, index) => {
    const tasks = (group.taskIds || []).map(id => DB.Tasks.get(id)).filter(Boolean);
    lines.push(`${index + 1}. ${group.sourceProjectName}`);
    tasks.slice(0, 5).forEach(task => lines.push(`- ${task.content} / ${task.estimatedHours}h`));
    if (tasks.length > 5) lines.push(`- ほか${tasks.length - 5}件`);
  });

  return [
    '[info][title]プロジェクト確認が必要です[/title]',
    member ? `投稿者：${member.name}` : review.accountName ? `投稿者：${review.accountName}` : '',
    `対象：${review.groups.length}件`,
    '',
    ...lines,
    '',
    '下記URLから、正しいプロジェクトを選んでください。',
    reviewUrl,
    '[/info]',
  ].filter(Boolean).join('\n');
}

function getProjectReviewUrl(reviewId) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('project_review', reviewId);
  return url.toString();
}

function saveParsedChatworkTasks(taskParsed, memberId, date, ownerMemberId) {
  const result = { count: 0, reviewGroups: [] };
  (taskParsed.groups || []).forEach(group => {
    const project = resolveInputProject(group.projectName);
    const createdTaskIds = [];

    (group.tasks || []).forEach(task => {
      const saved = DB.Tasks.add({
        memberId,
        projectId: project?.id || null,
        phaseId: null,
        content: task.content,
        note: buildInputTaskNote(task.note, group.projectName, project),
        date: task.date || date,
        estimatedHours: task.hours,
        sourceProjectName: project ? '' : (group.projectName || ''),
        needsProjectReview: Boolean(group.projectName && !project),
      });
      createdTaskIds.push(saved.id);
      result.count++;
    });

    if (group.projectName && !project && createdTaskIds.length) {
      result.reviewGroups.push({
        sourceProjectName: group.projectName,
        taskIds: createdTaskIds,
        suggestionProjectIds: findSimilarProjects(group.projectName).map(p => p.id),
      });
    }
  });
  return result;
}

function saveParsedChatworkAsks(asks, memberId, date) {
  let count = 0;
  (asks || []).forEach(ask => {
    const toMember = ask.toName === '全員' ? null : findMemberByName(ask.toName);
    const project = ask.projectName ? findProjectByName(ask.projectName) : null;
    DB.Asks.add({
      type: ask.type,
      fromMemberId: memberId,
      toMemberId: toMember?.id || '',
      toName: ask.toName,
      content: ask.content,
      projectId: project?.id || null,
      projectName: ask.projectName,
      dueText: ask.dueText,
      date: ask.date || date,
    });
    count++;
  });
  return count;
}

function chatworkMessagesToBulkText(messages) {
  return messages
    .map(m => normalizeChatworkBody(m.body || ''))
    .filter(body => /(^|\n)\s*#(?:task|ask)\b/i.test(body))
    .join('\n\n');
}

function normalizeChatworkBody(body) {
  return String(body || '')
    .replace(/\[To:\d+\][^\n]*\n?/g, '')
    .replace(/\[rp aid=\d+ to=\d+-\d+\][^\n]*\n?/g, '')
    .replace(/\[info\]|\[\/info\]/g, '')
    .replace(/\[title\]|\[\/title\]/g, '')
    .trim();
}

function saveBulkTasks() {
  const memberId = document.getElementById('bulk-member')?.value || '';
  const ownerMemberId = document.getElementById('bulk-owner')?.value || getDefaultOwnerMemberId();
  const date = document.getElementById('bulk-date')?.value || DB.today();
  const text = document.getElementById('bulk-text')?.value || '';
  if (!memberId) { showToast('タスク担当者を選択してください', 'error'); return; }
  if (!ownerMemberId) { showToast('先にメンバーを登録してください', 'error'); return; }

  const parsed = parseBulkInput(text);
  const totalTasks = parsed.tasks.groups.reduce((sum, group) => sum + group.tasks.length, 0);
  const totalAsks = parsed.asks.length;
  if (!totalTasks && !totalAsks) { showToast('登録できる内容が見つかりません', 'error'); return; }

  parsed.tasks.groups.forEach(group => {
    const project = resolveInputProject(group.projectName);

    group.tasks.forEach(task => {
      DB.Tasks.add({
        memberId,
        projectId: project?.id || null,
        phaseId: null,
        content: task.content,
        note: buildInputTaskNote(task.note, group.projectName, project),
        date: task.date || date,
        estimatedHours: task.hours,
        sourceProjectName: project ? '' : (group.projectName || ''),
        needsProjectReview: Boolean(group.projectName && !project),
      });
    });
  });

  parsed.asks.forEach(ask => {
    const toMember = ask.toName === '全員' ? null : findMemberByName(ask.toName);
    const project = ask.projectName ? findProjectByName(ask.projectName) : null;
    DB.Asks.add({
      type: ask.type,
      fromMemberId: memberId,
      toMemberId: toMember?.id || '',
      toName: ask.toName,
      content: ask.content,
      projectId: project?.id || null,
      projectName: ask.projectName,
      dueText: ask.dueText,
      date: ask.date || date,
    });
  });

  _taskFilter.date = date;
  _taskFilter.startDate = date;
  _taskFilter.endDate = date;
  _bulkTaskData = { memberId, ownerMemberId, date, text: '', preview: null };
  closeModal();
  showToast(`${totalTasks}件のタスク、${totalAsks}件の進行確認を登録しました`, 'success');
  renderTodayTasks();
}

function parseBulkInput(text) {
  const sections = splitBulkSections(text);
  const taskText = sections.task.join('\n');
  const askText = sections.ask.join('\n');
  return {
    tasks: parseBulkTaskText(taskText || (sections.hasAsk ? '' : text)),
    asks: parseAskText(askText),
  };
}

function splitBulkSections(text) {
  const sections = { task: [], ask: [], hasTask: false, hasAsk: false };
  let mode = '';
  (text || '').split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (/^#task\b/i.test(line)) { mode = 'task'; sections.hasTask = true; return; }
    if (/^#ask\b/i.test(line)) { mode = 'ask'; sections.hasAsk = true; return; }
    if (!mode) mode = 'task';
    sections[mode].push(raw);
  });
  return sections;
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

    if (normalizeInputDate(trimmed)) return;

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
  let currentDate = '';

  (text || '').split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line) {
      pushLabelledTask(rows, labelled, currentDate);
      labelled = {};
      return;
    }

    const standaloneDate = normalizeInputDate(line);
    if (standaloneDate) {
      pushLabelledTask(rows, labelled, currentDate);
      labelled = {};
      currentDate = standaloneDate;
      return;
    }

    if (/^(日付|作業日|予定日|プロジェクト名|プロジェクト|案件名|案件|タスク|作業|時間|工数|内容|詳細|備考|コメント|相談)\s*[:：]/.test(line)) {
      const [, key, value] = line.match(/^(日付|作業日|予定日|プロジェクト名|プロジェクト|案件名|案件|タスク|作業|時間|工数|内容|詳細|備考|コメント|相談)\s*[:：]\s*(.*)$/) || [];
      if (key) {
        const normalizedKey = normalizeChatTaskKey(key);
        labelled[normalizedKey] = value.trim();
      }
      return;
    }

    const cells = splitTaskRow(line);
    if (cells.length >= 3 && !isBulkHeaderRow(cells)) {
      rows.push(rowToTask(cells, currentDate));
    }
  });
  pushLabelledTask(rows, labelled, currentDate);

  const groups = [];
  let currentProject = '';
  rows.filter(Boolean).forEach(row => {
    const marker = row.projectName.trim();
    let projectName = marker;

    if (marker === '+' || marker === '＋') {
      projectName = currentProject;
    } else if (marker === '?' || marker === '？' || !marker) {
      projectName = '';
    } else {
      currentProject = marker;
    }

    let group = groups.find(g => g.projectName === projectName);
    if (!group) {
      group = { projectName, tasks: [] };
      groups.push(group);
    }
    group.tasks.push({
      content: row.content,
      hours: row.hours,
      note: row.note,
      date: row.date,
    });
  });

  return { groups: groups.filter(group => group.tasks.length) };
}

function parseAskText(text) {
  const asks = [];
  let currentDate = '';
  (text || '').split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line) return;

    const standaloneDate = normalizeInputDate(line);
    if (standaloneDate) {
      currentDate = standaloneDate;
      return;
    }

    const cells = splitTaskRow(line);
    if (cells.length < 3 || isAskHeaderRow(cells)) return;

    let date = currentDate;
    let askCells = cells;
    const firstDate = normalizeInputDate(cells[0]);
    if (firstDate) {
      date = firstDate;
      askCells = cells.slice(1);
    }
    const [type = '質問', toName = '', content = '', projectName = '', dueText = ''] = askCells;
    asks.push({
      type: normalizeAskKind(type),
      toName: toName.trim(),
      content: content.trim(),
      projectName: projectName.trim(),
      dueText: dueText.trim(),
      date,
    });
  });
  return asks.filter(ask => ask.toName && ask.content);
}

function isAskHeaderRow(cells) {
  return /^(日付|作業日|予定日)?種別宛先内容(関連プロジェクト|プロジェクト)?期限?$/.test(cells.join('').replace(/\s/g, ''));
}

function normalizeAskKind(type) {
  const raw = String(type || '').trim();
  if (/確認/.test(raw)) return '確認';
  if (/依頼|お願い/.test(raw)) return '依頼';
  if (/共有|報告/.test(raw)) return '共有';
  return '質問';
}

function splitTaskRow(line) {
  const text = String(line || '').trim();
  if (!text) return [];
  if (/\t|,|、/.test(text)) return cleanTaskCells(text.split(/\t|,|、/));

  const protectedText = protectDateSlashes(text);
  if (/[\/／]/.test(protectedText)) {
    return cleanTaskCells(protectedText.split(/[\/／]/));
  }
  return cleanTaskCells([text]);
}

function cleanTaskCells(cells) {
  return cells
    .map(cell => restoreDateSlashes(String(cell).trim()))
    .filter(Boolean);
}

function protectDateSlashes(text) {
  return String(text || '').replace(/(\d{1,4})\/(\d{1,2})(?:\/(\d{1,2}))?/g, (match, a, b, c) => {
    return c
      ? `${a}__DATE_SLASH__${b}__DATE_SLASH__${c}`
      : `${a}__DATE_SLASH__${b}`;
  });
}

function restoreDateSlashes(text) {
  return String(text || '').replace(/__DATE_SLASH__/g, '/');
}

function isBulkHeaderRow(cells) {
  return /^(日付|作業日|予定日)?プロジェクト名タスク時間内容(備考|コメント|相談)?$/.test(cells.join('').replace(/\s/g, ''));
}

function normalizeChatTaskKey(key) {
  if (/日付|作業日|予定日/.test(key)) return 'date';
  if (/プロジェクト|案件/.test(key)) return 'projectName';
  if (/タスク|作業/.test(key)) return 'task';
  if (/時間|工数/.test(key)) return 'hours';
  if (/備考|コメント|相談/.test(key)) return 'note';
  return 'detail';
}

function pushLabelledTask(rows, data, fallbackDate = '') {
  if (!data || !Object.keys(data).length) return;
  if (!data.projectName && !data.task && !data.detail) return;
  rows.push(rowToTask([data.date || fallbackDate || '', data.projectName || '', data.task || '', data.hours || '', data.detail || '', data.note || ''], fallbackDate));
}

function rowToTask(cells, fallbackDate = '') {
  let date = fallbackDate || '';
  let taskCells = cells;
  const firstDate = normalizeInputDate(cells[0]);
  if (firstDate) {
    date = firstDate;
    taskCells = cells.slice(1);
  }
  const [projectName = '', taskName = '', hoursText = '', detail = '', ...noteParts] = taskCells;
  const hours = extractHours(hoursText);
  const contentParts = [taskName, detail].map(s => s.trim()).filter(Boolean);
  const note = noteParts.join('、').trim();
  return {
    date,
    projectName: projectName.trim(),
    content: contentParts.join(' - ') || '未入力タスク',
    hours,
    note,
  };
}

function normalizeInputDate(value) {
  const raw = normalizeNumberText(String(value || '').trim())
    .replace(/\s+/g, '')
    .replace(/[（(][月火水木金土日][)）]$/, '');
  if (!raw) return '';
  if (raw === '今日') return DB.today();
  if (raw === '昨日') return DB.yesterday();
  if (raw === '明日') return tomorrowDate();

  let match = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (match) return datePartsToISO(match[1], match[2], match[3]);

  match = raw.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/);
  if (match) return datePartsToISO(new Date().getFullYear(), match[1], match[2]);

  return '';
}

function datePartsToISO(year, month, day) {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  const date = new Date(`${y}-${m}-${d}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  if (date.getFullYear() !== Number(y) || date.getMonth() + 1 !== Number(m) || date.getDate() !== Number(d)) return '';
  return `${y}-${m}-${d}`;
}

function resolveInputProject(projectName) {
  if (!projectName) return null;
  return findProjectByName(projectName);
}

function buildInputTaskNote(note, projectName, project) {
  const parts = [];
  if (projectName && !project) parts.push(`元プロジェクト名：${projectName}`);
  if (note) parts.push(note);
  return parts.join(' / ');
}

function extractHours(value) {
  const normalized = normalizeNumberText(String(value || ''));
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Math.max(0.25, parseFloat(match[1])) : 1;
}

async function copyBulkTaskTemplate() {
  const template = [
    'タスクを以下の形式で送ってください。',
    '',
    '6月2日',
    '#task',
    'プロジェクト名 / タスク / 時間 / 内容 / 備考',
    '例）A社サイト制作 / トップページデザイン / 1 / 画像差し替え',
    '例）+ / 画像制作 / 1 / バナー用画像の制作',
    '例）? / 原稿確認 / 0.25 / プロジェクト名が不明',
    '',
    '※ 区切りは「,」でも「/」でもOKです。',
    '※ 先頭に日付だけを書くと、その下のタスク全部に同じ日付が入ります。',
    '※ 先頭が「+」なら、直前と同じプロジェクトです。',
    '※ 先頭が「?」なら、プロジェクト未設定として登録されます。',
    '※ プロジェクトはアプリに登録済みのものだけ紐づきます。未登録名は確認待ちとして残ります。',
    '※ 備考には、作業メモ・補足・引き継ぎを書いてください。',
    '',
    '#ask',
    '※ #ask は進行が止まる確認、次工程に渡す確認だけに使ってください。',
    '種別 / 宛先 / 内容 / 関連プロジェクト / 期限',
    '例）確認 / 田中さん / A社LPの画像方向を確認してください / A社サイト制作 / 今日中',
    '例）共有 / 全員 / 先方確認が戻りました / A社広告 / -',
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
  const hours = match ? Math.max(0.25, parseFloat(match[1])) : 1;
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
  const taskParsed = parsed.tasks || parsed;
  const asks = parsed.asks || [];
  if (!taskParsed.groups.length && !asks.length) {
    return `<div class="bulk-preview empty">登録候補がありません</div>`;
  }

  const missingTasks = getMissingProjectTasks(taskParsed);

  return `
    <div class="bulk-preview">
      <div class="bulk-preview-title">登録前の確認</div>
      ${missingTasks.length ? `
        <div class="bulk-alert">
          <div>
            <strong>プロジェクト未設定が ${missingTasks.length}件あります。</strong>
            <p>登録はできます。あとで本人が個人URLから開いて、タスク編集でプロジェクトを直してください。</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="copyMissingProjectMessage()">Chatwork文をコピー</button>
        </div>
      ` : ''}
      ${taskParsed.groups.map(group => {
        const project = group.projectName ? resolveInputProject(group.projectName) : null;
        const projectMissing = Boolean(group.projectName && !project);
        return `
          <div class="bulk-preview-group">
            <div class="bulk-project-name">
              ${group.projectName
                ? `${projectMissing ? '<span class="status-badge provisional">確認待ち</span>' : '<span class="status-badge recurring">登録済み</span>'} ${escHtml(project ? `${project.clientName} / ${project.name}` : group.projectName)}`
                : '<span class="status-badge personal">個人タスク</span>'}
            </div>
            <ul>
              ${group.tasks.map(task => `
                <li>
                  <div>
                    ${task.date ? `${taskDateTagHTML(task.date)} ` : ''}
                    ${escHtml(task.content)}
                    ${task.note ? `<div class="bulk-note">備考：${escHtml(task.note)}</div>` : ''}
                  </div>
                  <span>${task.hours}h</span>
                </li>`).join('')}
            </ul>
          </div>`;
      }).join('')}
      ${asks.length ? `
        <div class="bulk-preview-group ask-preview-group">
          <div class="bulk-project-name">
            <span class="status-badge ask">進行確認</span>
            ${asks.length}件
          </div>
          <ul>
            ${asks.map(ask => `
              <li>
                <div>
                  <span class="ask-inline-type">${escHtml(ask.type)}</span>
                  ${ask.date ? `${taskDateTagHTML(ask.date)} ` : ''}
                  ${escHtml(ask.toName)}へ：${escHtml(ask.content)}
                  ${ask.projectName ? `<div class="bulk-note">関連：${escHtml(ask.projectName)}</div>` : ''}
                </div>
                <span>${escHtml(ask.dueText || '-')}</span>
              </li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>`;
}

function getMissingProjectTasks(parsed) {
  return (parsed.groups || [])
    .filter(group => !group.projectName || !resolveInputProject(group.projectName))
    .flatMap(group => group.tasks || []);
}

async function copyMissingProjectMessage() {
  const text = document.getElementById('bulk-text')?.value || _bulkTaskData.text || '';
  const parsed = parseBulkInput(text);
  const missingTasks = getMissingProjectTasks(parsed.tasks);
  const memberId = document.getElementById('bulk-member')?.value || _bulkTaskData.memberId || _personalMemberId || '';
  const member = memberId ? DB.Members.get(memberId) : null;
  const url = memberId ? getMemberPageUrl(memberId) : window.location.href;

  if (!missingTasks.length) {
    showToast('未設定タスクはありません', 'info');
    return;
  }

  const message = [
    '[info][title]プロジェクト未設定のタスクがあります[/title]',
    '下のタスクにプロジェクト名が入っていません。',
    member ? `${member.name}さんの個人ページから開いて、タスク編集でプロジェクトを直してください。` : '個人ページから開いて、タスク編集でプロジェクトを直してください。',
    '',
    ...missingTasks.map((task, i) => `${i + 1}. ${task.content} / ${task.hours}h${task.note ? ` / ${task.note}` : ''}`),
    '',
    `修正URL：${url}`,
    '[/info]',
  ].join('\n');

  try {
    await navigator.clipboard.writeText(message);
    showToast('Chatwork用の修正依頼文をコピーしました', 'success');
  } catch {
    window.prompt('この文章をコピーしてください', message);
  }
}

/* ============================================================
   プロジェクト確認URL
   ============================================================ */
function renderProjectReviewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  renderProjectReviewPage(params.get('project_review'));
}

function renderProjectReviewPage(reviewId) {
  const main = document.getElementById('main-content');
  const review = reviewId ? DB.ProjectReviews.get(reviewId) : null;
  if (!review) {
    main.innerHTML = `
      <div class="page-header"><div class="page-header-left">
        <h2>プロジェクト確認</h2>
        <p>確認対象が見つかりません</p>
      </div></div>
      <div class="page-body fade-in">
        <div class="empty-state">
          <div class="icon">?</div>
          <div class="title">確認URLが無効です</div>
          <div class="sub">すでに削除されたか、別の端末でまだ同期されていない可能性があります。</div>
          <button class="btn btn-primary btn-sm" onclick="navigate('tasks')">今日のタスクへ</button>
        </div>
      </div>`;
    return;
  }

  const member = review.memberId ? DB.Members.get(review.memberId) : null;
  const taskCount = review.groups.reduce((sum, group) => sum + (group.taskIds || []).length, 0);
  main.innerHTML = `
    <div class="page-header"><div class="page-header-left">
      <h2>プロジェクト確認</h2>
      <p>Chatworkから取り込んだタスクの紐付け先を選んでください</p>
    </div></div>
    <div class="page-body fade-in">
      <div class="banner banner-info">
        <span>投稿者：${escHtml(member?.name || review.accountName || '不明')}</span>
        <span>対象タスク：${taskCount}件</span>
        <span>状態：${review.status === 'open' ? '確認待ち' : '確認済み'}</span>
      </div>
      <div class="card">
        ${(review.groups || []).map((group, index) => projectReviewGroupHTML(group, index)).join('')}
        <div class="modal-actions" style="margin-top:18px">
          <button class="btn btn-ghost" onclick="navigate('tasks')">戻る</button>
          <button class="btn btn-primary" onclick="saveProjectReview('${review.id}')">紐付けを保存</button>
        </div>
      </div>
    </div>`;
}

function projectReviewGroupHTML(group, index) {
  const tasks = (group.taskIds || []).map(id => DB.Tasks.get(id)).filter(Boolean);
  const suggestions = (group.suggestionProjectIds || []).map(id => DB.Projects.get(id)).filter(Boolean);
  const suggestionOptions = suggestions.length
    ? suggestions.map(project => `<option value="${project.id}">${escHtml(project.clientName)} / ${escHtml(project.name)}${project.deliveryDate ? `（納品 ${escHtml(DB.fmtDate(project.deliveryDate))}）` : ''}</option>`).join('')
    : '<option value="" disabled>類似プロジェクトが見つかりません</option>';

  return `
    <div class="bulk-preview-group project-review-group">
      <div class="bulk-project-name">
        <span class="status-badge provisional">確認待ち</span>
        入力されたプロジェクト名：${escHtml(group.sourceProjectName)}
      </div>
      <ul>
        ${tasks.map(task => `
          <li>
            <div>
              ${task.date ? `${taskDateTagHTML(task.date)} ` : ''}
              ${escHtml(task.content)}
              ${task.note ? `<div class="bulk-note">備考：${escHtml(task.note)}</div>` : ''}
            </div>
            <span>${task.estimatedHours}h</span>
          </li>`).join('')}
      </ul>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">紐付け先</label>
        <select class="form-select" id="project-review-select-${index}">
          ${suggestionOptions}
          <option value="__new__">新規プロジェクトとして作成</option>
          <option value="__admin__">佐久間確認に回す</option>
        </select>
      </div>
    </div>`;
}

function saveProjectReview(reviewId) {
  const review = DB.ProjectReviews.get(reviewId);
  if (!review) return;

  let unresolved = 0;
  (review.groups || []).forEach((group, index) => {
    const selected = document.getElementById(`project-review-select-${index}`)?.value || '';
    if (!selected || selected === '__admin__') {
      unresolved++;
      return;
    }

    let projectId = selected;
    if (selected === '__new__') {
      const parsed = parseProjectName(group.sourceProjectName || '未設定プロジェクト');
      const project = DB.Projects.add({
        clientName: parsed.clientName,
        name: parsed.name,
        deliveryDate: '',
        budget: '',
        templateId: 'tpl_blank',
        projectType: parsed.recurringSeries ? 'recurring' : 'provisional',
        recurringSeries: parsed.recurringSeries || '',
        ownerMemberId: review.memberId || '',
        isProvisional: true,
        detailsDueAt: tomorrowDate(),
      });
      projectId = project.id;
    }

    (group.taskIds || []).forEach(taskId => {
      DB.Tasks.update(taskId, {
        projectId,
        sourceProjectName: '',
        needsProjectReview: false,
      });
    });
  });

  DB.ProjectReviews.update(reviewId, {
    status: unresolved ? 'pending_admin' : 'resolved',
    resolvedAt: unresolved ? '' : new Date().toISOString(),
  });
  showToast(unresolved ? '一部を佐久間確認に残しました' : 'プロジェクトを紐付けました', 'success');
  navigate('tasks');
}

/* ============================================================
   プロジェクト
   ============================================================ */
let _projectView = 'active'; // 'active' | 'archived'
let _projectOwnerFilter = '';

function renderProjects() {
  const main     = document.getElementById('main-content');
  const members  = DB.Members.all();
  const baseProjects = _projectView === 'active' ? DB.Projects.active() : DB.Projects.archived();
  const filteredProjects = baseProjects.filter(project => {
    if (_projectOwnerFilter === '__none__') return !project.ownerMemberId;
    if (_projectOwnerFilter) return project.ownerMemberId === _projectOwnerFilter;
    return true;
  });
  const projects = sortProjectsByDelivery(filteredProjects);
  const missingDelivery = projects.filter(p => !p.deliveryDate);
  const ownerOptions = members.map(m =>
    `<option value="${m.id}" ${_projectOwnerFilter === m.id ? 'selected' : ''}>${escHtml(m.name)}</option>`
  ).join('');

  main.innerHTML = `
    <div class="page-header"><div class="page-header-left">
      <h2>プロジェクト</h2>
      <p>プロジェクトとフェーズの管理</p>
    </div></div>
    <div class="page-body fade-in">
      ${missingDelivery.length ? `
        <div class="banner banner-warning">
          <span>納品日未設定のプロジェクトが ${missingDelivery.length}件あります。プロジェクト編集から納品日を入力してください。</span>
        </div>
      ` : ''}

      <div class="action-row">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="tab-bar" style="margin-bottom:0">
            <button class="btn ${_projectView==='active'   ? 'btn-primary' : 'btn-ghost'}"
                    onclick="_projectView='active';renderProjects()">進行中</button>
            <button class="btn ${_projectView==='archived' ? 'btn-primary' : 'btn-ghost'}"
                    onclick="_projectView='archived';renderProjects()">アーカイブ</button>
          </div>
          <select class="form-select" style="width:170px" onchange="_projectOwnerFilter=this.value;renderProjects()">
            <option value="" ${!_projectOwnerFilter ? 'selected' : ''}>全窓口</option>
            ${ownerOptions}
            <option value="__none__" ${_projectOwnerFilter === '__none__' ? 'selected' : ''}>窓口未設定</option>
          </select>
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

function sortProjectsByDelivery(projects) {
  return [...projects].sort((a, b) => {
    if (a.deliveryDate && b.deliveryDate) return a.deliveryDate.localeCompare(b.deliveryDate);
    if (a.deliveryDate) return -1;
    if (b.deliveryDate) return 1;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

function projectCard(project) {
  const phases    = project.phases || [];
  const allTasks  = DB.Tasks.all();
  const owner = project.ownerMemberId ? DB.Members.get(project.ownerMemberId) : null;
  const statusBadges = [
    project.projectType === 'recurring' ? '<span class="status-badge recurring">定期案件</span>' : '',
    project.isProvisional ? '<span class="status-badge provisional">仮登録</span>' : '',
    project.projectStatus === 'paused' ? '<span class="status-badge personal">保留</span>' : '',
    project.projectStatus === 'completed' ? '<span class="status-badge personal">完了</span>' : '',
    !project.deliveryDate ? '<span class="status-badge missing">納期未設定</span>' : '',
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
  const completeBtn = project.projectStatus === 'completed'
    ? `<button class="btn btn-ghost btn-sm" onclick="reopenProject('${project.id}')">進行中に戻す</button>`
    : `<button class="btn btn-success btn-sm" onclick="completeProject('${project.id}')">完了</button>`;

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
          <div class="project-meta">
            <span class="project-meta-item ${project.deliveryDate ? '' : 'missing'}">
              <strong>納品日</strong>${project.deliveryDate ? DB.fmtDate(project.deliveryDate) : '未設定'}
            </span>
            ${project.budget ? `<span class="project-meta-item"><strong>予算</strong>¥${Number(project.budget).toLocaleString()}</span>` : ''}
            ${project.recurringSeries ? `<span class="project-meta-item"><strong>定期案件</strong>${escHtml(project.recurringSeries)}</span>` : ''}
            <span class="project-meta-item"><strong>窓口</strong>${owner ? escHtml(owner.name) : '未設定'}</span>
            ${project.detailsDueAt ? `<span class="project-meta-item"><strong>詳細登録期限</strong>${DB.fmtDate(project.detailsDueAt)}</span>` : ''}
          </div>
          ${!project.deliveryDate ? `
            <div class="project-warning">
              納品日が未設定です。
              <button class="btn btn-ghost btn-sm" onclick="copyDeliveryDateRequest('${project.id}')">Chatwork文をコピー</button>
              <button class="btn btn-ghost btn-sm" onclick="sendDeliveryDateRequest('${project.id}')">窓口へ送信</button>
            </div>
          ` : ''}
          ${project.note ? `<div class="form-help" style="margin-top:8px">${escHtml(project.note)}</div>` : ''}
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="openProjectTasksModal('${project.id}')">タスク一覧</button>
          <button class="btn btn-ghost btn-sm" onclick="openProjectModal('${project.id}')">編集</button>
          ${completeBtn}
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

function openProjectTasksModal(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  const tasks = DB.Tasks.all()
    .filter(t => t.projectId === projectId)
    .sort((a, b) => {
      if ((a.completed === true) !== (b.completed === true)) return a.completed === true ? 1 : -1;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
  const totalH = tasks.reduce((sum, task) => sum + (Number(task.estimatedHours) || 0), 0);
  const doneCount = tasks.filter(t => t.completed === true).length;
  const title = `${project.clientName} / ${project.name} のタスク`;

  openModal(`
    <div class="form-help" style="margin-bottom:12px">
      ${tasks.length}件 / ${totalH}h　完了 ${doneCount}件・未完了 ${tasks.length - doneCount}件
    </div>
    <div style="max-height:60vh;overflow:auto;padding-right:4px">
      ${tasks.length
        ? tasks.map(t => projectTaskListRow(t)).join('')
        : `<div class="empty-state" style="padding:28px">
            <div class="icon">📝</div>
            <div class="title">このプロジェクトのタスクはありません</div>
          </div>`}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">閉じる</button>
      <button class="btn btn-primary" onclick="openTaskModal(null)">タスクを追加</button>
    </div>
  `, title);
}

function projectTaskListRow(task) {
  const member = DB.Members.get(task.memberId);
  const phaseName = getPhaseName(task);
  const isDone = task.completed === true;
  const originDate = sourceDateForTask(task);
  return `
    <div class="task-row ${task.carriedFromTaskId ? 'task-row-carry' : ''} ${isDone ? 'task-row-done' : ''}" style="margin-bottom:8px">
      <button class="check-btn ${isDone ? 'done' : ''}"
              onclick="toggleProjectTaskComplete('${task.id}')"
              title="${isDone ? '未完了に戻す' : '完了にする'}"
              aria-label="${isDone ? '未完了に戻す' : '完了にする'}">✓</button>
      <div class="task-accent-bar"></div>
      <div class="flex-1">
        <div class="task-title">${escHtml(task.content)}</div>
        ${task.note ? `<div class="task-note">備考：${escHtml(task.note)}</div>` : ''}
        <div class="task-meta">
          ${taskDateTagHTML(originDate, { carried: Boolean(task.carriedFromTaskId) })}
          <span>担当：${member ? escHtml(member.name) : '未設定'}</span>
          ${phaseName ? `<span class="tag tag-phase">${escHtml(phaseName)}</span>` : '<span style="color:var(--text-3)">フェーズなし</span>'}
          ${task.carriedFromTaskId ? '<span class="tag tag-carry tag-carry-strong">繰り越し</span>' : ''}
          ${isDone ? '<span class="tag tag-done">完了</span>' : ''}
          <span class="tag-hours">${task.estimatedHours}h</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="openTaskModal('${task.id}')">編集</button>
    </div>`;
}

async function toggleProjectTaskComplete(taskId) {
  const task = DB.Tasks.get(taskId);
  if (!task) return;
  DB.Tasks.setCompletion(taskId, task.completed === true ? null : true, '');
  await DB.syncCloudStore?.();
  const refreshed = DB.Tasks.get(taskId);
  if (refreshed?.projectId) openProjectTasksModal(refreshed.projectId);
  updateMorningBadge();
  if (_currentPage === 'projects') renderProjects();
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
  const currentPhases = readPhaseEditorValues(p);
  const newPh = { id: DB.genId(), name: '新フェーズ', status: 'pending', dueDate: '', order: currentPhases.length };
  DB.Projects.updatePhases(projectId, [...currentPhases, newPh]);
  openPhaseEditor(projectId);
}

function removePhaseFromEditor(projectId, phaseId) {
  const p = DB.Projects.get(projectId);
  if (!p) return;
  DB.Projects.updatePhases(projectId, readPhaseEditorValues(p).filter(ph => ph.id !== phaseId));
  openPhaseEditor(projectId);
}

function readPhaseEditorValues(project) {
  return (project.phases||[]).map(ph => {
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
}

function savePhaseEditor(projectId) {
  const p = DB.Projects.get(projectId);
  if (!p) return;
  const updated = readPhaseEditorValues(p);
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
  const status = project?.projectStatus === 'completed' ? 'active' : (project?.projectStatus || 'active');

  openModal(`
    <div class="form-help" style="margin-bottom:14px">
      納品日を基準に管理します。定期案件名は親シリーズ、プロジェクト名は今回分です。
    </div>
    <div class="form-group">
      <label class="form-label">プロジェクト種別</label>
      <select class="form-select" id="pj-type">
        <option value="standard" ${type === 'standard' ? 'selected' : ''}>通常プロジェクト</option>
        <option value="recurring" ${type === 'recurring' ? 'selected' : ''}>定期プロジェクト</option>
        <option value="provisional" ${type === 'provisional' ? 'selected' : ''}>仮プロジェクト</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">定期案件名</label>
      <input class="form-input" id="pj-recurring" placeholder="例：明治安田 月号 / プレゼントキャンペーン更新" value="${escHtml(project?.recurringSeries||'')}">
      <div class="form-help">定期案件だけ入力します。空欄でも保存できます。</div>
    </div>
    <div class="form-group">
      <label class="form-label">プロジェクト名 *</label>
      <input class="form-input" id="pj-name" placeholder="例：7月号 / 2026年7月切り替え / LP制作" value="${escHtml(project?.name||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">クライアント名 *</label>
      <input class="form-input" id="pj-client" placeholder="例：〇〇株式会社" value="${escHtml(project?.clientName||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">窓口担当</label>
      <select class="form-select" id="pj-owner">
        <option value="">未設定</option>${memberOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">納品日 *</label>
      <input type="date" class="form-input" id="pj-delivery" value="${project?.deliveryDate||''}">
    </div>
    <div class="form-group">
      <label class="form-label">進行状態</label>
      <select class="form-select" id="pj-status">
        <option value="active" ${status === 'active' ? 'selected' : ''}>進行中</option>
        <option value="paused" ${status === 'paused' ? 'selected' : ''}>保留</option>
      </select>
      <div class="form-help">プロジェクト完了は、一覧の「完了」ボタンで確定します。</div>
    </div>
    <div class="form-group">
      <label class="form-label">予算（円）</label>
      <input type="number" class="form-input" id="pj-budget" placeholder="例：500000" value="${project?.budget||''}">
    </div>
    <div class="form-group">
      <label class="form-label">詳細登録期限</label>
      <input type="date" class="form-input" id="pj-details-due" value="${project?.detailsDueAt||''}">
    </div>
    <div class="form-group">
      <label class="form-label">プロジェクト備考</label>
      <textarea class="form-input" id="pj-note" rows="3" placeholder="案件全体の注意点、前提、引き継ぎなど">${escHtml(project?.note||'')}</textarea>
      <div class="form-help">個別タスクの作業メモではなく、プロジェクト全体に関わる注意点だけを書きます。</div>
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
  const deliveryDate = document.getElementById('pj-delivery')?.value || '';
  if (!confirmProjectDeliveryDate(deliveryDate)) return;
  const projectType = document.getElementById('pj-type')?.value || 'standard';
  DB.Projects.add({
    clientName, name,
    deliveryDate,
    budget:       document.getElementById('pj-budget')?.value   || '',
    templateId:   document.getElementById('pj-template')?.value || '',
    projectType,
    recurringSeries: document.getElementById('pj-recurring')?.value?.trim() || '',
    ownerMemberId:   document.getElementById('pj-owner')?.value || getDefaultOwnerMemberId(),
    isProvisional:   projectType === 'provisional',
    detailsDueAt:    document.getElementById('pj-details-due')?.value || '',
    projectStatus:   document.getElementById('pj-status')?.value || 'active',
    note:            document.getElementById('pj-note')?.value?.trim() || '',
  });
  closeModal();
  showToast('プロジェクトを作成しました', 'success');
  renderProjects();
}

function saveProjectEdit(projectId) {
  const clientName = document.getElementById('pj-client')?.value?.trim();
  const name       = document.getElementById('pj-name')?.value?.trim();
  if (!clientName || !name) { showToast('クライアント名とプロジェクト名は必須です', 'error'); return; }
  const deliveryDate = document.getElementById('pj-delivery')?.value || '';
  if (!confirmProjectDeliveryDate(deliveryDate)) return;
  const projectType = document.getElementById('pj-type')?.value || 'standard';
  DB.Projects.update(projectId, {
    clientName, name,
    deliveryDate,
    budget:       document.getElementById('pj-budget')?.value   || '',
    projectType,
    recurringSeries: document.getElementById('pj-recurring')?.value?.trim() || '',
    ownerMemberId:   document.getElementById('pj-owner')?.value || '',
    isProvisional:   projectType === 'provisional',
    detailsDueAt:    document.getElementById('pj-details-due')?.value || '',
    projectStatus:   document.getElementById('pj-status')?.value || 'active',
    note:            document.getElementById('pj-note')?.value?.trim() || '',
  });
  closeModal();
  showToast('プロジェクトを更新しました', 'success');
  renderProjects();
}

function confirmProjectDeliveryDate(deliveryDate) {
  if (deliveryDate) return true;
  return confirm('納品日が未入力です。納品日は必須項目です。\n未入力のまま保存すると、プロジェクト画面に警告が出ます。\nこのまま保存しますか？');
}

function buildDeliveryDateRequestMessage(project, owner, withMention = false) {
  const url = getMemberProjectEditUrl(owner?.id || '', project.id);
  const projectName = `${project.clientName} / ${project.name}`;
  const mention = withMention && owner?.chatworkAccountId
    ? `[To:${owner.chatworkAccountId}] ${owner.name}さん\n`
    : '';
  return [
    mention + '[info][title]納品日の確認をお願いします[/title]',
    `${projectName} の納品日が未設定です。`,
    '下のURLから開いて、プロジェクト編集画面で納品日を入力してください。',
    '',
    `入力URL：${url}`,
    '[/info]',
  ].join('\n');
}

async function copyDeliveryDateRequest(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  const owner = project.ownerMemberId ? DB.Members.get(project.ownerMemberId) : null;
  const message = buildDeliveryDateRequestMessage(project, owner, false);

  try {
    await navigator.clipboard.writeText(message);
    showToast('Chatwork用の納期確認文をコピーしました', 'success');
  } catch {
    window.prompt('この文章をコピーしてください', message);
  }
}

async function sendDeliveryDateRequest(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  const owner = project.ownerMemberId ? DB.Members.get(project.ownerMemberId) : null;
  if (!owner) {
    showToast('窓口担当が未設定です。プロジェクト編集で窓口担当を選んでください', 'error');
    return;
  }
  if (!owner.chatworkAccountId) {
    showToast('窓口担当のChatworkアカウントIDが未設定です。設定 > メンバーから登録してください', 'error');
    return;
  }

  const body = buildDeliveryDateRequestMessage(project, owner, true);
  let importKey = getSavedChatworkImportKey();
  try {
    let res = await fetch('/api/chatwork/reply', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(importKey ? { 'x-taskboard-key': importKey } : {}),
      },
      body: JSON.stringify({ body }),
    });

    let data = await res.json().catch(() => ({}));
    if (res.status === 401 && String(data.error || '').includes('取り込みキー')) {
      const inputKey = window.prompt('TASKBOARD_IMPORT_KEYを入力してください');
      if (!inputKey) throw new Error('TASKBOARD_IMPORT_KEYが未入力です');
      importKey = inputKey.trim();
      localStorage.setItem(CHATWORK_IMPORT_KEY, importKey);
      res = await fetch('/api/chatwork/reply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-taskboard-key': importKey,
        },
        body: JSON.stringify({ body }),
      });
      data = await res.json().catch(() => ({}));
    }

    if (!res.ok) throw new Error(data.error || 'Chatwork送信に失敗しました');
    showToast(`${owner.name}さん宛にChatworkへ送信しました`, 'success');
  } catch (error) {
    showToast(error.message || 'Chatwork送信に失敗しました', 'error');
  }
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

function completeProject(id) {
  if (!confirm('このプロジェクトを完了にしますか？')) return;
  DB.Projects.update(id, { projectStatus: 'completed' });
  showToast('プロジェクトを完了にしました', 'success');
  renderProjects();
}

function reopenProject(id) {
  DB.Projects.update(id, { projectStatus: 'active' });
  showToast('プロジェクトを進行中に戻しました', 'success');
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
    : members.map(m => {
      const memberUrl = getMemberPageUrl(m.id);
      return `
        <div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;padding:14px 18px">
          ${avatarHTML(m, 42)}
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">${escHtml(m.name)}</div>
            <div style="font-size:11px;color:var(--text-3);display:flex;align-items:center;gap:5px;margin-top:2px">
              <span style="width:10px;height:10px;border-radius:50%;background:${m.color};display:inline-block"></span>
              ${m.color}
            </div>
            <div class="member-url">${escHtml(memberUrl)}</div>
          </div>
          <div style="display:flex;gap:5px">
            <button class="btn btn-ghost btn-sm" onclick="copyMemberPageUrl('${m.id}')">個人URL</button>
            <button class="btn btn-ghost btn-sm" onclick="openMemberModal('${m.id}')">編集</button>
            <button class="btn btn-danger btn-sm" onclick="deleteMember('${m.id}')">削除</button>
          </div>
        </div>`;
    }).join('');

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
      <label class="form-label">ChatworkアカウントID</label>
      <input class="form-input" id="mem-chatwork-id" inputmode="numeric" placeholder="例：2994017" value="${escHtml(member?.chatworkAccountId||'')}">
      <div class="form-help">納品日確認などを窓口担当へメンション送信するために使います。</div>
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
  const chatworkAccountId = document.getElementById('mem-chatwork-id')?.value?.trim() || '';
  DB.Members.add({ name, color: _selectedColor, chatworkAccountId });
  closeModal();
  showToast('メンバーを追加しました', 'success');
  renderSettings();
}

function saveMemberEdit(memberId) {
  const name = document.getElementById('mem-name')?.value?.trim();
  if (!name) { showToast('名前を入力してください', 'error'); return; }
  const chatworkAccountId = document.getElementById('mem-chatwork-id')?.value?.trim() || '';
  DB.Members.update(memberId, { name, color: _selectedColor, chatworkAccountId });
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
    <div class="tpl-phase-row" id="tpl-row-${i}">
      <span class="tpl-phase-number">${i+1}</span>
      <input class="form-input tpl-phase-input" placeholder="フェーズ名" value="${escHtml(value)}" id="tpl-ph-${i}">
      <button class="btn btn-ghost btn-sm btn-icon" onclick="moveTplPhaseRow(this, -1)" title="上へ">↑</button>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="moveTplPhaseRow(this, 1)" title="下へ">↓</button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="this.closest('.tpl-phase-row').remove();renumberTplPhases()">✕</button>
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
  div.className = 'tpl-phase-row';
  div.id = id;
  div.innerHTML = `
    <span class="tpl-phase-number">${idx}</span>
    <input class="form-input tpl-phase-input" placeholder="フェーズ名" id="tf-dyn-ph-${_tplRowCount}">
    <button class="btn btn-ghost btn-sm btn-icon" onclick="moveTplPhaseRow(this, -1)" title="上へ">↑</button>
    <button class="btn btn-ghost btn-sm btn-icon" onclick="moveTplPhaseRow(this, 1)" title="下へ">↓</button>
    <button class="btn btn-danger btn-sm btn-icon" onclick="this.closest('.tpl-phase-row').remove();renumberTplPhases()">✕</button>`;
  list.appendChild(div);
  renumberTplPhases();
}

function moveTplPhaseRow(button, direction) {
  const row = button.closest('.tpl-phase-row');
  const list = document.getElementById('tpl-phases-list');
  if (!row || !list) return;

  if (direction < 0 && row.previousElementSibling) {
    list.insertBefore(row, row.previousElementSibling);
  }
  if (direction > 0 && row.nextElementSibling) {
    list.insertBefore(row.nextElementSibling, row);
  }
  renumberTplPhases();
}

function renumberTplPhases() {
  document.querySelectorAll('#tpl-phases-list .tpl-phase-row').forEach((row, i) => {
    const num = row.querySelector('.tpl-phase-number');
    if (num) num.textContent = String(i + 1);
  });
}

function getTemplatePhases() {
  return Array.from(document.querySelectorAll('#tpl-phases-list input'))
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
    const today = now.toLocaleDateString('ja-JP', { month:'numeric', day:'numeric', weekday:'short' });
    el.innerHTML = `${today}<br><span style="color:var(--primary);font-weight:700">${APP_BUILD_LABEL}</span>`;
  }
}

/* ============================================================
   アプリ初期化
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  await DB.initStore();
  DB.seedDemoData();       // 初回のみデモデータを投入
  const carriedCount = DB.Tasks.carryOverOpenTasks();
  const urlMember = resolveMemberFromUrl();
  if (urlMember) {
    _personalMemberId = urlMember.id;
    _taskFilter.memberId = urlMember.id;
    _morningFilter.memberId = urlMember.id;
  }
  updateSidebarDate();
  updateMorningBadge();
  if (openUrlRequestedProjectReview()) return;
  navigate(_personalMemberId ? 'tasks' : 'dashboard');
  openUrlRequestedProject();
  if (carriedCount > 0) {
    showToast(`${carriedCount}件の未達成タスクを今日へ繰り越しました`, 'info');
  }
});

function openUrlRequestedProjectReview() {
  const params = new URLSearchParams(window.location.search);
  const reviewId = params.get('project_review');
  if (!reviewId) return false;
  _currentPage = 'projectReview';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  renderProjectReviewPage(reviewId);
  return true;
}

function openUrlRequestedProject() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('project');
  if (!projectId || !DB.Projects.get(projectId)) return;

  setTimeout(() => {
    navigate('projects');
    openProjectModal(projectId);
  }, 250);
}
