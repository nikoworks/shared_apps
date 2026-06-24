/**
 * TaskBoard — app.js
 * ルーター・全画面レンダリング・UI ロジック
 */
const APP_BUILD_LABEL = 'サーバー保存安定化版 2026-06-24-03';
const PUBLIC_APP_ORIGIN = 'https://shared-apps.vercel.app';
const THEME_STORAGE_KEY = 'taskboard-theme';
const JP_HOLIDAYS = new Set([
  '2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20',
  '2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
  '2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23',
  '2026-10-12','2026-11-03','2026-11-23',
  '2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-21',
  '2027-03-22','2027-04-29','2027-05-03','2027-05-04','2027-05-05',
  '2027-07-19','2027-08-11','2027-09-20','2027-09-23','2027-10-11',
  '2027-11-03','2027-11-23',
]);

function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (window.location.protocol === 'file:') return `${PUBLIC_APP_ORIGIN}${normalizedPath}`;
  return normalizedPath;
}

function getSavedTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === 'light' ? 'light' : 'dark';
}

function applyTheme(theme = getSavedTheme()) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
}

function setTheme(theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, normalized);
  applyTheme(normalized);
  renderSettings();
  showToast(normalized === 'light' ? 'ライトモードにしました' : 'ダークモードにしました', 'success');
}

applyTheme();

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
    case 'gantt':     renderGantt(); break;
    case 'cleanup':   renderDataCleanup(); break;
    case 'settings':  renderSettings(); break;
    default:          renderDashboard();
  }
}

function refreshCurrentPage() {
  switch (_currentPage) {
    case 'tasks':
    case 'morning':
      renderTodayTasks();
      break;
    case 'projects':
      renderProjects();
      break;
    case 'cleanup':
      renderDataCleanup();
      break;
    case 'gantt':
      renderGantt();
      break;
    case 'settings':
      renderSettings();
      break;
    default:
      renderPage(_currentPage);
  }
}

/* ============================================================
   モーダル
   ============================================================ */
function openModal(contentHTML, title, options = {}) {
  const overlay = document.getElementById('modal-overlay');
  const modal   = document.getElementById('modal');
  modal.className = `modal ${options.wide ? 'modal-wide' : ''}`;
  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title" id="modal-title-text">${title}</span>
      <button class="modal-close" onclick="closeModal()" aria-label="閉じる">✕</button>
    </div>
    <div class="modal-body">${contentHTML}</div>
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

function projectSortBucket(project) {
  return project?.projectType === 'recurring' ? '1' : '0';
}

function projectSortLabel(project) {
  return [
    projectSortBucket(project),
    project?.clientName || '',
    project?.recurringSeries || '',
    project?.name || '',
    project?.createdAt || '',
  ].join(' / ');
}

function sortProjectsForPicker(projects) {
  return [...projects].sort((a, b) =>
    projectSortLabel(a).localeCompare(projectSortLabel(b), 'ja'));
}

function projectOptionGroupLabel(project) {
  return project?.projectType === 'recurring' ? '定期' : '通常';
}

function projectOptionLabel(project, includeType = false) {
  const base = `${project.clientName || 'クライアント未設定'} / ${project.name || '名称未設定'}`;
  return includeType ? `${projectOptionGroupLabel(project)} / ${base}` : base;
}

function projectOptionsHTML(projects, selectedId = '', includeType = false) {
  return sortProjectsForPicker(projects).map(project =>
    `<option value="${project.id}" ${selectedId === project.id ? 'selected' : ''}>${escHtml(projectOptionLabel(project, includeType))}</option>`
  ).join('');
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function taskDueDateValue(task) {
  return task?.dueDate || task?.date || '';
}

function taskDisplayDateValue(task) {
  return task?.displayDate || task?.date || task?.dueDate || '';
}

function normalizeTaskDateFields(task = {}) {
  const dueDate = taskDueDateValue(task);
  const displayDate = taskDisplayDateValue(task) || dueDate || DB.today();
  return {
    ...task,
    date: dueDate || displayDate,
    dueDate: dueDate || displayDate,
    displayDate,
  };
}

function memberMultiOptionsHTML(selectedIds = []) {
  const selected = new Set(asArray(selectedIds));
  return DB.Members.all().map(member =>
    `<option value="${member.id}" ${selected.has(member.id) ? 'selected' : ''}>${escHtml(member.name)}</option>`
  ).join('');
}

function readMultiSelectValues(id) {
  const el = document.getElementById(id);
  return el ? Array.from(el.selectedOptions).map(option => option.value).filter(Boolean) : [];
}

function memberNames(ids = []) {
  const names = asArray(ids)
    .map(id => DB.Members.get(id)?.name)
    .filter(Boolean);
  return names.length ? names.join('、') : '未設定';
}

function reviewRuleLabel(value) {
  if (value === 'any') return '誰か1人でOK';
  if (value === 'inherit') return 'プロジェクト設定を使用';
  return '全員確認';
}

function getProjectReviewConfig(project) {
  return {
    progressManagerMemberId: project?.progressManagerMemberId || project?.ownerMemberId || '',
    reviewerMemberIds: asArray(project?.reviewerMemberIds),
    approvalMemberIds: asArray(project?.approvalMemberIds),
    reviewRule: project?.reviewRule || 'all',
    reviewDueDays: project?.reviewDueDays ?? 1,
    notifyProgressManager: project?.notifyProgressManager !== false,
  };
}

function getPhaseReviewConfig(project, phase) {
  const base = getProjectReviewConfig(project);
  if (!phase || phase.reviewConfigMode !== 'custom') {
    return { ...base, reviewConfigMode: 'inherit', requiredBeforeNextPhase: phase?.requiredBeforeNextPhase !== false };
  }
  return {
    progressManagerMemberId: base.progressManagerMemberId,
    reviewerMemberIds: asArray(phase.reviewerMemberIds),
    approvalMemberIds: asArray(phase.approvalMemberIds),
    reviewRule: phase.reviewRule === 'inherit' ? base.reviewRule : (phase.reviewRule || base.reviewRule),
    reviewDueDays: phase.reviewDueDays ?? base.reviewDueDays,
    notifyProgressManager: base.notifyProgressManager,
    reviewConfigMode: 'custom',
    requiredBeforeNextPhase: phase.requiredBeforeNextPhase !== false,
  };
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

function findMemberByChatworkAccountId(accountId) {
  const target = String(accountId || '').trim();
  if (!target) return null;
  return DB.Members.all().find(m => String(m.chatworkAccountId || '').trim() === target) || null;
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

function getDefaultCreatorMemberId() {
  return _personalMemberId || getDefaultOwnerMemberId();
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
  const projectOpts = projectOptionsHTML(projects, _morningFilter.projectId, true);

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

async function markTaskComplete(taskId) {
  const before = taskSnapshot();
  const beforeAsks = DB.Asks.all().map(ask => ({ ...ask }));
  DB.Tasks.setCompletion(taskId, true, '');
  createReviewAsksForCompletedTasks([taskId]);
  const ok = await DB.syncCloudStore?.();
  if (ok === false) {
    restoreTaskSnapshot(before);
    DB.Asks.replaceAll?.(beforeAsks);
  }
  renderMorningCheck();
  showToast(ok === false ? '保存できなかったため、チェックを元に戻しました。最新に更新してから再度実行してください' : '完了としてマークしました', ok === false ? 'error' : 'success');
}

async function markTaskFail(taskId) {
  const task = DB.Tasks.get(taskId);
  if (!task) return;
  const before = taskSnapshot();
  // トグル動作：既に失敗ならリセット
  if (task.completed === false) {
    DB.Tasks.setCompletion(taskId, null, '');
  } else {
    DB.Tasks.setCompletion(taskId, false, '');
  }
  const ok = await DB.syncCloudStore?.();
  if (ok === false) {
    restoreTaskSnapshot(before);
    showToast('保存できなかったため、チェックを元に戻しました。最新に更新してから再度実行してください', 'error');
  }
  renderMorningCheck();
}

async function saveIncompleteReason(taskId, reason) {
  DB.Tasks.update(taskId, { incompleteReason: reason });
  const ok = await DB.syncCloudStore?.();
  if (ok === false) showToast('保存に失敗しました。最新に更新してから再度入力してください', 'error');
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
const _recentlyCompletedTaskIds = new Set();
let _taskFormData = { memberId: '', projectId: '', phaseId: '', content: '', estimatedHours: 1, note: '', date: '' };
let _openTaskProjectCreateOnNextModal = false;
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

function taskSnapshot() {
  return DB.Tasks.all().map(task => ({ ...task }));
}

function restoreTaskSnapshot(snapshot) {
  if (DB.Tasks.replaceAll) {
    DB.Tasks.replaceAll(snapshot);
  }
}

function toggleCompletedVisibility() {
  _taskFilter.showCompleted = !_taskFilter.showCompleted;
  renderTodayTasks();
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
    if (!_taskFilter.showCompleted && t.completed === true && !_recentlyCompletedTaskIds.has(t.id)) return false;
    return true;
  });

  const visibleTasks = collapseTaskDisplayDuplicates(filtered);
  const sortedFiltered = sortTasksForWorkday(visibleTasks);
  const totalH = sortedFiltered.reduce((s, t) => s + (t.estimatedHours || 0), 0);

  // メンバーグループ
  const byMember = {};
  sortedFiltered.forEach(t => (byMember[t.memberId] = byMember[t.memberId] || []).push(t));

  const memberOpts  = members.map(m => `<option value="${m.id}" ${_taskFilter.memberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const projectOpts = projectOptionsHTML(projects, _taskFilter.projectId, true);

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
          <button class="btn btn-ghost" onclick="recoverChatworkTasksDirect()">
            復旧再取得
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
        : Object.entries(byMember)
          .sort(([aId], [bId]) => {
            const aName = DB.Members.get(aId)?.name || '（不明）';
            const bName = DB.Members.get(bId)?.name || '（不明）';
            return aName.localeCompare(bName, 'ja');
          })
          .map(([memberId, tasks]) => {
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
                ${renderMemberTaskGroups(tasks)}
              </div>`;
          }).join('')}
    </div>`;
}

function sortTasksForWorkday(tasks) {
  return [...tasks].sort((a, b) => {
    const aProject = taskProjectSortLabel(a);
    const bProject = taskProjectSortLabel(b);
    const projectCompare = aProject.localeCompare(bProject, 'ja');
    if (projectCompare !== 0) return projectCompare;

    const aDate = sourceDateForTask(a) || taskDisplayDateValue(a) || '9999-99-99';
    const bDate = sourceDateForTask(b) || taskDisplayDateValue(b) || '9999-99-99';
    const dateCompare = String(aDate).localeCompare(String(bDate));
    if (dateCompare !== 0) return dateCompare;

    const aCarry = a.carriedFromTaskId ? 0 : 1;
    const bCarry = b.carriedFromTaskId ? 0 : 1;
    if (aCarry !== bCarry) return aCarry - bCarry;

    const aCreated = a.createdAt || '';
    const bCreated = b.createdAt || '';
    const createdCompare = String(aCreated).localeCompare(String(bCreated));
    if (createdCompare !== 0) return createdCompare;

    return String(a.content || '').localeCompare(String(b.content || ''), 'ja');
  });
}

function normalizeTaskDisplayValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function taskDisplayDuplicateKey(task) {
  return [
    task.memberId || '',
    task.projectId || normalizeTaskDisplayValue(task.sourceProjectName) || '',
    normalizeTaskDisplayValue(task.content),
    Number(task.estimatedHours) || 0,
  ].join('||');
}

function shortDateLabel(dateStr) {
  if (!dateStr) return '日付なし';
  if (dateStr === DB.today()) return '今日';
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function taskDisplayDates(tasks) {
  return [...new Set(tasks
    .flatMap(task => [task.originalDate, sourceDateForTask(task), taskDisplayDateValue(task)])
    .filter(Boolean))]
    .sort();
}

function taskDisplayDateSummary(tasks) {
  const dates = taskDisplayDates(tasks);
  if (!dates.length) return '';
  if (dates.length === 1) return dates[0];
  return `${shortDateLabel(dates[0])}〜${shortDateLabel(dates[dates.length - 1])}`;
}

function chooseTaskDisplayRepresentative(tasks) {
  const openTasks = tasks.filter(task => task.completed !== true);
  const candidates = openTasks.length ? openTasks : tasks;
  return candidates
    .slice()
    .sort((a, b) => {
      const dateCompare = String(taskDisplayDateValue(b)).localeCompare(String(taskDisplayDateValue(a)));
      if (dateCompare) return dateCompare;
      const aCarry = a.carriedFromTaskId ? 0 : 1;
      const bCarry = b.carriedFromTaskId ? 0 : 1;
      if (aCarry !== bCarry) return aCarry - bCarry;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    })[0];
}

function collapseTaskDisplayDuplicates(tasks) {
  const groups = new Map();
  tasks.forEach(task => {
    const key = taskDisplayDuplicateKey(task);
    const group = groups.get(key) || [];
    group.push(task);
    groups.set(key, group);
  });

  return Array.from(groups.values()).map(group => {
    const representative = chooseTaskDisplayRepresentative(group);
    const dates = taskDisplayDates(group);
    return {
      ...representative,
      _displayDuplicateCount: group.length,
      _displayDateSummary: taskDisplayDateSummary(group),
      _displayOriginDate: dates[0] || sourceDateForTask(representative),
      _displayTaskIds: group.map(task => task.id),
    };
  });
}

function taskProjectSortLabel(task) {
  const project = task?.projectId ? DB.Projects.get(task.projectId) : null;
  if (project) return cleanupProjectName(project);
  if (task?.sourceProjectName) return `確認待ち / ${task.sourceProjectName}`;
  return '未選択';
}

function renderMemberTaskGroups(tasks) {
  const groups = [];
  tasks.forEach(task => {
    const key = taskProjectSortLabel(task);
    let group = groups.find(item => item.key === key);
    if (!group) {
      group = { key, tasks: [] };
      groups.push(group);
    }
    group.tasks.push(task);
  });

  return groups.map(group => {
    const hours = group.tasks.reduce((sum, task) => sum + (task.estimatedHours || 0), 0);
    return `
      <div class="task-project-group">
        <div class="task-project-group-head">
          <span>${escHtml(group.key)}</span>
          <small>${group.tasks.length}件 / ${hours}h</small>
        </div>
        ${group.tasks.map(t => todayTaskRow(t)).join('')}
      </div>`;
  }).join('');
}

function todayTaskRow(task) {
  const phaseName    = getPhaseName(task);
  const projectHTML = taskProjectDisplayHTML(task);
  const ownerLabel = getTaskOwnerLabel(task);
  const linkedAsk = getTaskLinkedAsk(task.id);
  const duplicateCount = task._displayDuplicateCount || 1;
  const taskIds = task._displayTaskIds || [task.id];
  const originDate = task._displayOriginDate || sourceDateForTask(task);
  const isCarry = Boolean(task.carriedFromTaskId || task.originalDate || duplicateCount > 1);
  const isDone = task.completed === true;
  const visibleNote = visibleTaskNote(task);
  const dateLabel = duplicateCount > 1 && task._displayDateSummary ? task._displayDateSummary : '';
  return `
    <div class="task-row ${isCarry ? 'task-row-carry' : ''} ${isDone ? 'task-row-done' : ''}" id="task-row-${task.id}">
      <button class="check-btn ${isDone ? 'done' : ''}"
              onclick="toggleTodayTaskCompleteGroup('${taskIds.join(',')}')"
              title="${isDone ? '未完了に戻す' : '完了にする'}"
              aria-label="${isDone ? '未完了に戻す' : '完了にする'}">✓</button>
      <div class="task-accent-bar"></div>
      <div class="flex-1">
        <div class="task-title">${escHtml(task.content)}</div>
        ${visibleNote ? `<div class="task-note">備考：${escHtml(visibleNote)}</div>` : ''}
        <div class="task-meta">
          ${taskDateTagHTML(originDate, { carried: isCarry, label: dateLabel || undefined })}
          <span>担当：${escHtml(ownerLabel)}</span>
          ${projectHTML}
          ${phaseName ? `<span class="tag tag-phase">${phaseName}</span>` : ''}
          ${isCarry ? '<span class="tag tag-carry tag-carry-strong">繰り越し</span>' : ''}
          ${isDone ? '<span class="tag tag-done">完了</span>' : ''}
          ${linkedAsk ? '<span class="tag tag-ask">確認あり</span>' : ''}
          ${duplicateCount > 1 ? `<span class="tag">集約 ${duplicateCount}件</span>` : ''}
          <span class="tag-hours">${task.estimatedHours}h</span>
        </div>
      </div>
      <div style="display:flex;gap:5px;align-items:center;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="openCleanupTaskEdit('${task.id}')">編集</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">削除</button>
      </div>
    </div>`;
}

function taskProjectDisplayHTML(task) {
  const projectLabel = getProjectLabel(task);
  if (projectLabel) return `<span class="tag tag-project-label">${escHtml(projectLabel)}</span>`;
  if (task.sourceProjectName) {
    return `<span class="tag tag-missing-project">プロジェクト確認待ち：${escHtml(task.sourceProjectName)}</span>`;
  }
  return '<span style="color:var(--text-3)">プロジェクト未選択</span>';
}

function visibleTaskNote(task) {
  return cleanVisibleTaskNote(task?.note || '');
}

function cleanVisibleTaskNote(note) {
  return String(note || '')
    .split(/\s+\/\s+|\n/)
    .map(part => part.trim())
    .filter(part => part && !/^元プロジェクト名\s*[:：]/.test(part))
    .join(' / ');
}

async function toggleTodayTaskComplete(taskId) {
  return toggleTodayTaskCompleteGroup(taskId);
}

async function toggleTodayTaskCompleteGroup(taskIdsText) {
  const taskIds = String(taskIdsText || '').split(',').map(id => id.trim()).filter(Boolean);
  if (!taskIds.length) return;
  const mainTask = DB.Tasks.get(taskIds[0]);
  if (!mainTask) return;
  const before = taskSnapshot();
  const beforeAsks = DB.Asks.all().map(ask => ({ ...ask }));
  const nextCompleted = mainTask.completed === true ? null : true;
  taskIds.forEach(taskId => DB.Tasks.setCompletion(taskId, nextCompleted, ''));
  if (nextCompleted === true) createReviewAsksForCompletedTasks(taskIds);
  const ok = await DB.syncCloudStore?.();
  if (ok === false) {
    restoreTaskSnapshot(before);
    DB.Asks.replaceAll?.(beforeAsks);
    showToast('保存できなかったため、チェックを元に戻しました。最新に更新してから再度実行してください', 'error');
  } else {
    taskIds.forEach(taskId => {
      if (nextCompleted === true) _recentlyCompletedTaskIds.add(taskId);
      else _recentlyCompletedTaskIds.delete(taskId);
    });
  }
  renderTodayTasks();
  updateMorningBadge();
}

function taskDateTagHTML(dateStr, options = {}) {
  const carriedClass = options.carried ? ' tag-date-carry' : '';
  const label = options.label || relativeDateLabel(dateStr);
  return `<span class="tag tag-date tag-date-${dateTone(dateStr)}${carriedClass}" title="${escHtml(DB.fmtDate(dateStr))}">${escHtml(label)}</span>`;
}

function sourceDateForTask(task) {
  if (task?.originalDate) return task.originalDate;
  if (!task?.carriedFromTaskId) return taskDisplayDateValue(task);
  const originTask = getCarryOriginTask(task);
  return taskDisplayDateValue(originTask) || taskDisplayDateValue(task);
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
  if (/許可/.test(type)) return 'approval';
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
function openCleanupTaskEdit(taskId) {
  _openTaskProjectCreateOnNextModal = true;
  openTaskModal(taskId);
}

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
    if (t) _taskFormData = normalizeTaskDateFields(t);
  } else {
    _taskFormData = {
      memberId: _taskFilter.memberId || _personalMemberId || '',
      projectId: '',
      phaseId: '',
      content: '',
      estimatedHours: 1,
      durationDays: 1,
      startDate: '',
      reviewConfigMode: 'inherit',
      reviewerMemberIds: [],
      approvalMemberIds: [],
      reviewRule: 'inherit',
      reviewDueDays: null,
      notifyProgressManager: true,
      note: '',
      date: getTaskDefaultDate(),
      dueDate: getTaskDefaultDate(),
      displayDate: getTaskDefaultDate(),
    };
  }
  if (!_taskFormData.projectKindFilter) {
    const currentProject = _taskFormData.projectId ? DB.Projects.get(_taskFormData.projectId) : null;
    _taskFormData.projectKindFilter = currentProject?.projectType === 'recurring' ? 'recurring' : 'all';
  }

  const memberOpts  = members.map(m =>
    `<option value="${m.id}" ${_taskFormData.memberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const projectOpts = buildTaskProjectOptions();
  const curPhases = _taskFormData.projectId ? (DB.Projects.get(_taskFormData.projectId)?.phases || []) : [];
  const phaseOpts = `<option value="">フェーズなし</option>` +
    curPhases.map(ph =>
      `<option value="${ph.id}" ${_taskFormData.phaseId === ph.id ? 'selected' : ''}>${ph.name}</option>`).join('');
  const linkedAsk = editId ? getTaskLinkedAsk(editId) : null;
  const askMemberOpts = `<option value="">宛先を選択...</option>` + members.map(m =>
    `<option value="${m.id}" ${linkedAsk?.toMemberId === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const taskReviewMode = _taskFormData.reviewConfigMode === 'custom' ? 'custom' : 'inherit';
  const taskReviewSummary = taskReviewSummaryText(_taskFormData);
  const carryOrigin = editId && _taskFormData.carriedFromTaskId ? getCarryOriginTask(_taskFormData) : null;
  const carryOriginDate = carryOrigin && carryOrigin.id !== _taskFormData.id ? taskDisplayDateValue(carryOrigin) : '';
  const formDueDate = taskDueDateValue(_taskFormData) || DB.today();
  if (!_taskFormData.startDate && formDueDate) {
    _taskFormData.startDate = taskStartDateFromDueDate(formDueDate, _taskFormData.durationDays || 1);
  }
  const workDateHelp = carryOriginDate
    ? `<div class="form-help" style="margin-top:8px">
        このタスクは <strong>${escHtml(DB.fmtDate(carryOriginDate))}</strong> から繰り越されています。
        締切日は「この日までに終わらせる日」です。
      </div>`
    : `<div class="form-help" style="margin-top:8px">この日までに終わらせるタスクとして保存します。</div>`;

  openModal(`
    <div class="form-group">
      <label class="form-label">担当者 *</label>
      <select class="form-select" id="tf-member" onchange="_taskFormData.memberId=this.value">
        <option value="">選択してください</option>${memberOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">プロジェクト</label>
      <select class="form-select" id="tf-project-kind"
              style="margin-bottom:8px"
              onchange="_taskFormData.projectKindFilter=this.value;_taskFormData.projectId='';_taskFormData.phaseId='';refreshTaskProjectOptions()">
        <option value="all" ${_taskFormData.projectKindFilter === 'all' ? 'selected' : ''}>すべてのプロジェクト</option>
        <option value="standard" ${_taskFormData.projectKindFilter === 'standard' ? 'selected' : ''}>通常プロジェクトだけ</option>
        <option value="recurring" ${_taskFormData.projectKindFilter === 'recurring' ? 'selected' : ''}>定期プロジェクトだけ</option>
      </select>
      <select class="form-select" id="tf-project"
              onchange="_taskFormData.projectId=this.value;_taskFormData.phaseId='';refreshModalPhases()">
        ${projectOpts}
      </select>
      <div class="form-help">通常は既存プロジェクトを選びます。ない場合だけ、この場で新規作成して紐付けます。</div>
      <button class="btn btn-ghost" type="button" onclick="toggleTaskProjectCreateBox()">
        このタスク用にプロジェクトを作成
      </button>
      ${buildTaskProjectCreatePanel()}
    </div>
    <div class="form-group">
      <label class="form-label">フェーズ</label>
      <select class="form-select" id="tf-phase" onchange="_taskFormData.phaseId=this.value">
        ${phaseOpts}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">締切日（この日までに完了） *</label>
      <input type="date" class="form-input" id="tf-date"
             value="${formDueDate}"
             onchange="_taskFormData.date=this.value;syncTaskStartDateFromDue()">
      ${workDateHelp}
    </div>
    <div class="form-group">
      <label class="form-label">開始日</label>
      <input type="date" class="form-input" id="tf-start-date"
             value="${_taskFormData.startDate || ''}"
             onchange="_taskFormData.startDate=this.value">
      <div class="form-help">締切日と遂行期間から自動計算されます。必要なら手で修正できます。</div>
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
    <div class="form-group">
      <label class="form-label">遂行期間（日）</label>
      <input type="number" class="form-input" id="tf-duration-days" min="1" step="1"
             value="${Number(_taskFormData.durationDays || 1)}"
             onchange="_taskFormData.durationDays=Math.max(1, Number(this.value || 1) || 1);syncTaskStartDateFromDue()">
      <div class="form-help">締切日までに遂行するための営業日数です。負荷計算では、予定時間をこの期間に按分します。</div>
    </div>
    <div class="task-ask-box">
      <div class="task-ask-title">進行に関わる確認</div>
      <div class="form-help">次の工程・納期・判断に影響する確認だけを入れます。個人的な作業相談はここに残さず、直接確認してください。</div>
      <div class="task-review-summary">${escHtml(taskReviewSummary)}</div>
      <label class="checkline" style="margin:10px 0">
        <input type="checkbox" id="tf-review-custom" ${taskReviewMode === 'custom' ? 'checked' : ''} onchange="toggleTaskReviewCustom()">
        <span>このタスクだけ確認者・許可者を変更する</span>
      </label>
      <div id="tf-review-custom-box" style="${taskReviewMode === 'custom' ? '' : 'display:none'}">
        <div class="task-ask-grid">
          <div class="form-group">
            <label class="form-label">確認者（複数選択可）</label>
            <select class="form-select member-multi-select" id="tf-reviewers" multiple size="4">
              ${memberMultiOptionsHTML(_taskFormData.reviewerMemberIds || [])}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">進行許可者（複数選択可）</label>
            <select class="form-select member-multi-select" id="tf-approvers" multiple size="4">
              ${memberMultiOptionsHTML(_taskFormData.approvalMemberIds || [])}
            </select>
          </div>
        </div>
        <div class="task-ask-grid">
          <div class="form-group">
            <label class="form-label">確認ルール</label>
            <select class="form-select" id="tf-review-rule">
              <option value="inherit" ${(_taskFormData.reviewRule || 'inherit') === 'inherit' ? 'selected' : ''}>プロジェクト設定を使用</option>
              <option value="all" ${_taskFormData.reviewRule === 'all' ? 'selected' : ''}>全員確認</option>
              <option value="any" ${_taskFormData.reviewRule === 'any' ? 'selected' : ''}>誰か1人でOK</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">確認期限（日）</label>
            <input type="number" class="form-input" id="tf-review-due-days" min="0" step="1" value="${_taskFormData.reviewDueDays ?? ''}" placeholder="未入力ならプロジェクト設定">
          </div>
        </div>
        <label class="checkline">
          <input type="checkbox" id="tf-notify-progress-manager" ${_taskFormData.notifyProgressManager === false ? '' : 'checked'}>
          <span>確認待ちを進行管理役にも通知する</span>
        </label>
      </div>
      <div class="form-help" style="margin-top:10px">下の欄は、登録時点で個別の確認依頼を残したい場合だけ使います。</div>
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

  if (_openTaskProjectCreateOnNextModal) {
    _openTaskProjectCreateOnNextModal = false;
    toggleTaskProjectCreateBox(true);
  }
}

function refreshModalPhases() {
  const phases = _taskFormData.projectId
    ? (DB.Projects.get(_taskFormData.projectId)?.phases || []) : [];
  const sel = document.getElementById('tf-phase');
  if (!sel) return;
  sel.innerHTML = `<option value="">フェーズなし</option>` +
    phases.map(ph => `<option value="${ph.id}">${ph.name}</option>`).join('');
}

function refreshTaskProjectOptions() {
  const sel = document.getElementById('tf-project');
  if (!sel) return;
  sel.innerHTML = buildTaskProjectOptions();
  sel.value = _taskFormData.projectId || '';
  refreshModalPhases();
}

function buildTaskProjectOptions() {
  const kind = _taskFormData.projectKindFilter || 'all';
  let projects = DB.Projects.active().filter(project => {
    if (kind === 'recurring') return project.projectType === 'recurring';
    if (kind === 'standard') return project.projectType !== 'recurring';
    return true;
  });
  const selectedProject = _taskFormData.projectId ? DB.Projects.get(_taskFormData.projectId) : null;
  if (selectedProject && !projects.some(project => project.id === selectedProject.id)) {
    projects = [selectedProject, ...projects];
  }
  return `<option value="">プロジェクトを選択...</option>` +
    sortProjectsForPicker(projects).map(project => {
      const typeLabel = project.projectType === 'recurring' ? '定期' : '通常';
      return `<option value="${project.id}" ${_taskFormData.projectId === project.id ? 'selected' : ''}>
        ${escHtml(project.clientName)} / ${escHtml(project.name)}（${typeLabel}）
      </option>`;
    }).join('');
}

function inferProjectDraftFromTaskForm() {
  const sourceName = String(_taskFormData.sourceProjectName || '').trim();
  const content = String(_taskFormData.content || '').trim();
  const parsed = sourceName ? parseProjectName(sourceName) : { clientName: '', name: '', recurringSeries: '' };
  const parsedClient = String(parsed.clientName || '').trim();
  const clientName = parsedClient && parsedClient !== '未分類' && parsedClient !== '未設定' && !isSuspiciousClientName(parsedClient)
    ? parsedClient
    : '';
  const parsedName = String(parsed.name || '').trim();
  const projectName = parsedName && parsedName !== '仮プロジェクト'
    ? parsedName
    : (sourceName && !isSuspiciousClientName(sourceName) ? sourceName : content);

  return {
    sourceName,
    clientName,
    projectName,
    projectType: parsed.recurringSeries ? 'recurring' : 'standard',
    recurringSeries: parsed.recurringSeries || '',
    ownerMemberId: _personalMemberId || _taskFormData.memberId || getDefaultOwnerMemberId(),
  };
}

function buildTaskProjectCreatePanel() {
  const draft = inferProjectDraftFromTaskForm();
  const members = DB.Members.all();
  const ownerDefault = draft.ownerMemberId;
  const memberOpts = members.map(member =>
    `<option value="${member.id}" ${ownerDefault === member.id ? 'selected' : ''}>${escHtml(member.name)}</option>`).join('');
  const clientOptions = clientNameSelectOptions(draft.clientName);
  const clientSelectValue = draft.clientName && clientOptions.includes(draft.clientName)
    ? draft.clientName
    : (draft.clientName || !clientOptions.length ? '__new__' : '');
  const clientSelectOpts = [
    clientOptions.length ? `<option value="" ${clientSelectValue === '' ? 'selected' : ''}>既存クライアントを選択...</option>` : '',
    ...clientOptions.map(name => `<option value="${escHtml(name)}" ${clientSelectValue === name ? 'selected' : ''}>${escHtml(name)}</option>`),
    `<option value="__new__" ${clientSelectValue === '__new__' ? 'selected' : ''}>＋ 新規クライアント名を入力</option>`,
  ].join('');
  const recurringOptions = recurringSeriesSelectOptions(draft.recurringSeries);
  const recurringSelectValue = draft.recurringSeries && recurringOptions.includes(draft.recurringSeries)
    ? draft.recurringSeries
    : (draft.recurringSeries || !recurringOptions.length ? '__new__' : '');
  const recurringSelectOpts = [
    recurringOptions.length ? `<option value="" ${recurringSelectValue === '' ? 'selected' : ''}>既存の定期案件を選択...</option>` : '',
    ...recurringOptions.map(name => `<option value="${escHtml(name)}" ${recurringSelectValue === name ? 'selected' : ''}>${escHtml(name)}</option>`),
    `<option value="__new__" ${recurringSelectValue === '__new__' ? 'selected' : ''}>＋ 新規定期案件名を入力</option>`,
  ].join('');
  const clientInputDisplay = clientSelectValue === '__new__' ? '' : 'display:none';
  const recurringInputDisplay = recurringSelectValue === '__new__' ? '' : 'display:none';
  const recurringGroupDisplay = draft.projectType === 'recurring' ? '' : 'display:none';
  const templates = DB.Templates.all();
  const templateOpts = templates.map(t =>
    `<option value="${t.id}">${escHtml(t.name)}${t.tasks?.length ? '（タスク付き）' : ''}</option>`
  ).join('');
  const draftHelp = draft.sourceName
    ? `元プロジェクト名「${escHtml(draft.sourceName)}」から候補を入れています。違う場合はこの画面で直せます。`
    : 'タスク内容から候補を入れています。違う場合はこの画面で直せます。';

  return `
    <div id="task-project-create-box" style="display:none;margin-top:12px;padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--bg-glass)">
      <div style="font-weight:800;margin-bottom:10px;color:var(--text-1)">このタスク用のプロジェクトを作成</div>
      <div class="form-help" style="margin-bottom:12px">${draftHelp}<br>作成すると、このタスクのプロジェクト欄に自動で入ります。</div>
      <div class="form-group">
        <label class="form-label">案件区分</label>
        <select class="form-select" id="qpj-deal-category">
          <option value="existing">既存クライアント</option>
          <option value="proposal">提案ベース</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">案件流入元</label>
        <select class="form-select" id="qpj-lead-source">
          ${leadSourceOptionsHTML()}
        </select>
        <input class="form-input" id="qpj-lead-source-detail" style="margin-top:8px"
               placeholder="例：LPの資料請求フォーム / メディアレーダー資料DL後 / 〇〇社から紹介">
      </div>
      <div class="form-group">
        <label class="form-label">プロジェクト種別</label>
        <select class="form-select" id="qpj-type" onchange="toggleTaskProjectCreateFields()">
          <option value="standard" ${draft.projectType === 'standard' ? 'selected' : ''}>通常プロジェクト</option>
          <option value="production" ${draft.projectType === 'production' ? 'selected' : ''}>制作プロジェクト</option>
          <option value="recurring" ${draft.projectType === 'recurring' ? 'selected' : ''}>定期プロジェクト</option>
        </select>
      </div>
      <div class="form-group" id="qpj-recurring-group" style="${recurringGroupDisplay}">
        <label class="form-label">定期案件名</label>
        <select class="form-select" id="qpj-recurring-select" onchange="toggleTaskProjectCreateFields()">
          ${recurringSelectOpts}
        </select>
        <input class="form-input" id="qpj-recurring" style="margin-top:8px;${recurringInputDisplay}"
               placeholder="例：明治安田 月号 / プレゼントキャンペーン更新"
               value="${recurringSelectValue === '__new__' ? escHtml(draft.recurringSeries) : ''}">
        <div class="form-help">定期案件は既存名から選ぶと、表記ゆれを防げます。</div>
      </div>
      <div class="form-group">
        <label class="form-label">クライアント名 *</label>
        <select class="form-select" id="qpj-client-select" onchange="toggleTaskProjectCreateFields()">
          ${clientSelectOpts}
        </select>
        <input class="form-input" id="qpj-client" style="margin-top:8px;${clientInputDisplay}"
               placeholder="例：〇〇株式会社"
               value="${clientSelectValue === '__new__' ? escHtml(draft.clientName) : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">プロジェクト名 *</label>
        <input class="form-input" id="qpj-name"
               placeholder="例：7月号 / LP制作 / 2026年7月切り替え"
               value="${escHtml(draft.projectName)}">
      </div>
      <div class="form-group">
        <label class="form-label">窓口担当 *</label>
        <select class="form-select" id="qpj-owner">
          <option value="">選択してください</option>${memberOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">納品日 *</label>
        <input type="date" class="form-input" id="qpj-delivery" onchange="renderTaskProjectTemplatePreview()">
      </div>
      <div class="form-group">
        <label class="form-label">フェーズテンプレート</label>
        <select class="form-select" id="qpj-template" onchange="onTaskProjectTemplateChange()">
          <option value="">テンプレートなし</option>${templateOpts}
        </select>
        <div class="form-help">選ぶと、このプロジェクト用のフェーズと標準タスクも一緒に作成します。</div>
        <div id="qpj-template-preview" class="template-preview"></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost" type="button" onclick="toggleTaskProjectCreateBox(false)">閉じる</button>
        <button class="btn btn-primary" type="button" onclick="createProjectFromTaskInline()">作成して紐付け</button>
      </div>
    </div>
  `;
}

function toggleTaskProjectCreateBox(force) {
  const box = document.getElementById('task-project-create-box');
  if (!box) return;
  const shouldShow = typeof force === 'boolean' ? force : box.style.display === 'none';
  box.style.display = shouldShow ? '' : 'none';
  if (shouldShow) toggleTaskProjectCreateFields();
}

function toggleTaskProjectCreateFields() {
  const type = document.getElementById('qpj-type')?.value || 'standard';
  const recurringGroup = document.getElementById('qpj-recurring-group');
  if (recurringGroup) recurringGroup.style.display = type === 'recurring' ? '' : 'none';

  const recurringSelect = document.getElementById('qpj-recurring-select');
  const recurringInput = document.getElementById('qpj-recurring');
  if (recurringInput) recurringInput.style.display = recurringSelect?.value === '__new__' ? '' : 'none';

  const clientSelect = document.getElementById('qpj-client-select');
  const clientInput = document.getElementById('qpj-client');
  if (clientInput) clientInput.style.display = clientSelect?.value === '__new__' ? '' : 'none';
}

function onTaskProjectTemplateChange() {
  const templateId = document.getElementById('qpj-template')?.value || '';
  const tpl = DB.Templates.get(templateId);
  if (tpl?.tasks?.length) {
    const typeEl = document.getElementById('qpj-type');
    if (typeEl && typeEl.value === 'standard') typeEl.value = 'production';
  }
  toggleTaskProjectCreateFields();
  renderTaskProjectTemplatePreview();
}

function getTaskProjectCreateClientName() {
  const selected = document.getElementById('qpj-client-select')?.value || '';
  if (selected && selected !== '__new__') return selected.trim();
  return document.getElementById('qpj-client')?.value?.trim() || '';
}

function getTaskProjectCreateRecurringSeries(projectType) {
  if (projectType !== 'recurring') return '';
  const selected = document.getElementById('qpj-recurring-select')?.value || '';
  if (selected && selected !== '__new__') return selected.trim();
  return document.getElementById('qpj-recurring')?.value?.trim() || '';
}

async function createProjectFromTaskInline() {
  const clientName = getTaskProjectCreateClientName();
  const projectName = document.getElementById('qpj-name')?.value?.trim() || '';
  const ownerMemberId = document.getElementById('qpj-owner')?.value || '';
  const deliveryDate = document.getElementById('qpj-delivery')?.value || '';
  const projectType = document.getElementById('qpj-type')?.value || 'standard';
  const recurringSeries = getTaskProjectCreateRecurringSeries(projectType);
  const templateId = document.getElementById('qpj-template')?.value || '';
  const selectedTemplate = DB.Templates.get(templateId);

  if (!clientName) { showToast('クライアント名を選ぶか、新規入力してください', 'error'); return; }
  if (!projectName) { showToast('プロジェクト名を入力してください', 'error'); return; }
  if (!ownerMemberId) { showToast('窓口担当を選んでください', 'error'); return; }
  if (!deliveryDate) { showToast('納品日を入力してください', 'error'); return; }
  if (projectType === 'recurring' && !recurringSeries) {
    showToast('定期プロジェクトは定期案件名を選ぶか、新規入力してください', 'error');
    return;
  }
  if (selectedTemplate?.tasks?.length && !deliveryDate) {
    showToast('タスク付きテンプレートは納品日を入力してください', 'error');
    return;
  }
  const taskDrafts = readTemplateTaskDrafts(templateId, deliveryDate, '#qpj-template-preview');

  const project = DB.Projects.add({
    clientName,
    name: projectName,
    deliveryDate,
    budget: '',
    templateId: templateId || 'tpl_blank',
    projectType,
    recurringSeries,
    dealCategory: document.getElementById('qpj-deal-category')?.value || 'existing',
    leadSource: document.getElementById('qpj-lead-source')?.value || '',
    leadSourceDetail: document.getElementById('qpj-lead-source-detail')?.value?.trim() || '',
    startDate: taskDueDateValue(_taskFormData) || DB.today(),
    createdByMemberId: _personalMemberId || ownerMemberId || getDefaultCreatorMemberId(),
    ownerMemberId,
    isProvisional: false,
    projectStatus: 'active',
    note: '',
  });
  const taskCount = createTemplateTasksForProject(project, templateId, ownerMemberId || _taskFormData.memberId || getDefaultCreatorMemberId(), taskDrafts);

  _taskFormData.projectId = project.id;
  _taskFormData.phaseId = '';
  _taskFormData.projectKindFilter = projectType === 'recurring' ? 'recurring' : 'standard';
  _taskFormData.needsProjectReview = false;
  _taskFormData.sourceProjectName = '';
  const kindSel = document.getElementById('tf-project-kind');
  if (kindSel) kindSel.value = _taskFormData.projectKindFilter;
  refreshTaskProjectOptions();
  toggleTaskProjectCreateBox(false);

  const ok = await DB.syncCloudStore?.();
  if (ok === false) {
    showToast('プロジェクトを作成しました。保存状態は「最新に更新」で確認してください', 'info');
    return;
  }
  showToast(taskCount ? `プロジェクトを作成し、標準タスク${taskCount}件も作成しました` : 'プロジェクトを作成し、このタスクに紐付けました', 'success');
}

function stepHours(delta) {
  const next = Math.max(0.25, Math.min(24,
    parseFloat((_taskFormData.estimatedHours || 1)) + delta));
  _taskFormData.estimatedHours = Math.round(next * 4) / 4;
  const disp = document.getElementById('tf-hours-display');
  if (disp) disp.textContent = `${_taskFormData.estimatedHours}h`;
}

function syncTaskStartDateFromDue() {
  const due = document.getElementById('tf-date')?.value || taskDueDateValue(_taskFormData) || DB.today();
  const durationDays = Math.max(1, Number(document.getElementById('tf-duration-days')?.value || _taskFormData.durationDays || 1) || 1);
  const start = taskStartDateFromDueDate(due, durationDays);
  _taskFormData.date = due;
  _taskFormData.dueDate = due;
  _taskFormData.displayDate = _taskFormData.displayDate || due;
  _taskFormData.durationDays = durationDays;
  _taskFormData.startDate = start;
  const startEl = document.getElementById('tf-start-date');
  if (startEl) startEl.value = start;
}

function toggleTaskReviewCustom() {
  const checked = Boolean(document.getElementById('tf-review-custom')?.checked);
  const box = document.getElementById('tf-review-custom-box');
  if (box) box.style.display = checked ? '' : 'none';
}

function readTaskReviewForm() {
  const custom = Boolean(document.getElementById('tf-review-custom')?.checked);
  const dueText = document.getElementById('tf-review-due-days')?.value || '';
  return {
    reviewConfigMode: custom ? 'custom' : 'inherit',
    reviewerMemberIds: custom ? readMultiSelectValues('tf-reviewers') : [],
    approvalMemberIds: custom ? readMultiSelectValues('tf-approvers') : [],
    reviewRule: custom ? (document.getElementById('tf-review-rule')?.value || 'inherit') : 'inherit',
    reviewDueDays: custom && dueText !== '' ? Number(dueText) : null,
    notifyProgressManager: custom ? Boolean(document.getElementById('tf-notify-progress-manager')?.checked) : true,
  };
}

function getTaskBaseReviewConfig(task) {
  if (!task?.projectId) return null;
  const project = DB.Projects.get(task.projectId);
  if (!project) return null;
  const phase = task.phaseId ? (project.phases || []).find(item => item.id === task.phaseId) : null;
  return getPhaseReviewConfig(project, phase);
}

function getTaskReviewConfig(task) {
  const base = getTaskBaseReviewConfig(task);
  if (!base) return {
    reviewerMemberIds: asArray(task?.reviewerMemberIds),
    approvalMemberIds: asArray(task?.approvalMemberIds),
    reviewRule: task?.reviewRule === 'any' ? 'any' : 'all',
    reviewDueDays: task?.reviewDueDays ?? 1,
    notifyProgressManager: task?.notifyProgressManager !== false,
    progressManagerMemberId: '',
  };
  if (task?.reviewConfigMode !== 'custom') return base;
  return {
    ...base,
    reviewerMemberIds: asArray(task.reviewerMemberIds),
    approvalMemberIds: asArray(task.approvalMemberIds),
    reviewRule: task.reviewRule === 'inherit' ? base.reviewRule : (task.reviewRule || base.reviewRule),
    reviewDueDays: task.reviewDueDays ?? base.reviewDueDays,
    notifyProgressManager: task.notifyProgressManager !== false,
  };
}

function taskReviewSummaryText(task) {
  const config = getTaskReviewConfig(task);
  const source = task?.reviewConfigMode === 'custom' ? 'このタスク専用' : 'プロジェクト・フェーズ設定を使用';
  return `${source}：確認者 ${memberNames(config.reviewerMemberIds)} / 許可者 ${memberNames(config.approvalMemberIds)} / ${reviewRuleLabel(config.reviewRule)} / ${Number(config.reviewDueDays) || 1}日以内`;
}

async function saveTask(editId) {
  const memberId = document.getElementById('tf-member')?.value;
  const content  = document.getElementById('tf-content')?.value?.trim();
  const note     = document.getElementById('tf-note')?.value?.trim() || '';
  const taskDate = document.getElementById('tf-date')?.value || DB.today();
  const displayDate = _taskFormData.displayDate || taskDisplayDateValue(_taskFormData) || taskDate;
  const askPayload = readTaskAskForm();
  const reviewPayload = readTaskReviewForm();
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
    dueDate: taskDate,
    displayDate,
    startDate: document.getElementById('tf-start-date')?.value || taskStartDateFromDueDate(taskDate, document.getElementById('tf-duration-days')?.value || _taskFormData.durationDays || 1),
    estimatedHours: _taskFormData.estimatedHours || 1,
    durationDays: Math.max(1, Number(document.getElementById('tf-duration-days')?.value || _taskFormData.durationDays || 1) || 1),
    ...reviewPayload,
    sourceProjectName: _taskFormData.projectId ? '' : (_taskFormData.sourceProjectName || ''),
    needsProjectReview: _taskFormData.projectId ? false : Boolean(_taskFormData.needsProjectReview),
  };

  const before = {
    tasks: taskSnapshot(),
    asks: DB.Asks.all().map(ask => ({ ...ask })),
  };
  let savedTask;
  if (editId) {
    DB.Tasks.update(editId, payload);
    savedTask = DB.Tasks.get(editId);
  } else {
    savedTask = DB.Tasks.add(payload);
  }
  saveTaskLinkedAsk(savedTask, askPayload);
  const ok = await DB.syncCloudStore?.();
  if (ok === false) {
    restoreTaskSnapshot(before.tasks);
    if (DB.Asks.replaceAll) DB.Asks.replaceAll(before.asks);
    showToast('保存できなかったため、追加・更新を元に戻しました。最新に更新してから再度入力してください', 'error');
    return;
  }
  closeModal();
  refreshCurrentPage();
  showToast(editId ? 'タスクを更新しました' : 'タスクを追加しました', 'success');
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
    date: taskDueDateValue(task),
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
    const res = await fetch(apiUrl(`/api/chatwork/messages?roomId=${encodeURIComponent(roomId)}&force=1`), {
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
  return importChatworkTasksFromRoom({ recovery: false });
}

async function recoverChatworkTasksDirect() {
  const ok = confirm('ChatworkのTASK投稿を再確認し、現在残っていないタスクだけ復旧します。\n既に同じ内容のタスクがある場合は追加しません。実行しますか？');
  if (!ok) return;
  return importChatworkTasksFromRoom({ recovery: true });
}

async function importChatworkTasksFromRoom({ recovery = false } = {}) {
  let roomId = getSavedChatworkRoomId();
  const importKey = getSavedChatworkImportKey();
  const targetDate = getTaskDefaultDate();
  const ownerMemberId = getDefaultOwnerMemberId();

  try {
    showToast(recovery ? 'Chatworkから復旧対象を確認しています' : 'ChatworkからTASK部屋を確認しています', 'info');
    const roomQuery = /^\d+$/.test(roomId) ? `roomId=${encodeURIComponent(roomId)}&` : '';
    const res = await fetch(apiUrl(`/api/chatwork/messages?${roomQuery}force=1`), {
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
      recovery,
    });

    if (recovery && result.taskCount === 0 && result.askCount === 0) {
      showToast('復旧できる新しいタスクは見つかりませんでした', 'info');
    } else if (result.importedMessages === 0 && result.skippedDuplicates > 0) {
      showToast('新しく取り込むTASKはありませんでした', 'info');
    } else if (result.importedMessages === 0) {
      showToast('#task / #ask の新規投稿が見つかりませんでした', 'info');
    } else {
      showToast(`${result.taskCount}件のタスク、${result.askCount}件の確認を取り込みました。全員「最新に更新」を押してください`, 'success');
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

function importChatworkMessageList({ roomId, messages, targetDate, ownerMemberId, recovery = false }) {
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
    if (!recovery && DB.ChatworkImports.has(roomId, messageId)) {
      result.skippedDuplicates++;
      return;
    }

    const accountName = message.account?.name || '';
    const accountId = message.account?.account_id || '';
    const member = findMemberByChatworkAccountId(accountId) || findMemberByName(accountName);
    if (!member) {
      if (accountName && !result.unknownMembers.includes(accountName)) result.unknownMembers.push(accountName);
      return;
    }

    const normalizedBody = normalizeChatworkBody(message.body || '');
    const parsed = parseBulkInput(normalizedBody);
    const taskResult = saveParsedChatworkTasks(parsed.tasks, member.id, targetDate, ownerMemberId, {
      roomId,
      messageId,
      recovery,
    });
    const taskCount = taskResult.count;
    const askCount = recovery ? 0 : saveParsedChatworkAsks(parsed.asks, member.id, targetDate);

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
      const res = await fetch(apiUrl('/api/chatwork/reply'), {
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
    '新規プロジェクト作成は、佐久間さん・窓口担当・登録する本人だけが使います。',
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

function chatworkTaskExists({ memberId, projectId, sourceProjectName, content, estimatedHours, date }) {
  const normalizedContent = normalizeTaskDisplayValue(content);
  const normalizedSource = normalizeTaskDisplayValue(sourceProjectName);
  const hours = Number(estimatedHours) || 0;
  return DB.Tasks.allIncludingMerged?.().some(task => {
    if (task.mergedIntoTaskId) return false;
    if (task.memberId !== memberId) return false;
    if (normalizeTaskDisplayValue(task.content) !== normalizedContent) return false;
    if ((Number(task.estimatedHours) || 0) !== hours) return false;
    if ((task.projectId || '') !== (projectId || '')) return false;
    if (normalizeTaskDisplayValue(task.sourceProjectName) !== normalizedSource) return false;
    const taskDates = [taskDueDateValue(task), taskDisplayDateValue(task), task.originalDate].filter(Boolean);
    return !date || taskDates.includes(date);
  }) || false;
}

function saveParsedChatworkTasks(taskParsed, memberId, date, ownerMemberId, options = {}) {
  const result = { count: 0, reviewGroups: [] };
  (taskParsed.groups || []).forEach(group => {
    const project = resolveInputProject(group.projectName);
    const createdTaskIds = [];

    (group.tasks || []).forEach(task => {
      const taskDate = task.date || date;
      const sourceProjectName = project ? '' : (group.projectName || '');
      if (options.recovery && chatworkTaskExists({
        memberId,
        projectId: project?.id || null,
        sourceProjectName,
        content: task.content,
        estimatedHours: task.hours,
        date: taskDate,
      })) {
        return;
      }
      const saved = DB.Tasks.add({
        memberId,
        projectId: project?.id || null,
        phaseId: null,
        content: task.content,
        note: buildInputTaskNote(task.note, group.projectName, project),
        date: taskDate,
        dueDate: taskDate,
        displayDate: taskDate,
        estimatedHours: task.hours,
        sourceProjectName,
        needsProjectReview: Boolean(group.projectName && !project),
        chatworkRoomId: options.roomId || '',
        chatworkMessageId: options.messageId || '',
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

async function saveBulkTasks() {
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

  const unresolvedGroups = getUnresolvedProjectGroups(parsed.tasks);
  if (unresolvedGroups.length) {
    const names = unresolvedGroups.map(group => `・${group.projectName}`).join('\n');
    const ok = window.confirm([
      '既存プロジェクトに一致しない名前があります。',
      '',
      names,
      '',
      '新規プロジェクトは佐久間さん・窓口担当・登録する本人だけが作成します。',
      '通常メンバー分なら、既存プロジェクト名へ直すか、先頭を「?」にして備考へ「新規案件かも」と書いてください。',
      '',
      'このまま登録すると「プロジェクト確認待ち」として残ります。登録しますか？',
    ].join('\n'));
    if (!ok) return;
  }

  const before = {
    tasks: taskSnapshot(),
    asks: DB.Asks.all().map(ask => ({ ...ask })),
  };

  parsed.tasks.groups.forEach(group => {
    const project = resolveInputProject(group.projectName);

    group.tasks.forEach(task => {
      const taskDate = task.date || date;
      DB.Tasks.add({
        memberId,
        projectId: project?.id || null,
        phaseId: null,
        content: task.content,
        note: buildInputTaskNote(task.note, group.projectName, project),
        date: taskDate,
        dueDate: taskDate,
        displayDate: taskDate,
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
  const ok = await DB.syncCloudStore?.();
  if (ok === false) {
    restoreTaskSnapshot(before.tasks);
    if (DB.Asks.replaceAll) DB.Asks.replaceAll(before.asks);
    showToast('保存できなかったため、一括入力を元に戻しました。最新に更新してから再度入力してください', 'error');
    return;
  }
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
  return cleanVisibleTaskNote(note);
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
    '※ プロジェクト名は、なるべくアプリに登録済みの名前を使ってください。',
    '※ 新規案件かもしれない場合は、先頭を「?」にして備考へ「新規案件かも」と書いてください。',
    '※ 未登録のプロジェクト名は勝手に新規作成されず、確認待ちとして残ります。',
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
    createdByMemberId: _personalMemberId || ownerMemberId || getDefaultCreatorMemberId(),
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
  const looseMonthly = normalized.match(/^(.+?)\s*([0-9]{1,2})月$/);
  if (looseMonthly) {
    const clientName = looseMonthly[1].trim();
    const monthName = `${parseInt(looseMonthly[2], 10)}月`;
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
  if (isSuspiciousClientName(normalized)) {
    return { clientName: '未分類', name: normalized, recurringSeries: '' };
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

  const unresolvedGroups = getUnresolvedProjectGroups(taskParsed);
  const noProjectTasks = getNoProjectTasks(taskParsed);
  const missingTasks = getMissingProjectTasks(taskParsed);

  return `
    <div class="bulk-preview">
      <div class="bulk-preview-title">登録前の確認</div>
      ${unresolvedGroups.length ? `
        <div class="bulk-alert danger">
          <div>
            <strong>既存プロジェクトに一致しない名前が ${unresolvedGroups.length}件あります。</strong>
            <p>新規プロジェクトは佐久間さん・窓口担当・登録する本人だけが作成します。通常メンバー分なら既存名に直すか、「?」で新規案件かもとして登録してください。</p>
          </div>
        </div>
      ` : ''}
      ${missingTasks.length ? `
        <div class="bulk-alert">
          <div>
            <strong>プロジェクト確認が必要なタスクが ${missingTasks.length}件あります。</strong>
            <p>${noProjectTasks.length ? `「?」または空欄のタスクが ${noProjectTasks.length}件あります。` : ''} 登録後、個人URLまたは確認URLから正しいプロジェクトに紐付けます。</p>
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
                ? `${projectMissing ? '<span class="status-badge provisional">確認待ち（新規作成しない）</span>' : '<span class="status-badge recurring">登録済み</span>'} ${escHtml(project ? `${project.clientName} / ${project.name}` : group.projectName)}`
                : '<span class="status-badge personal">? / プロジェクト未設定</span>'}
            </div>
            ${projectMissing ? projectCandidateHintHTML(group.projectName) : ''}
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

function getUnresolvedProjectGroups(parsed) {
  return (parsed.groups || [])
    .filter(group => group.projectName && !resolveInputProject(group.projectName));
}

function getNoProjectTasks(parsed) {
  return (parsed.groups || [])
    .filter(group => !group.projectName)
    .flatMap(group => group.tasks || []);
}

function projectCandidateHintHTML(projectName) {
  const candidates = findSimilarProjects(projectName).slice(0, 3);
  if (!candidates.length) {
    return '<div class="bulk-project-candidates">類似プロジェクトは見つかりません。登録する本人・窓口でなければ「?」にして確認待ちにしてください。</div>';
  }
  return `
    <div class="bulk-project-candidates">
      類似候補：${candidates.map(project => `<span>${escHtml(project.clientName)} / ${escHtml(project.name)}</span>`).join('、')}
    </div>`;
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
              ${taskDueDateValue(task) ? `${taskDateTagHTML(taskDueDateValue(task))} ` : ''}
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
          <option value="__new__">登録する本人・窓口として新規作成</option>
          <option value="__admin__">佐久間確認に回す</option>
        </select>
        <div class="form-help">通常は類似プロジェクトを選んでください。新規作成は、佐久間さん・窓口担当・登録する本人だけが使います。</div>
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
      const ok = window.confirm('新規プロジェクトを作成します。これは佐久間さん・窓口担当・登録する本人だけが使う操作です。続けますか？');
      if (!ok) {
        unresolved++;
        return;
      }
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
        createdByMemberId: review.memberId || getDefaultCreatorMemberId(),
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
   ガント
   ============================================================ */
let _ganttFilter = {
  clientName: '',
  recurringSeries: '',
  ownerMemberId: '',
  memberId: '',
  projectType: '',
  startDate: '',
  endDate: '',
};

function renderGantt() {
  const main = document.getElementById('main-content');
  const members = DB.Members.all();
  const activeProjects = DB.Projects.active();
  const tasks = DB.Tasks.all();
  const range = ganttVisibleRange(activeProjects, tasks);
  const projects = sortProjectsByDelivery(activeProjects).filter(project => {
    if (_ganttFilter.clientName && project.clientName !== _ganttFilter.clientName) return false;
    if (_ganttFilter.recurringSeries && (project.recurringSeries || '') !== _ganttFilter.recurringSeries) return false;
    if (_ganttFilter.ownerMemberId && (project.ownerMemberId || '') !== _ganttFilter.ownerMemberId) return false;
    if (_ganttFilter.projectType && (project.projectType || 'standard') !== _ganttFilter.projectType) return false;
    if (_ganttFilter.memberId && !tasks.some(t => t.projectId === project.id && t.memberId === _ganttFilter.memberId)) return false;
    return ganttProjectIntersectsRange(project, range.start, range.end, tasks);
  });

  const clientOptions = uniqueSorted(activeProjects.map(p => p.clientName).filter(Boolean))
    .map(name => `<option value="${escHtml(name)}" ${_ganttFilter.clientName === name ? 'selected' : ''}>${escHtml(name)}</option>`)
    .join('');
  const recurringOptions = uniqueSorted(activeProjects.map(p => p.recurringSeries).filter(Boolean))
    .map(name => `<option value="${escHtml(name)}" ${_ganttFilter.recurringSeries === name ? 'selected' : ''}>${escHtml(name)}</option>`)
    .join('');
  const ownerOptions = members
    .map(m => `<option value="${m.id}" ${_ganttFilter.ownerMemberId === m.id ? 'selected' : ''}>${escHtml(m.name)}</option>`)
    .join('');
  const memberOptions = members
    .map(m => `<option value="${m.id}" ${_ganttFilter.memberId === m.id ? 'selected' : ''}>${escHtml(m.name)}</option>`)
    .join('');
  const days = dateList(range.start, range.end);
  const timelineWidth = days.length * 36;

  main.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h2>ガント</h2>
        <p>クライアント別・定期案件別にプロジェクトとフェーズの流れを確認します</p>
      </div>
    </div>
    <div class="page-body fade-in">
      <div class="gantt-filters">
        <select class="form-select" onchange="_ganttFilter.clientName=this.value;renderGantt()">
          <option value="">全クライアント</option>${clientOptions}
        </select>
        <select class="form-select" onchange="_ganttFilter.recurringSeries=this.value;renderGantt()">
          <option value="">全定期案件</option>${recurringOptions}
        </select>
        <select class="form-select" onchange="_ganttFilter.ownerMemberId=this.value;renderGantt()">
          <option value="">全窓口</option>${ownerOptions}
        </select>
        <select class="form-select" onchange="_ganttFilter.memberId=this.value;renderGantt()">
          <option value="">全担当者</option>${memberOptions}
        </select>
        <select class="form-select" onchange="_ganttFilter.projectType=this.value;renderGantt()">
          <option value="">全プロジェクト種別</option>
          <option value="standard" ${_ganttFilter.projectType === 'standard' ? 'selected' : ''}>通常</option>
          <option value="recurring" ${_ganttFilter.projectType === 'recurring' ? 'selected' : ''}>定期</option>
        </select>
        <input type="date" class="form-input" value="${range.start}" onchange="_ganttFilter.startDate=this.value;renderGantt()">
        <input type="date" class="form-input" value="${range.end}" onchange="_ganttFilter.endDate=this.value;renderGantt()">
        <button class="btn btn-ghost" onclick="resetGanttFilter()">リセット</button>
      </div>

      <div class="gantt-summary">
        <div class="stat-card">
          <div class="stat-value">${projects.length}</div>
          <div class="stat-label">表示中プロジェクト</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${projects.reduce((sum, p) => sum + (p.phases || []).length, 0)}</div>
          <div class="stat-label">表示中フェーズ</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${range.start.slice(5).replace('-', '/')}</div>
          <div class="stat-label">表示開始</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${range.end.slice(5).replace('-', '/')}</div>
          <div class="stat-label">表示終了</div>
        </div>
      </div>

      ${projects.length
        ? `${ganttWorkloadHTML(projects, tasks, members, days)}${ganttChartHTML(projects, tasks, members, days, timelineWidth)}`
        : `<div class="empty-state">
            <div class="icon">📊</div>
            <div class="title">表示できるプロジェクトがありません</div>
            <div class="sub">絞り込み条件を変えるか、プロジェクトに開始日・納品日・フェーズを登録してください</div>
          </div>`}
    </div>
  `;
}

function resetGanttFilter() {
  _ganttFilter = {
    clientName: '',
    recurringSeries: '',
    ownerMemberId: '',
    memberId: '',
    projectType: '',
    startDate: '',
    endDate: '',
  };
  renderGantt();
}

function ganttChartHTML(projects, tasks, members, days, timelineWidth) {
  return `
    <div class="gantt-shell" style="--gantt-width:${timelineWidth}px">
      <div class="gantt-left gantt-left-head">
        <div>プロジェクト / フェーズ</div>
      </div>
      <div class="gantt-scroll gantt-scroll-head">
        <div class="gantt-days" style="width:${timelineWidth}px">
          ${days.map(day => ganttDayHeaderHTML(day)).join('')}
        </div>
      </div>
      ${projects.map((project, index) => ganttProjectBlockHTML(project, tasks, members, days, timelineWidth, index)).join('')}
    </div>
  `;
}

function ganttWorkloadHTML(projects, tasks, members, days) {
  const projectIds = new Set(projects.map(project => project.id));
  const visibleTasks = tasks.filter(task => projectIds.has(task.projectId) && (!_ganttFilter.memberId || task.memberId === _ganttFilter.memberId));
  const memberIds = uniqueSorted(visibleTasks.map(task => task.memberId).filter(Boolean));
  if (!memberIds.length || !days.length) return '';
  const byMember = new Map(memberIds.map(memberId => [memberId, new Map(days.map(day => [day, 0]))]));
  visibleTasks.forEach(task => {
    const bounds = taskScheduleBounds(task);
    const workDays = businessDatesBetween(bounds.start, bounds.end);
    const hoursPerDay = (Number(task.estimatedHours) || 0) / Math.max(workDays.length, 1);
    const memberMap = byMember.get(task.memberId);
    if (!memberMap) return;
    workDays.forEach(day => {
      if (!memberMap.has(day)) return;
      memberMap.set(day, (memberMap.get(day) || 0) + hoursPerDay);
    });
  });

  const rows = memberIds.map(memberId => {
    const member = DB.Members.get(memberId);
    const dayMap = byMember.get(memberId);
    const loads = days.map(day => dayMap.get(day) || 0);
    const max = Math.max(...loads, 0);
    const overDays = loads.filter(hours => hours > 8).length;
    const lowDays = loads.filter(hours => hours > 0 && hours < 4).length;
    return `
      <div class="gantt-load-row">
        <div class="gantt-load-member">
          ${member ? avatarHTML(member, 24) : ''}
          <div>
            <strong>${member ? escHtml(member.name) : '担当未設定'}</strong>
            <span>最大 ${max.toFixed(1)}h / 超過 ${overDays}日 / 余力 ${lowDays}日</span>
          </div>
        </div>
        <div class="gantt-load-days" style="grid-template-columns:repeat(${days.length},24px)">
          ${days.map(day => {
            const hours = dayMap.get(day) || 0;
            const level = hours > 8 ? 'over' : hours >= 6 ? 'busy' : hours > 0 ? 'light' : 'empty';
            return `<span class="gantt-load-cell ${level}" title="${escHtml(DB.fmtDate(day))}：${hours.toFixed(1)}h">${hours ? hours.toFixed(hours >= 10 ? 0 : 1) : ''}</span>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  return `
    <section class="gantt-load-panel card">
      <div class="gantt-load-head">
        <div>
          <h3>担当者別の混み具合</h3>
          <p>各タスクの予定時間を、開始日から締切日までの営業日に按分しています。8h超過は赤、6h以上は黄です。</p>
        </div>
        <span class="gantt-load-cap">1日8h基準</span>
      </div>
      <div class="gantt-load-table">${rows}</div>
    </section>`;
}

function ganttProjectBlockHTML(project, tasks, members, days, timelineWidth, groupIndex = 0) {
  const projectTasks = tasks.filter(t => t.projectId === project.id);
  const bounds = ganttProjectBounds(project, projectTasks);
  const projectBar = ganttBarStyle(bounds.start, bounds.end, days);
  const owner = project.ownerMemberId ? DB.Members.get(project.ownerMemberId) : null;
  const phaseCount = (project.phases || []).length;
  const groupClass = groupIndex % 2 ? 'gantt-group-alt' : 'gantt-group-base';
  const projectTimingClass = project.deliveryDate ? ganttTimingClass(project.deliveryDate, false) : 'is-missing-date';
  const deliveryHTML = project.deliveryDate
    ? `<span>納品：${DB.fmtDate(project.deliveryDate)}</span>${ganttTimingBadgeHTML(projectTimingClass)}`
    : `<span class="gantt-status missing-date">納品日未設定</span><button class="btn btn-ghost btn-sm" onclick="openProjectModal('${project.id}')">入力</button>`;
  const phaseRows = (project.phases || []).length
    ? project.phases.map((phase, index) => ganttPhaseRowHTML(project, phase, index, projectTasks, members, days, phaseCount, groupClass)).join('')
    : `
      <div class="gantt-left gantt-phase-left gantt-group-end ${groupClass}">
        <span class="gantt-phase-name">フェーズ未設定</span>
      </div>
      <div class="gantt-scroll gantt-group-end ${groupClass}">
        <div class="gantt-row-line" style="width:${timelineWidth}px"></div>
      </div>
    `;

  return `
    <div class="gantt-left gantt-project-left gantt-group-start ${groupClass} ${projectTimingClass}">
      <div class="gantt-project-title">${escHtml(project.clientName)} / ${escHtml(project.name)}</div>
      <div class="gantt-project-meta">
        ${project.projectType === 'recurring' && project.recurringSeries ? `<span>定期：${escHtml(project.recurringSeries)}</span>` : ''}
        ${owner ? `<span>窓口：${escHtml(owner.name)}</span>` : '<span class="missing">窓口未設定</span>'}
        ${deliveryHTML}
      </div>
    </div>
    <div class="gantt-scroll gantt-group-start ${groupClass} ${projectTimingClass}">
      <div class="gantt-row-line gantt-project-line" style="width:${timelineWidth}px">
        ${projectBar ? `<div class="gantt-bar gantt-bar-project ${projectTimingClass}" style="${projectBar}" title="${escHtml(project.clientName)} / ${escHtml(project.name)}"></div>` : ''}
        ${ganttTodayMarkerHTML(days)}
      </div>
    </div>
    ${phaseRows}
  `;
}

function ganttPhaseRowHTML(project, phase, index, projectTasks, members, days, phaseCount = 0, groupClass = '') {
  const phaseTasks = projectTasks.filter(t => t.phaseId === phase.id);
  const bounds = ganttPhaseBounds(project, phase, index, project.phases || [], projectTasks);
  const barStyle = ganttBarStyle(bounds.start, bounds.end, days);
  const memberNames = uniqueSorted(phaseTasks.map(t => DB.Members.get(t.memberId)?.name).filter(Boolean));
  const done = phaseTasks.filter(t => t.completed === true).length;
  const total = phaseTasks.length;
  const statusClass = phase.status === 'done' ? 'done' : phase.status === 'active' ? 'active' : 'pending';
  const label = phaseStatusLabel(phase.status);
  const groupEndClass = index === phaseCount - 1 ? 'gantt-group-end' : '';
  const timingClass = ganttTimingClass(phase.dueDate || bounds.end, phase.status === 'done');

  return `
    <div class="gantt-left gantt-phase-left ${groupEndClass} ${groupClass} ${timingClass}">
      <div class="gantt-phase-name">${escHtml(phase.name)}</div>
      <div class="gantt-phase-meta">
        <span class="gantt-status ${statusClass}">${label}</span>
        ${ganttTimingBadgeHTML(timingClass)}
        ${memberNames.length ? `<span>${escHtml(memberNames.join('、'))}</span>` : ''}
        ${total ? `<span>${done}/${total}件</span>` : '<span>タスクなし</span>'}
      </div>
      ${ganttPhaseTaskListHTML(phaseTasks, members)}
    </div>
    <div class="gantt-scroll ${groupEndClass} ${groupClass} ${timingClass}">
      <div class="gantt-row-line" style="width:${days.length * 36}px">
        ${barStyle ? `<div class="gantt-bar gantt-bar-phase ${statusClass} ${timingClass}" style="${barStyle}" title="${escHtml(project.name)}：${escHtml(phase.name)}"></div>` : ''}
        ${ganttTaskBarsHTML(phaseTasks, days)}
        ${ganttTodayMarkerHTML(days)}
      </div>
    </div>
  `;
}

function ganttPhaseTaskListHTML(tasks, members) {
  if (!tasks.length) return '';
  const rows = tasks
    .slice()
    .sort((a, b) => {
      const dateCompare = String(taskDueDateValue(a)).localeCompare(String(taskDueDateValue(b)));
      if (dateCompare) return dateCompare;
      return String(a.content || '').localeCompare(String(b.content || ''), 'ja');
    })
    .map(task => {
      const member = members.find(m => m.id === task.memberId) || DB.Members.get(task.memberId);
      const status = task.completed === true ? '完了' : task.completed === false ? '未完了' : '未確認';
      const note = visibleTaskNote(task);
      const bounds = taskScheduleBounds(task);
      const durationDays = Math.max(1, businessDatesBetween(bounds.start, bounds.end).length);
      return `
        <button type="button" class="gantt-phase-task" onclick="openTaskModal('${task.id}')">
          <span class="gantt-phase-task-title">${escHtml(task.content || '未入力タスク')}</span>
          <span class="gantt-phase-task-meta">
            ${bounds.start && bounds.end ? `${escHtml(DB.fmtDate(bounds.start))}〜${escHtml(DB.fmtDate(bounds.end))}` : '日付未設定'}
            / ${member ? escHtml(member.name) : '担当未設定'}
            / ${Number(task.estimatedHours) || 0}h
            / ${durationDays}日
            / ${status}
          </span>
          ${note ? `<span class="gantt-phase-task-note">${escHtml(note)}</span>` : ''}
        </button>`;
    }).join('');
  return `
    <details class="gantt-phase-tasks">
      <summary>タスクを見る (${tasks.length})</summary>
      <div class="gantt-phase-task-list">${rows}</div>
    </details>`;
}

function ganttTaskBarsHTML(tasks, days) {
  return tasks
    .filter(task => taskDueDateValue(task))
    .map((task, index) => {
      const { start, end } = taskScheduleBounds(task);
      const style = ganttBarStyle(start, end, days);
      if (!style) return '';
      const doneClass = task.completed === true ? 'done' : task.completed === false ? 'active' : 'pending';
      const lane = index % 3;
      return `<div class="gantt-bar gantt-bar-task ${doneClass}" style="${style};top:${11 + lane * 9}px" title="${escHtml(task.content || '未入力タスク')} / ${escHtml(DB.fmtDate(start))}〜${escHtml(DB.fmtDate(end))}"></div>`;
    })
    .join('');
}

function ganttDayHeaderHTML(dateStr) {
  const safeDate = toISODate(dateStr) || DB.today();
  const d = new Date(safeDate + 'T00:00:00');
  const isToday = safeDate === DB.today();
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  return `
    <div class="gantt-day ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}">
      <strong>${d.getDate()}</strong>
      <span>${['日','月','火','水','木','金','土'][d.getDay()]}</span>
    </div>
  `;
}

function ganttTodayMarkerHTML(days) {
  const index = days.indexOf(DB.today());
  if (index < 0) return '';
  return `<div class="gantt-today-marker" style="left:${index * 36}px"></div>`;
}

function ganttBarStyle(start, end, days) {
  start = toISODate(start);
  end = toISODate(end);
  if (!start || !end || !days.length) return '';
  const first = days[0];
  const last = days[days.length - 1];
  const visibleStart = start < first ? first : start;
  const visibleEnd = end > last ? last : end;
  if (visibleEnd < first || visibleStart > last || visibleEnd < visibleStart) return '';
  const left = diffDays(first, visibleStart) * 36 + 4;
  const width = (diffDays(visibleStart, visibleEnd) + 1) * 36 - 8;
  return `left:${left}px;width:${Math.max(width, 20)}px`;
}

function ganttTimingClass(endDate, isDone = false) {
  const end = toISODate(endDate);
  if (!end || isDone) return '';
  const remaining = diffDays(DB.today(), end);
  if (remaining < 0) return 'is-late';
  if (remaining <= 3) return 'is-due-soon';
  return '';
}

function ganttTimingBadgeHTML(timingClass) {
  if (timingClass === 'is-late') return '<span class="gantt-status late">遅れ</span>';
  if (timingClass === 'is-due-soon') return '<span class="gantt-status due-soon">期限近い</span>';
  return '';
}

function ganttVisibleRange(projects, tasks) {
  if (_ganttFilter.startDate || _ganttFilter.endDate) {
    return normalizeDateRange(_ganttFilter.startDate || _ganttFilter.endDate, _ganttFilter.endDate || _ganttFilter.startDate);
  }

  const dates = [];
  projects.forEach(project => {
    const projectTasks = tasks.filter(t => t.projectId === project.id);
    const bounds = ganttProjectBounds(project, projectTasks);
    if (bounds.start) dates.push(bounds.start);
    if (bounds.end) dates.push(bounds.end);
  });
  if (!dates.length) {
    return { start: addDays(DB.today(), -7), end: addDays(DB.today(), 45) };
  }
  const min = dates.sort()[0];
  const max = dates.sort()[dates.length - 1];
  return normalizeDateRange(addDays(min, -7), addDays(max, 10), 120);
}

function ganttProjectIntersectsRange(project, start, end, tasks) {
  const bounds = ganttProjectBounds(project, tasks.filter(t => t.projectId === project.id));
  return Boolean(bounds.start && bounds.end && bounds.start <= end && bounds.end >= start);
}

function ganttProjectBounds(project, projectTasks = []) {
  const taskStarts = projectTasks.map(t => taskScheduleBounds(t).start).filter(Boolean).sort();
  const taskEnds = projectTasks.map(t => taskScheduleBounds(t).end).filter(Boolean).sort();
  const phaseStartDates = (project.phases || []).map(ph => toISODate(ph.startDate)).filter(Boolean).sort();
  const phaseDueDates = (project.phases || []).map(ph => toISODate(ph.dueDate)).filter(Boolean).sort();
  const projectStart = toISODate(project.startDate);
  const deliveryDate = toISODate(project.deliveryDate);
  const createdAt = toISODate(project.createdAt);
  const start = projectStart || phaseStartDates[0] || taskStarts[0] || (deliveryDate ? addDays(deliveryDate, -30) : createdAt || DB.today());
  const end = deliveryDate || phaseDueDates.slice(-1)[0] || taskEnds.slice(-1)[0] || addDays(start, 14);
  return normalizeDateRange(start, end);
}

function ganttPhaseBounds(project, phase, index, phases, projectTasks = []) {
  const phaseTasks = projectTasks.filter(t => t.phaseId === phase.id);
  const taskStarts = phaseTasks.map(t => taskScheduleBounds(t).start).filter(Boolean).sort();
  const taskEnds = phaseTasks.map(t => taskScheduleBounds(t).end).filter(Boolean).sort();
  const phaseStart = toISODate(phase.startDate);
  const phaseDue = toISODate(phase.dueDate);
  if (phaseStart || phaseDue || taskStarts.length || taskEnds.length) {
    const start = phaseStart || taskStarts[0] || phaseDue || '';
    const end = phaseDue || taskEnds.slice(-1)[0] || start;
    return normalizeDateRange(start, end);
  }

  const projectBounds = ganttProjectBounds(project, projectTasks);
  const count = Math.max(phases.length, 1);
  const totalDays = Math.max(diffDays(projectBounds.start, projectBounds.end) + 1, count);
  const phaseDays = Math.max(Math.ceil(totalDays / count), 1);
  const start = addDays(projectBounds.start, index * phaseDays);
  const end = index === count - 1 ? projectBounds.end : addDays(start, phaseDays - 1);
  return normalizeDateRange(start, end);
}

function phaseStatusLabel(status) {
  if (status === 'done') return '完了';
  if (status === 'active') return '進行中';
  return '未着手';
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'ja'));
}

function addDays(dateStr, days) {
  const safeDate = toISODate(dateStr) || DB.today();
  const [year, month, day] = safeDate.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function isBusinessDay(dateStr) {
  const safeDate = toISODate(dateStr);
  if (!safeDate) return false;
  const [year, month, day] = safeDate.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = d.getUTCDay();
  return dayOfWeek !== 0 && dayOfWeek !== 6 && !JP_HOLIDAYS.has(safeDate);
}

function adjustToBusinessDay(dateStr, direction = 'previous') {
  let date = toISODate(dateStr) || DB.today();
  const step = direction === 'next' ? 1 : -1;
  let guard = 0;
  while (!isBusinessDay(date) && guard < 20) {
    date = addDays(date, step);
    guard++;
  }
  return date;
}

function addBusinessDays(dateStr, amount) {
  let date = toISODate(dateStr) || DB.today();
  const offset = Number(amount || 0);
  if (offset === 0) return adjustToBusinessDay(date, 'previous');
  const step = offset > 0 ? 1 : -1;
  let remaining = Math.abs(offset);
  let guard = 0;
  while (remaining > 0 && guard < 500) {
    date = addDays(date, step);
    if (isBusinessDay(date)) remaining--;
    guard++;
  }
  return adjustToBusinessDay(date, step > 0 ? 'next' : 'previous');
}

function templateTaskDueDate(deliveryDate, offset) {
  if (!deliveryDate) return '';
  return addBusinessDays(deliveryDate, Number(offset || 0));
}

function taskStartDateFromDueDate(dueDate, durationDays = 1) {
  const safeDue = toISODate(dueDate);
  if (!safeDue) return '';
  const days = Math.max(1, Number(durationDays || 1) || 1);
  return addBusinessDays(safeDue, -(days - 1));
}

function taskScheduleBounds(task) {
  const due = toISODate(taskDueDateValue(task));
  const durationDays = Math.max(1, Number(task?.durationDays || 1) || 1);
  const start = toISODate(task?.startDate) || taskStartDateFromDueDate(due, durationDays) || due;
  if (!start && !due) return { start: '', end: '' };
  return normalizeDateRange(start, due || start);
}

function businessDatesBetween(startDate, endDate) {
  const range = normalizeDateRange(startDate, endDate);
  const dates = [];
  let current = range.start;
  let guard = 0;
  while (current <= range.end && guard < 500) {
    if (isBusinessDay(current)) dates.push(current);
    current = addDays(current, 1);
    guard++;
  }
  return dates.length ? dates : dateList(range.start, range.end);
}

function diffDays(start, end) {
  const safeStart = toISODate(start) || DB.today();
  const safeEnd = toISODate(end) || safeStart;
  const [sy, sm, sd] = safeStart.split('-').map(Number);
  const [ey, em, ed] = safeEnd.split('-').map(Number);
  const a = Date.UTC(sy, sm - 1, sd);
  const b = Date.UTC(ey, em - 1, ed);
  return Math.round((b - a) / 86400000);
}

function normalizeDateRange(start, end, maxDays = 140) {
  let s = toISODate(start) || DB.today();
  let e = toISODate(end) || s;
  if (e < s) [s, e] = [e, s];
  if (diffDays(s, e) > maxDays) e = addDays(s, maxDays);
  return { start: s, end: e };
}

function dateList(start, end) {
  const days = [];
  const safeRange = normalizeDateRange(start, end);
  for (let date = safeRange.start, guard = 0; date <= safeRange.end && guard <= 150; date = addDays(date, 1), guard++) {
    days.push(date);
  }
  return days;
}

function toISODate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const numeric = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (numeric) {
    const [, y, m, d] = numeric;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const jp = raw.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (jp) {
    const [, y, m, d] = jp;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

/* ============================================================
   プロジェクト
   ============================================================ */
let _projectView = 'active'; // 'active' | 'completed' | 'archived'
let _projectOwnerFilter = '';
let _projectDealFilter = '';
let _projectClientFilter = '';
let _projectLeadSourceFilter = '';

const LEAD_SOURCE_OPTIONS = [
  { value: 'in_house', label: '自社開発' },
  { value: 'lp_inquiry', label: 'LPからの問い合わせ' },
  { value: 'website_inquiry', label: '自社HPからの問い合わせ' },
  { value: 'client_referral', label: '既存クライアントからの紹介' },
  { value: 'agency', label: '代理店からの案件' },
  { value: 'media_radar', label: 'メディアレーダー' },
  { value: 'repeat_client', label: '既存クライアントからの追加依頼' },
  { value: 'direct_sales', label: '営業・直接提案' },
  { value: 'other', label: 'その他' },
];

function leadSourceLabel(value) {
  return LEAD_SOURCE_OPTIONS.find(option => option.value === value)?.label || '未設定';
}

function leadSourceOptionsHTML(current = '') {
  return [
    `<option value="" ${!current ? 'selected' : ''}>未設定</option>`,
    ...LEAD_SOURCE_OPTIONS.map(option =>
      `<option value="${option.value}" ${current === option.value ? 'selected' : ''}>${option.label}</option>`),
  ].join('');
}

function leadSourceFilterOptionsHTML(current = '') {
  return [
    `<option value="" ${!current ? 'selected' : ''}>全流入元</option>`,
    `<option value="__none__" ${current === '__none__' ? 'selected' : ''}>流入元未設定</option>`,
    ...LEAD_SOURCE_OPTIONS.map(option =>
      `<option value="${option.value}" ${current === option.value ? 'selected' : ''}>${option.label}</option>`),
  ].join('');
}

function renderProjects() {
  const main     = document.getElementById('main-content');
  const members  = DB.Members.all();
  const baseProjects =
    _projectView === 'active' ? DB.Projects.active() :
    _projectView === 'completed' ? (DB.Projects.completed ? DB.Projects.completed() : DB.Projects.all().filter(p => !p.archived && p.projectStatus === 'completed')) :
    DB.Projects.archived();
  const availableClientNames = uniqueSorted(baseProjects.map(p => p.clientName).filter(Boolean));
  if (_projectClientFilter && !availableClientNames.includes(_projectClientFilter)) {
    _projectClientFilter = '';
  }
  const filteredProjects = baseProjects.filter(project => {
    if (_projectOwnerFilter === '__none__' && project.ownerMemberId) return false;
    if (_projectOwnerFilter && _projectOwnerFilter !== '__none__' && project.ownerMemberId !== _projectOwnerFilter) return false;
    if (_projectDealFilter && (project.dealCategory || 'existing') !== _projectDealFilter) return false;
    if (_projectLeadSourceFilter === '__none__' && project.leadSource) return false;
    if (_projectLeadSourceFilter && _projectLeadSourceFilter !== '__none__' && project.leadSource !== _projectLeadSourceFilter) return false;
    if (_projectClientFilter && project.clientName !== _projectClientFilter) return false;
    return true;
  });
  const projects = sortProjectsByDelivery(filteredProjects);
  const projectsWithMissingInfo = projects.filter(p => projectMissingInfo(p).length > 0);
  const projectReviewGroups = projectReviewTaskGroups();
  const ownerOptions = members.map(m =>
    `<option value="${m.id}" ${_projectOwnerFilter === m.id ? 'selected' : ''}>${escHtml(m.name)}</option>`
  ).join('');
  const clientOptions = availableClientNames
    .map(name => `<option value="${escHtml(name)}" ${_projectClientFilter === name ? 'selected' : ''}>${escHtml(name)}</option>`)
    .join('');
  const emptyTitle = _projectView === 'active'
    ? '進行中のプロジェクトがありません'
    : _projectView === 'completed'
    ? '完了済みのプロジェクトはありません'
    : 'アーカイブはありません';

  main.innerHTML = `
    <div class="page-header"><div class="page-header-left">
      <h2>プロジェクト</h2>
      <p>プロジェクトとフェーズの管理</p>
    </div></div>
    <div class="page-body fade-in">
      ${projectsWithMissingInfo.length ? `
        <div class="banner banner-warning">
          <span>必要情報が未入力のプロジェクトが ${projectsWithMissingInfo.length}件あります。各プロジェクトの警告から入力依頼を送れます。</span>
        </div>
      ` : ''}
      ${projectReviewGroups.length ? projectReviewTaskNotice(projectReviewGroups) : ''}

      <div class="action-row">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="tab-bar" style="margin-bottom:0">
            <button class="btn ${_projectView==='active'   ? 'btn-primary' : 'btn-ghost'}"
                    onclick="_projectView='active';renderProjects()">進行中</button>
            <button class="btn ${_projectView==='completed' ? 'btn-primary' : 'btn-ghost'}"
                    onclick="_projectView='completed';renderProjects()">完了</button>
            <button class="btn ${_projectView==='archived' ? 'btn-primary' : 'btn-ghost'}"
                    onclick="_projectView='archived';renderProjects()">アーカイブ</button>
          </div>
          <select class="form-select" style="width:190px" onchange="_projectClientFilter=this.value;renderProjects()">
            <option value="" ${!_projectClientFilter ? 'selected' : ''}>全クライアント</option>
            ${clientOptions}
          </select>
          <select class="form-select" style="width:170px" onchange="_projectOwnerFilter=this.value;renderProjects()">
            <option value="" ${!_projectOwnerFilter ? 'selected' : ''}>全窓口</option>
            ${ownerOptions}
            <option value="__none__" ${_projectOwnerFilter === '__none__' ? 'selected' : ''}>窓口未設定</option>
          </select>
          <select class="form-select" style="width:170px" onchange="_projectDealFilter=this.value;renderProjects()">
            <option value="" ${!_projectDealFilter ? 'selected' : ''}>全案件区分</option>
            <option value="existing" ${_projectDealFilter === 'existing' ? 'selected' : ''}>既存クライアント</option>
            <option value="proposal" ${_projectDealFilter === 'proposal' ? 'selected' : ''}>提案ベース</option>
          </select>
          <select class="form-select" style="width:205px" onchange="_projectLeadSourceFilter=this.value;renderProjects()">
            ${leadSourceFilterOptionsHTML(_projectLeadSourceFilter)}
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
            <div class="title">${emptyTitle}</div>
            ${_projectView==='active' ? '<div class="sub" style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="openProjectModal(null)">プロジェクトを追加</button></div>' : ''}
          </div>`
        : projects.map(p => projectCard(p)).join('')}
    </div>`;
}

function projectReviewTaskGroups() {
  const projectIds = new Set(DB.Projects.all().map(project => project.id));
  const groups = new Map();

  DB.Tasks.all()
    .filter(task => {
      if (!task.sourceProjectName) return false;
      if (task.projectId && projectIds.has(task.projectId) && !task.needsProjectReview) return false;
      return true;
    })
    .forEach(task => {
      const sourceName = String(task.sourceProjectName || '').trim() || '名称未設定';
      const key = `${sourceName}||${task.memberId || ''}`;
      const group = groups.get(key) || {
        sourceName,
        memberId: task.memberId || '',
        tasks: [],
      };
      group.tasks.push(task);
      groups.set(key, group);
    });

  return Array.from(groups.values())
    .map(group => {
      const member = group.memberId ? DB.Members.get(group.memberId) : null;
      const openCount = group.tasks.filter(task => task.completed !== true).length;
      const hours = group.tasks.reduce((sum, task) => sum + (Number(task.estimatedHours) || 0), 0);
      const sortedDates = group.tasks
        .map(task => taskDisplayDateValue(task))
        .filter(Boolean)
        .sort();
      const latestDate = sortedDates[sortedDates.length - 1] || '';
      return {
        ...group,
        memberName: member?.name || '担当未設定',
        openCount,
        doneCount: group.tasks.length - openCount,
        hours,
        latestDate,
      };
    })
    .sort((a, b) => String(b.latestDate || '').localeCompare(String(a.latestDate || '')));
}

function projectReviewTaskNotice(groups) {
  const rows = groups.slice(0, 6).map(group => `
    <div class="project-review-task-row">
      <div class="project-review-task-main">
        <strong>${escHtml(group.sourceName)}</strong>
        <span>担当：${escHtml(group.memberName)}</span>
        <span>${group.tasks.length}件 / 未完了 ${group.openCount}件 / ${group.hours}h</span>
        ${group.latestDate ? `<span>最新 ${escHtml(DB.fmtDate(group.latestDate))}</span>` : ''}
      </div>
      <button class="btn btn-secondary btn-sm" onclick="openProjectReviewCleanup('${group.memberId}')">データ整理で確認</button>
    </div>
  `).join('');
  const hidden = groups.length > 6 ? `<div class="project-review-task-more">ほか ${groups.length - 6}件</div>` : '';

  return `
    <section class="project-review-task-notice">
      <div class="project-review-task-head">
        <div>
          <h3>プロジェクト確認待ちタスク</h3>
          <p>ここにある名前はまだ正式プロジェクトではありません。正式プロジェクトへ紐付けると、通常のプロジェクト一覧に反映されます。</p>
        </div>
        <span class="cleanup-pill">${groups.length}件</span>
      </div>
      ${rows}
      ${hidden}
    </section>`;
}

function openProjectReviewCleanup(memberId = '') {
  _cleanupFilter.issue = 'tasks';
  _cleanupFilter.memberId = memberId || '';
  navigate('cleanup');
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
  const projectTasks = allTasks.filter(task => task.projectId === project.id);
  const owner = project.ownerMemberId ? DB.Members.get(project.ownerMemberId) : null;
  const createdBy = project.createdByMemberId ? DB.Members.get(project.createdByMemberId) : null;
  const reviewConfig = getProjectReviewConfig(project);
  const progressManager = reviewConfig.progressManagerMemberId ? DB.Members.get(reviewConfig.progressManagerMemberId) : null;
  const missingInfo = projectMissingInfo(project);
  const effectiveStart = projectEffectiveStartDate(project);
  const completionCandidate = isProjectCompletionCandidate(project, projectTasks);
  const statusBadges = [
    `<span class="status-badge ${(project.dealCategory || 'existing') === 'proposal' ? 'provisional' : 'personal'}">${dealCategoryLabel(project.dealCategory)}</span>`,
    project.projectType === 'recurring' ? '<span class="status-badge recurring">定期案件</span>' : '',
    project.isProvisional ? '<span class="status-badge provisional">仮登録</span>' : '',
    project.projectStatus === 'paused' ? '<span class="status-badge personal">保留</span>' : '',
    project.projectStatus === 'completed' ? '<span class="status-badge personal">完了</span>' : '',
    completionCandidate ? '<span class="status-badge missing">完了候補</span>' : '',
    missingInfo.length ? '<span class="status-badge missing">情報不足</span>' : '',
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
            ${project.projectType === 'recurring' && project.recurringSeries ? `<span class="project-meta-item"><strong>定期案件</strong>${escHtml(project.recurringSeries)}</span>` : ''}
            <span class="project-meta-item ${createdBy ? '' : 'missing'}"><strong>登録者</strong>${createdBy ? escHtml(createdBy.name) : '未設定'}</span>
            <span class="project-meta-item ${owner ? '' : 'missing'}"><strong>窓口</strong>${owner ? escHtml(owner.name) : '未設定'}</span>
            <span class="project-meta-item ${progressManager ? '' : 'missing'}"><strong>進行管理</strong>${progressManager ? escHtml(progressManager.name) : '未設定'}</span>
            <span class="project-meta-item"><strong>確認者</strong>${escHtml(memberNames(reviewConfig.reviewerMemberIds))}</span>
            <span class="project-meta-item"><strong>許可者</strong>${escHtml(memberNames(reviewConfig.approvalMemberIds))}</span>
            <span class="project-meta-item"><strong>確認ルール</strong>${escHtml(reviewRuleLabel(reviewConfig.reviewRule))} / ${Number(reviewConfig.reviewDueDays) || 1}日以内</span>
            <span class="project-meta-item ${project.leadSource ? '' : 'missing'}">
              <strong>流入元</strong>${escHtml(leadSourceLabel(project.leadSource))}
              ${project.leadSourceDetail ? ` / ${escHtml(project.leadSourceDetail)}` : ''}
            </span>
            ${effectiveStart ? `<span class="project-meta-item"><strong>${project.startDate ? '開始日' : '開始目安'}</strong>${DB.fmtDate(effectiveStart)}</span>` : ''}
            ${project.detailsDueAt ? `<span class="project-meta-item"><strong>詳細登録期限</strong>${DB.fmtDate(project.detailsDueAt)}</span>` : ''}
          </div>
          ${missingInfo.length ? `
            <div class="project-warning">
              不足情報：${missingInfo.map(item => item.label).join('、')}
              <button class="btn btn-ghost btn-sm" onclick="copyProjectInfoRequest('${project.id}')">Chatwork文をコピー</button>
              <button class="btn btn-ghost btn-sm" onclick="sendProjectInfoRequest('${project.id}')">Chatworkへ送信</button>
            </div>
          ` : ''}
          ${completionCandidate ? projectCompletionCandidateHTML(project, projectTasks) : ''}
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

function dealCategoryLabel(value) {
  return value === 'proposal' ? '提案ベース' : '既存クライアント';
}

function isProjectCompletionCandidate(project, tasks = DB.Tasks.all().filter(task => task.projectId === project?.id)) {
  if (!project || project.archived || project.projectStatus === 'completed') return false;
  if (tasks.length > 0) return tasks.every(task => task.completed === true);
  const referenceDate = toISODate(project.deliveryDate) || toISODate(project.createdAt);
  return Boolean(referenceDate && diffDays(referenceDate, DB.today()) >= 7);
}

function projectCompletionCandidateHTML(project, tasks = []) {
  const doneCount = tasks.filter(task => task.completed === true).length;
  const reason = tasks.length
    ? `関連タスク ${tasks.length}件がすべて完了しています。`
    : '関連タスクがありません。';
  return `
    <div class="project-warning project-completion-candidate">
      完了候補：${reason}
      <button class="btn btn-ghost btn-sm" onclick="copyProjectCompletionRequest('${project.id}')">完了依頼文をコピー</button>
      <button class="btn btn-ghost btn-sm" onclick="sendProjectCompletionRequest('${project.id}')">登録者へ送信</button>
      <button class="btn btn-success btn-sm" onclick="completeProject('${project.id}')">完了にする</button>
      ${doneCount ? `<span>${doneCount}/${tasks.length}件完了</span>` : ''}
    </div>`;
}

function projectMissingInfo(project) {
  const missing = [];
  if (!project.ownerMemberId) missing.push({ key: 'ownerMemberId', label: '窓口担当' });
  if (!project.createdByMemberId && !project.ownerMemberId) missing.push({ key: 'createdByMemberId', label: '登録者' });
  if (!project.deliveryDate) missing.push({ key: 'deliveryDate', label: '納品日' });
  if (!project.leadSource) missing.push({ key: 'leadSource', label: '案件流入元' });
  const reviewConfig = getProjectReviewConfig(project);
  if (!reviewConfig.progressManagerMemberId) missing.push({ key: 'progressManagerMemberId', label: '進行管理役' });
  if (project.projectType === 'recurring' && !project.recurringSeries) {
    missing.push({ key: 'recurringSeries', label: '定期案件名' });
  }
  return missing;
}

function projectEffectiveStartDate(project) {
  const explicitStart = toISODate(project?.startDate);
  if (explicitStart) return explicitStart;
  const taskDates = DB.Tasks.all()
    .filter(task => task.projectId === project?.id)
    .map(task => toISODate(task.startDate) || toISODate(taskDueDateValue(task)))
    .filter(Boolean)
    .sort();
  return taskDates[0] || toISODate(project?.createdAt) || '';
}

function openProjectTasksModal(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  const rawTasks = DB.Tasks.all()
    .filter(t => t.projectId === projectId)
    .sort((a, b) => {
      if ((a.completed === true) !== (b.completed === true)) return a.completed === true ? 1 : -1;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
  const tasks = collapseTaskDisplayDuplicates(rawTasks)
    .sort((a, b) => {
      if ((a.completed === true) !== (b.completed === true)) return a.completed === true ? 1 : -1;
      return String(sourceDateForTask(a) || a.date || '').localeCompare(String(sourceDateForTask(b) || b.date || ''));
    });
  const totalH = tasks.reduce((sum, task) => sum + (Number(task.estimatedHours) || 0), 0);
  const doneCount = tasks.filter(t => t.completed === true).length;
  const title = `${project.clientName} / ${project.name} のタスク`;
  const hiddenCount = rawTasks.length - tasks.length;

  openModal(`
    <div class="form-help" style="margin-bottom:12px">
      ${tasks.length}件 / ${totalH}h　完了 ${doneCount}件・未完了 ${tasks.length - doneCount}件
      ${hiddenCount > 0 ? `　繰り越し履歴 ${hiddenCount}件を集約表示` : ''}
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
  const duplicateCount = task._displayDuplicateCount || 1;
  const taskIds = task._displayTaskIds || [task.id];
  const originDate = task._displayOriginDate || sourceDateForTask(task);
  const dateLabel = duplicateCount > 1 && task._displayDateSummary ? task._displayDateSummary : '';
  const isCarry = Boolean(task.carriedFromTaskId || task.originalDate || duplicateCount > 1);
  const visibleNote = visibleTaskNote(task);
  return `
    <div class="task-row ${isCarry ? 'task-row-carry' : ''} ${isDone ? 'task-row-done' : ''}" style="margin-bottom:8px">
      <button class="check-btn ${isDone ? 'done' : ''}"
              onclick="toggleProjectTaskComplete('${taskIds.join(',')}')"
              title="${isDone ? '未完了に戻す' : '完了にする'}"
              aria-label="${isDone ? '未完了に戻す' : '完了にする'}">✓</button>
      <div class="task-accent-bar"></div>
      <div class="flex-1">
        <div class="task-title">${escHtml(task.content)}</div>
        ${visibleNote ? `<div class="task-note">備考：${escHtml(visibleNote)}</div>` : ''}
        <div class="task-meta">
          ${taskDateTagHTML(originDate, { carried: isCarry, label: dateLabel || undefined })}
          <span>担当：${member ? escHtml(member.name) : '未設定'}</span>
          ${phaseName ? `<span class="tag tag-phase">${escHtml(phaseName)}</span>` : '<span style="color:var(--text-3)">フェーズなし</span>'}
          ${isCarry ? '<span class="tag tag-carry tag-carry-strong">繰り越し</span>' : ''}
          ${isDone ? '<span class="tag tag-done">完了</span>' : ''}
          ${duplicateCount > 1 ? `<span class="tag">集約 ${duplicateCount}件</span>` : ''}
          <span class="tag-hours">${task.estimatedHours}h</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="openTaskModal('${task.id}')">編集</button>
    </div>`;
}

function createReviewAsksForCompletedTask(task) {
  if (!task?.projectId) return 0;
  const project = DB.Projects.get(task.projectId);
  if (!project) return 0;
  const config = getTaskReviewConfig(task);
  const reviewRecipientIds = new Set(asArray(config.reviewerMemberIds));
  const approvalRecipientIds = new Set(asArray(config.approvalMemberIds));
  if (config.notifyProgressManager && config.progressManagerMemberId) reviewRecipientIds.add(config.progressManagerMemberId);
  reviewRecipientIds.delete(task.memberId);
  approvalRecipientIds.delete(task.memberId);
  if (!reviewRecipientIds.size && !approvalRecipientIds.size) return 0;

  const existing = DB.Asks.all();
  let count = 0;
  const addTaskFlowAsk = (memberId, type, contentPrefix) => {
    const member = DB.Members.get(memberId);
    if (!member) return;
    const alreadyExists = existing.some(ask =>
      ask.taskId === task.id &&
      ask.toMemberId === memberId &&
      ask.status === 'open' &&
      ask.type === type
    );
    if (alreadyExists) return;
    DB.Asks.add({
      type,
      fromMemberId: task.memberId || project.ownerMemberId || '',
      toMemberId: memberId,
      toName: member.name,
      content: `${contentPrefix}：${task.content || '未入力タスク'}`,
      projectId: project.id,
      projectName: `${project.clientName || ''} / ${project.name || ''}`,
      dueText: `${Number(config.reviewDueDays) || 1}日以内`,
      taskId: task.id,
      date: DB.today(),
    });
    count++;
  };
  reviewRecipientIds.forEach(memberId => addTaskFlowAsk(memberId, '確認', '完了タスクの確認'));
  approvalRecipientIds.forEach(memberId => addTaskFlowAsk(memberId, '進行許可', '次工程へ進めてよいか確認'));
  return count;
}

function createReviewAsksForCompletedTasks(taskIds = []) {
  return taskIds
    .map(id => DB.Tasks.get(id))
    .filter(task => task?.completed === true)
    .reduce((sum, task) => sum + createReviewAsksForCompletedTask(task), 0);
}

async function toggleProjectTaskComplete(taskIdsText) {
  const taskIds = String(taskIdsText || '').split(',').map(id => id.trim()).filter(Boolean);
  if (!taskIds.length) return;
  const task = DB.Tasks.get(taskIds[0]);
  if (!task) return;
  const projectId = task.projectId;
  const before = taskSnapshot();
  const beforeAsks = DB.Asks.all().map(ask => ({ ...ask }));
  const nextCompleted = task.completed === true ? null : true;
  taskIds.forEach(taskId => DB.Tasks.setCompletion(taskId, nextCompleted, ''));
  if (nextCompleted === true) createReviewAsksForCompletedTasks(taskIds);
  const ok = await DB.syncCloudStore?.();
  if (ok === false) {
    restoreTaskSnapshot(before);
    DB.Asks.replaceAll?.(beforeAsks);
    showToast('保存できなかったため、チェックを元に戻しました。最新に更新してから再度実行してください', 'error');
  }
  if (projectId) openProjectTasksModal(projectId);
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
  refreshCurrentPage();
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
  `, 'フェーズ編集', { wide: true });
}

function phaseReviewConfigSummary(project, phase) {
  const config = getPhaseReviewConfig(project, phase);
  const source = config.reviewConfigMode === 'custom' ? '個別設定' : 'プロジェクト設定を使用';
  return `${source} / 確認者：${memberNames(config.reviewerMemberIds)} / 許可者：${memberNames(config.approvalMemberIds)} / ${reviewRuleLabel(config.reviewRule)} / ${Number(config.reviewDueDays) || 1}日以内`;
}

function phaseEditorRow(projectId, ph, i) {
  const project = DB.Projects.get(projectId);
  const mode = ph.reviewConfigMode === 'custom' ? 'custom' : 'inherit';
  const customStyle = mode === 'custom' ? '' : 'display:none';
  return `
    <div class="phase-editor-card" id="ph-row-${ph.id}">
      <div class="phase-editor-row">
        <span style="color:var(--text-3);font-size:11px;min-width:18px;text-align:right">${i+1}</span>
        <input type="text" value="${escHtml(ph.name)}" id="ph-name-${ph.id}" placeholder="フェーズ名">
        <select class="form-select" style="width:105px;font-size:12px;padding:5px 8px" id="ph-status-${ph.id}">
          <option value="pending" ${ph.status==='pending' ? 'selected' : ''}>未着手</option>
          <option value="active"  ${ph.status==='active'  ? 'selected' : ''}>進行中</option>
          <option value="done"    ${ph.status==='done'    ? 'selected' : ''}>完了</option>
        </select>
        <input type="date" id="ph-start-${ph.id}" value="${ph.startDate || ''}"
               title="フェーズ開始日"
               style="background:var(--field-bg);border:1px solid var(--border);border-radius:6px;
                      padding:5px 8px;color:var(--text-1);font-size:12px;font-family:inherit;outline:none;width:140px;color-scheme:var(--color-scheme)">
        <input type="date" id="ph-due-${ph.id}" value="${ph.dueDate || ''}"
               title="フェーズ締切日"
               style="background:var(--field-bg);border:1px solid var(--border);border-radius:6px;
                      padding:5px 8px;color:var(--text-1);font-size:12px;font-family:inherit;outline:none;width:140px;color-scheme:var(--color-scheme)">
        <button class="btn btn-danger btn-sm btn-icon"
                onclick="removePhaseFromEditor('${projectId}','${ph.id}')">✕</button>
      </div>
      <div class="phase-review-summary">${escHtml(phaseReviewConfigSummary(project, ph))}</div>
      <div class="phase-review-controls">
        <select class="form-select" id="ph-review-mode-${ph.id}" onchange="togglePhaseReviewConfig('${ph.id}')">
          <option value="inherit" ${mode === 'inherit' ? 'selected' : ''}>プロジェクト設定を使用</option>
          <option value="custom" ${mode === 'custom' ? 'selected' : ''}>このフェーズだけ変更</option>
        </select>
        <label class="checkline compact">
          <input type="checkbox" id="ph-required-${ph.id}" ${ph.requiredBeforeNextPhase === false ? '' : 'checked'}>
          <span>次フェーズ進行前に確認必須</span>
        </label>
      </div>
      <div class="phase-review-custom" id="ph-review-custom-${ph.id}" style="${customStyle}">
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label">確認者</label>
            <select class="form-select member-multi-select" id="ph-reviewers-${ph.id}" multiple size="3">
              ${memberMultiOptionsHTML(ph.reviewerMemberIds || [])}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">許可者</label>
            <select class="form-select member-multi-select" id="ph-approvers-${ph.id}" multiple size="3">
              ${memberMultiOptionsHTML(ph.approvalMemberIds || [])}
            </select>
          </div>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label">確認ルール</label>
            <select class="form-select" id="ph-review-rule-${ph.id}">
              <option value="inherit" ${(ph.reviewRule || 'inherit') === 'inherit' ? 'selected' : ''}>プロジェクト設定を使用</option>
              <option value="all" ${ph.reviewRule === 'all' ? 'selected' : ''}>全員確認</option>
              <option value="any" ${ph.reviewRule === 'any' ? 'selected' : ''}>誰か1人でOK</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">確認期限（日）</label>
            <input type="number" class="form-input" id="ph-review-due-${ph.id}" min="0" step="1" value="${ph.reviewDueDays ?? ''}" placeholder="プロジェクト設定">
          </div>
        </div>
      </div>
    </div>`;
}

function togglePhaseReviewConfig(phaseId) {
  const mode = document.getElementById(`ph-review-mode-${phaseId}`)?.value || 'inherit';
  const custom = document.getElementById(`ph-review-custom-${phaseId}`);
  if (custom) custom.style.display = mode === 'custom' ? '' : 'none';
}

function addPhaseToProject(projectId) {
  const p = DB.Projects.get(projectId);
  if (!p) return;
  const currentPhases = readPhaseEditorValues(p);
  const newPh = {
    id: DB.genId(), name: '新フェーズ', status: 'pending', startDate: '', dueDate: '',
    reviewConfigMode: 'inherit', reviewerMemberIds: [], approvalMemberIds: [],
    reviewRule: 'inherit', reviewDueDays: null, requiredBeforeNextPhase: true,
    order: currentPhases.length,
  };
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
    const startEl  = document.getElementById(`ph-start-${ph.id}`);
    const dueEl    = document.getElementById(`ph-due-${ph.id}`);
    const mode = document.getElementById(`ph-review-mode-${ph.id}`)?.value || 'inherit';
    const reviewDueText = document.getElementById(`ph-review-due-${ph.id}`)?.value || '';
    return {
      ...ph,
      name:    nameEl   ? nameEl.value.trim() || ph.name : ph.name,
      status:  statusEl ? statusEl.value : ph.status,
      startDate: startEl ? startEl.value : ph.startDate,
      dueDate: dueEl    ? dueEl.value : ph.dueDate,
      reviewConfigMode: mode === 'custom' ? 'custom' : 'inherit',
      reviewerMemberIds: mode === 'custom' ? readMultiSelectValues(`ph-reviewers-${ph.id}`) : [],
      approvalMemberIds: mode === 'custom' ? readMultiSelectValues(`ph-approvers-${ph.id}`) : [],
      reviewRule: mode === 'custom' ? (document.getElementById(`ph-review-rule-${ph.id}`)?.value || 'inherit') : 'inherit',
      reviewDueDays: mode === 'custom' && reviewDueText !== '' ? Number(reviewDueText) : null,
      requiredBeforeNextPhase: document.getElementById(`ph-required-${ph.id}`)?.checked !== false,
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
  refreshCurrentPage();
}

/* ─ プロジェクト追加/編集モーダル ─ */
function openProjectModal(editId) {
  const project   = editId ? DB.Projects.get(editId) : null;
  const templates = DB.Templates.all();
  const tplOpts   = templates.map(t => `<option value="${t.id}">${t.name}${t.tasks?.length ? '（タスク付き）' : ''}</option>`).join('');
  const ownerDefault = project?.ownerMemberId || (!editId ? getDefaultOwnerMemberId() : '');
  const createdByDefault = project?.createdByMemberId || (!editId ? getDefaultCreatorMemberId() : getDefaultCreatorMemberId());
  const members   = DB.Members.all();
  const memberOpts = members.map(m =>
    `<option value="${m.id}" ${ownerDefault === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const createdByMember = createdByDefault ? DB.Members.get(createdByDefault) : null;
  const progressManagerDefault = project?.progressManagerMemberId || ownerDefault || createdByDefault || '';
  const progressManagerOpts = members.map(m =>
    `<option value="${m.id}" ${progressManagerDefault === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  const reviewerIds = asArray(project?.reviewerMemberIds);
  const approvalIds = asArray(project?.approvalMemberIds);
  const reviewRule = project?.reviewRule || 'all';
  const reviewDueDays = project?.reviewDueDays ?? 1;
  const type = ['recurring', 'production'].includes(project?.projectType) ? project.projectType : 'standard';
  const status = project?.projectStatus === 'completed' ? 'active' : (project?.projectStatus || 'active');
  const dealCategory = project?.dealCategory || 'existing';
  const leadSource = project?.leadSource || '';
  const clientName = project?.clientName || '';
  const clientOptions = clientNameSelectOptions(clientName);
  const clientSelectValue = clientName && isSuspiciousClientName(clientName)
    ? '__edit__'
    : clientName && clientOptions.includes(clientName)
    ? clientName
    : (clientName || clientOptions.length === 0 ? '__new__' : '');
  const clientSelectOpts = [
    clientOptions.length ? '<option value="">既存クライアントを選択...</option>' : '',
    ...clientOptions.map(name =>
      `<option value="${escHtml(name)}" ${clientSelectValue === name ? 'selected' : ''}>${escHtml(name)}</option>`),
    clientName ? `<option value="__edit__" ${clientSelectValue === '__edit__' ? 'selected' : ''}>現在のクライアント名を直接修正</option>` : '',
    `<option value="__new__" ${clientSelectValue === '__new__' ? 'selected' : ''}>＋ 新規クライアント名を入力</option>`,
  ].join('');
  const recurringSeries = project?.recurringSeries || '';
  const recurringOptions = recurringSeriesSelectOptions(recurringSeries);
  const recurringSelectValue = recurringSeries && recurringOptions.includes(recurringSeries)
    ? recurringSeries
    : (recurringSeries || recurringOptions.length === 0 ? '__new__' : '');
  const recurringSelectOpts = [
    recurringOptions.length ? '<option value="">既存の定期案件を選択...</option>' : '',
    ...recurringOptions.map(name =>
      `<option value="${escHtml(name)}" ${recurringSelectValue === name ? 'selected' : ''}>${escHtml(name)}</option>`),
    `<option value="__new__" ${recurringSelectValue === '__new__' ? 'selected' : ''}>＋ 新規定期案件名を入力</option>`,
  ].join('');

  openModal(`
    <div class="form-help" style="margin-bottom:14px">
      まずは基本情報だけで登録できます。開始日・予算・備考などはあとから足せます。
    </div>
    <div style="font-weight:800;margin-bottom:10px">基本情報</div>
    <div class="form-group">
      <label class="form-label">案件区分</label>
      <select class="form-select" id="pj-deal-category">
        <option value="existing" ${dealCategory === 'existing' ? 'selected' : ''}>既存クライアント</option>
        <option value="proposal" ${dealCategory === 'proposal' ? 'selected' : ''}>提案ベース</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">案件流入元</label>
      <select class="form-select" id="pj-lead-source">
        ${leadSourceOptionsHTML(leadSource)}
      </select>
      <input class="form-input" id="pj-lead-source-detail" style="margin-top:8px"
             placeholder="例：LPの資料請求フォーム / メディアレーダー資料DL後 / 〇〇社から紹介"
             value="${escHtml(project?.leadSourceDetail || '')}">
      <div class="form-help">案件がどこから来たかを残します。後から流入チャネル別の傾向確認に使います。</div>
    </div>
    <div class="form-group">
      <label class="form-label">プロジェクト種別</label>
      <select class="form-select" id="pj-type" onchange="toggleRecurringProjectFields()">
        <option value="standard" ${type === 'standard' ? 'selected' : ''}>通常プロジェクト</option>
        <option value="production" ${project?.projectType === 'production' ? 'selected' : ''}>制作プロジェクト</option>
        <option value="recurring" ${type === 'recurring' ? 'selected' : ''}>定期プロジェクト</option>
      </select>
    </div>
    <div class="form-group" id="pj-recurring-group" style="${type === 'recurring' ? '' : 'display:none'}">
      <label class="form-label">定期案件名</label>
      <select class="form-select" id="pj-recurring-select" onchange="handleRecurringSeriesChange()">
        ${recurringSelectOpts}
      </select>
      <input class="form-input" id="pj-recurring" style="margin-top:8px;${recurringSelectValue === '__new__' ? '' : 'display:none'}"
             placeholder="例：明治安田 月号 / プレゼントキャンペーン更新" value="${recurringSelectValue === '__new__' ? escHtml(recurringSeries) : ''}" oninput="suggestRecurringProjectName()">
      <input class="form-input" id="pj-recurring-issue" style="margin-top:8px"
             oninput="suggestRecurringProjectName()"
             placeholder="例：7月号 / 夏 / 2026年秋号" value="">
      <div class="form-help">既存の定期案件を選ぶと、クライアント名などを自動補完します。プロジェクト名は月号や季節だけ入力できます。</div>
    </div>
    <div class="form-group">
      <label class="form-label">クライアント名 *</label>
      <select class="form-select" id="pj-client-select" onchange="toggleProjectClientFields()">
        ${clientSelectOpts}
      </select>
      <input class="form-input" id="pj-client" style="margin-top:8px;${clientSelectValue === '__new__' || clientSelectValue === '__edit__' ? '' : 'display:none'}"
             placeholder="例：〇〇株式会社" value="${clientSelectValue === '__new__' || clientSelectValue === '__edit__' ? escHtml(clientName) : ''}">
      <div class="form-help">既存から選ぶと、クライアント名の表記ゆれを防げます。</div>
    </div>
    <div class="form-group">
      <label class="form-label">プロジェクト名 *</label>
      <input class="form-input" id="pj-name" placeholder="例：7月号 / 2026年7月切り替え / LP制作" value="${escHtml(project?.name||'')}"
             oninput="this.dataset.manualEdited='1'">
    </div>
    <div class="form-group">
      <label class="form-label">登録者</label>
      <div class="readonly-field">${createdByMember ? escHtml(createdByMember.name) : '未設定'}</div>
      <input type="hidden" id="pj-created-by" value="${escHtml(createdByDefault || '')}">
      <div class="form-help">プロジェクトを登録した人として自動で記録します。</div>
    </div>
    <div class="form-group">
      <label class="form-label">窓口担当</label>
      <select class="form-select" id="pj-owner">
        <option value="">未設定</option>${memberOpts}
      </select>
    </div>
    <div class="project-form-section">
      <div class="project-form-section-title">進行確認体制</div>
      <div class="form-help" style="margin-bottom:10px">
        タスク完了後の確認・許可・監視に使う体制です。フェーズごとの設定は、ここを踏襲してから必要な箇所だけ変更できます。
      </div>
      <div class="form-group">
        <label class="form-label">進行管理役</label>
        <select class="form-select" id="pj-progress-manager">
          <option value="">未設定</option>${progressManagerOpts}
        </select>
        <div class="form-help">確認待ちや許可待ちが止まっていないかを見る人です。未設定の場合は窓口担当を目安にします。</div>
      </div>
      <div class="form-group">
        <label class="form-label">確認義務者（複数選択可）</label>
        <select class="form-select member-multi-select" id="pj-reviewers" multiple size="4">
          ${memberMultiOptionsHTML(reviewerIds)}
        </select>
        <div class="form-help">タスク完了後に確認作業を行う人です。Macはcommand、WindowsはCtrlで複数選択できます。</div>
      </div>
      <div class="form-group">
        <label class="form-label">進行許可者（複数選択可）</label>
        <select class="form-select member-multi-select" id="pj-approvers" multiple size="4">
          ${memberMultiOptionsHTML(approvalIds)}
        </select>
        <div class="form-help">次フェーズや次作業へ進めてよいか判断する人です。</div>
      </div>
      <div class="form-row-2">
        <div class="form-group">
          <label class="form-label">確認ルール</label>
          <select class="form-select" id="pj-review-rule">
            <option value="all" ${reviewRule === 'all' ? 'selected' : ''}>全員確認</option>
            <option value="any" ${reviewRule === 'any' ? 'selected' : ''}>誰か1人でOK</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">確認期限（日）</label>
          <input type="number" class="form-input" id="pj-review-due-days" min="0" step="1" value="${Number(reviewDueDays) || 1}">
        </div>
      </div>
      <label class="checkline">
        <input type="checkbox" id="pj-notify-progress-manager" ${project?.notifyProgressManager === false ? '' : 'checked'}>
        <span>確認待ち・期限超過を進行管理役にも通知する</span>
      </label>
    </div>
    <div class="form-group">
      <label class="form-label">納品日 *</label>
      <input type="date" class="form-input" id="pj-delivery" value="${project?.deliveryDate||''}" onchange="renderProjectTemplatePreview()">
    </div>
    <details style="margin:14px 0;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-glass)" ${project ? 'open' : ''}>
      <summary style="cursor:pointer;font-weight:800;color:var(--text-1)">任意項目（必要になったら入力）</summary>
      <div style="margin-top:14px">
        <div class="form-help" style="margin-bottom:12px">
          納品日・窓口などの基本項目だけで登録できます。ここはガント、予算、補足管理に使う追加情報です。
        </div>
        <div class="form-group">
          <label class="form-label">開始日</label>
          <input type="date" class="form-input" id="pj-start" value="${project?.startDate||''}">
          <div class="form-help">ガントの開始位置です。未設定なら、タスク登録日や納品日から自動推定します。</div>
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
          <div class="form-help">不足情報をいつまでに埋めるかの目安です。未設定でも登録できます。</div>
        </div>
        <div class="form-group">
          <label class="form-label">プロジェクト備考</label>
          <textarea class="form-input" id="pj-note" rows="3" placeholder="案件全体の注意点、前提、引き継ぎなど">${escHtml(project?.note||'')}</textarea>
          <div class="form-help">個別タスクの作業メモではなく、プロジェクト全体に関わる注意点だけを書きます。</div>
        </div>
      </div>
    </details>
    ${!editId ? `
      <div class="form-group">
        <label class="form-label">フェーズテンプレート</label>
        <select class="form-select" id="pj-template" onchange="onProjectTemplateChange()">
          <option value="">テンプレートを選択...</option>${tplOpts}
        </select>
        <div class="form-help">タスク付きテンプレートは、納品日から土日祝を避けて各タスクの締切日と開始日を自動作成します。</div>
        <div id="pj-template-preview" class="template-preview"></div>
      </div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${editId ? `saveProjectEdit('${editId}')` : 'saveProjectNew()'}">
        ${editId ? '更新する' : '作成する'}
      </button>
    </div>
  `, editId ? 'プロジェクトを編集' : 'プロジェクトを追加');
  toggleRecurringProjectFields();
  toggleProjectClientFields();
  renderProjectTemplatePreview();
}

function toggleRecurringProjectFields() {
  const type = document.getElementById('pj-type')?.value || 'standard';
  const recurringGroup = document.getElementById('pj-recurring-group');
  if (recurringGroup) recurringGroup.style.display = type === 'recurring' ? '' : 'none';
  const recurringSelect = document.getElementById('pj-recurring-select');
  const recurringInput = document.getElementById('pj-recurring');
  if (recurringInput) recurringInput.style.display = recurringSelect?.value === '__new__' ? '' : 'none';
  suggestRecurringProjectName();
}

function latestProjectForRecurringSeries(series) {
  const normalized = String(series || '').trim();
  if (!normalized) return null;
  return DB.Projects.all()
    .filter(project => String(project.recurringSeries || '').trim() === normalized)
    .sort((a, b) => String(b.deliveryDate || b.createdAt || '').localeCompare(String(a.deliveryDate || a.createdAt || '')))[0] || null;
}

function setProjectClientFromName(clientName) {
  if (!clientName) return;
  const select = document.getElementById('pj-client-select');
  const input = document.getElementById('pj-client');
  if (!select || !input) return;
  const option = Array.from(select.options).find(opt => opt.value === clientName);
  if (option) {
    select.value = clientName;
    input.value = '';
  } else {
    select.value = '__new__';
    input.value = clientName;
  }
  toggleProjectClientFields();
}

function recurringSeriesBaseProjectName(series) {
  const value = String(series || '').trim();
  return value
    .replace(/\s*月号\s*$/g, '')
    .replace(/\s*更新\s*$/g, '')
    .replace(/\s*定期\s*$/g, '')
    .trim();
}

function suggestedProjectNameFromRecurring(series, issue) {
  const base = recurringSeriesBaseProjectName(series);
  const suffix = String(issue || '').trim();
  if (!base) return suffix;
  if (!suffix) return base;
  if (base.includes(suffix) || suffix.includes(base)) return suffix;
  return `${base} ${suffix}`;
}

function suggestRecurringProjectName() {
  const type = document.getElementById('pj-type')?.value || 'standard';
  if (type !== 'recurring') return;
  const series = getRecurringSeriesFromProjectForm(type);
  const issue = document.getElementById('pj-recurring-issue')?.value || '';
  const nameEl = document.getElementById('pj-name');
  if (!nameEl || nameEl.dataset.manualEdited === '1') return;
  nameEl.value = suggestedProjectNameFromRecurring(series, issue);
}

function handleRecurringSeriesChange() {
  toggleRecurringProjectFields();
  const series = getRecurringSeriesFromProjectForm('recurring');
  const latest = latestProjectForRecurringSeries(series);
  if (latest) {
    setProjectClientFromName(latest.clientName);
    const ownerEl = document.getElementById('pj-owner');
    const dealEl = document.getElementById('pj-deal-category');
    const leadEl = document.getElementById('pj-lead-source');
    const leadDetailEl = document.getElementById('pj-lead-source-detail');
    if (ownerEl && latest.ownerMemberId) ownerEl.value = latest.ownerMemberId;
    if (dealEl && latest.dealCategory) dealEl.value = latest.dealCategory;
    if (leadEl && latest.leadSource) leadEl.value = latest.leadSource;
    if (leadDetailEl && latest.leadSourceDetail) leadDetailEl.value = latest.leadSourceDetail;
  }
  suggestRecurringProjectName();
}

function recurringSeriesSelectOptions(current = '') {
  const names = DB.Projects.all()
    .map(p => p.recurringSeries)
    .filter(Boolean)
    .map(name => String(name).trim())
    .filter(Boolean);
  if (current) names.push(current);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ja'));
}

function getRecurringSeriesFromProjectForm(projectType) {
  if (projectType !== 'recurring') return '';
  const selected = document.getElementById('pj-recurring-select')?.value || '';
  if (selected && selected !== '__new__') return selected.trim();
  return document.getElementById('pj-recurring')?.value?.trim() || '';
}

function clientNameSelectOptions(current = '') {
  const names = DB.Projects.all()
    .map(p => p.clientName)
    .filter(Boolean)
    .map(name => String(name).trim())
    .filter(Boolean)
    .filter(name => name === current || !isSuspiciousClientName(name));
  if (current) names.push(current);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ja'));
}

function isSuspiciousClientName(name) {
  const value = String(name || '').trim();
  if (!value) return false;
  if (value.length >= 16 && !/(株式会社|有限会社|合同会社|Co\.?|Inc\.?|NikoWorks|ニコワークス)/i.test(value)) return true;
  return /(確認|チェック|依頼|作成|制作|投稿|差し替え|赤字|吸収|アポ|提出|共有|修正|原稿|バナー|リール|ストーリーズ|企画)/.test(value);
}

function toggleProjectClientFields() {
  const clientSelect = document.getElementById('pj-client-select');
  const clientInput = document.getElementById('pj-client');
  if (clientInput) clientInput.style.display = clientSelect?.value === '__new__' || clientSelect?.value === '__edit__' ? '' : 'none';
}

function getClientNameFromProjectForm() {
  const selected = document.getElementById('pj-client-select')?.value || '';
  if (selected && selected !== '__new__' && selected !== '__edit__') return selected.trim();
  return document.getElementById('pj-client')?.value?.trim() || '';
}

function onProjectTemplateChange() {
  const templateId = document.getElementById('pj-template')?.value || '';
  const tpl = DB.Templates.get(templateId);
  if (tpl?.tasks?.length) {
    const typeEl = document.getElementById('pj-type');
    if (typeEl && typeEl.value === 'standard') typeEl.value = 'production';
  }
  renderProjectTemplatePreview();
}

function templateScheduleRows(templateId, deliveryDate) {
  const tpl = DB.Templates.get(templateId);
  if (!tpl) return [];
  return (tpl.tasks || []).map(task => ({
    ...task,
    dueDate: templateTaskDueDate(deliveryDate, task.offset),
    durationDays: Math.max(1, Number(task.durationDays || 1) || 1),
    startDate: taskStartDateFromDueDate(templateTaskDueDate(deliveryDate, task.offset), task.durationDays || 1),
  }));
}

function renderTemplatePreviewForForm(options = {}) {
  const {
    previewId = 'pj-template-preview',
    templateId = document.getElementById('pj-template')?.value || '',
    deliveryDate = document.getElementById('pj-delivery')?.value || '',
  } = options;
  const el = document.getElementById(previewId);
  if (!el) return;
  const tpl = DB.Templates.get(templateId);
  if (!tpl) {
    el.innerHTML = '';
    return;
  }
  const rows = templateScheduleRows(templateId, deliveryDate);
  const phasePills = (tpl.phases || []).map(phase => `<span class="tag">${escHtml(typeof phase === 'string' ? phase : phase.name)}</span>`).join('');
  if (!rows.length) {
    el.innerHTML = `
      <div class="template-preview-head">
        <strong>${escHtml(tpl.name)}</strong>
        <span>${tpl.phases?.length || 0}フェーズ</span>
      </div>
      <div class="template-preview-phases">${phasePills || '<span class="form-help">フェーズなし</span>'}</div>
      <div class="form-help">このテンプレートはフェーズのみ作成します。</div>`;
    return;
  }

  const previewRows = rows.map((task, index) => `
    <div class="template-preview-row template-task-draft" data-index="${index}" data-phase="${escHtml(task.phase || '')}">
      <label class="template-preview-check">
        <input type="checkbox" class="tpl-task-enabled" checked>
      </label>
      <input class="form-input tpl-task-content" value="${escHtml(task.content)}" aria-label="タスク名">
      <select class="form-select tpl-task-type" aria-label="種別">
        ${['作業','依頼','確認','待ち','修正','連絡','納品'].map(type =>
          `<option value="${type}" ${(task.type || '作業') === type ? 'selected' : ''}>${type}</option>`).join('')}
      </select>
      <select class="form-select tpl-task-member" aria-label="担当">
        ${memberOptionsHTML(task.defaultMemberId || '', true)}
      </select>
      <input type="date" class="form-input tpl-task-date" value="${deliveryDate ? escHtml(task.dueDate) : ''}" aria-label="締切日">
      <input type="number" class="form-input tpl-task-duration" min="1" step="1" value="${Number(task.durationDays || 1)}" aria-label="遂行期間（日）">
      <input type="number" class="form-input tpl-task-hours" min="0.25" step="0.25" value="${Number(task.hours || 1)}" aria-label="工数">
      <small>${escHtml(task.phase || 'フェーズなし')}</small>
    </div>`).join('');
  el.innerHTML = `
    <div class="template-preview-head">
      <strong>${escHtml(tpl.name)}</strong>
      <span>${rows.length}タスクを自動作成</span>
    </div>
    <div class="template-preview-phases">${phasePills}</div>
    ${deliveryDate ? '' : '<div class="form-help">納品日を入れると締切日を表示します。</div>'}
    <div class="template-preview-list">${previewRows}</div>
    <div class="form-help">不要なタスクはチェックを外せます。タスク名・種別・締切日・遂行期間・工数は登録前に修正できます。</div>`;
}

function renderProjectTemplatePreview() {
  renderTemplatePreviewForForm();
}

function renderTaskProjectTemplatePreview() {
  renderTemplatePreviewForForm({
    previewId: 'qpj-template-preview',
    templateId: document.getElementById('qpj-template')?.value || '',
    deliveryDate: document.getElementById('qpj-delivery')?.value || '',
  });
}

function readTemplateTaskDrafts(templateId, deliveryDate, previewSelector = '#pj-template-preview') {
  const rows = Array.from(document.querySelectorAll(`${previewSelector} .template-task-draft`));
  if (!rows.length) return templateScheduleRows(templateId, deliveryDate);
  return rows
    .filter(row => row.querySelector('.tpl-task-enabled')?.checked)
    .map(row => ({
      phase: row.dataset.phase || '',
      content: row.querySelector('.tpl-task-content')?.value?.trim() || '',
      type: row.querySelector('.tpl-task-type')?.value || '作業',
      defaultMemberId: row.querySelector('.tpl-task-member')?.value || '',
      dueDate: row.querySelector('.tpl-task-date')?.value || '',
      durationDays: Math.max(1, Number(row.querySelector('.tpl-task-duration')?.value || 1) || 1),
      startDate: taskStartDateFromDueDate(row.querySelector('.tpl-task-date')?.value || '', row.querySelector('.tpl-task-duration')?.value || 1),
      hours: Number(row.querySelector('.tpl-task-hours')?.value || 1) || 1,
    }))
    .filter(task => task.content);
}

function createTemplateTasksForProject(project, templateId, fallbackMemberId, taskDrafts = null) {
  const tpl = DB.Templates.get(templateId);
  if (!project || !tpl?.tasks?.length) return 0;
  const phaseByName = new Map((project.phases || []).map(phase => [phase.name, phase]));
  let count = 0;
  const tasks = taskDrafts || templateScheduleRows(templateId, project.deliveryDate);
  tasks.forEach(task => {
    const phase = phaseByName.get(task.phase);
    const dueDate = task.dueDate || templateTaskDueDate(project.deliveryDate, task.offset) || project.deliveryDate || DB.today();
    DB.Tasks.add({
      memberId: task.defaultMemberId || fallbackMemberId,
      projectId: project.id,
      phaseId: phase?.id || null,
      content: task.content,
      estimatedHours: task.hours || 1,
      durationDays: task.durationDays || 1,
      startDate: task.startDate || taskStartDateFromDueDate(dueDate, task.durationDays || 1),
      date: dueDate,
      dueDate,
      displayDate: dueDate,
      taskType: task.type || '作業',
      reviewConfigMode: task.reviewConfigMode === 'custom' ? 'custom' : 'inherit',
      reviewerMemberIds: asArray(task.reviewerMemberIds),
      approvalMemberIds: asArray(task.approvalMemberIds),
      reviewRule: task.reviewRule || 'inherit',
      reviewDueDays: task.reviewDueDays ?? null,
      notifyProgressManager: task.notifyProgressManager !== false,
      note: `テンプレート：${tpl.name}`,
    });
    count++;
  });
  return count;
}

async function saveProjectNew() {
  const clientName = getClientNameFromProjectForm();
  let name       = document.getElementById('pj-name')?.value?.trim();
  const createdByMemberId = document.getElementById('pj-created-by')?.value || getDefaultCreatorMemberId();
  const ownerMemberId = document.getElementById('pj-owner')?.value || '';
  if (!createdByMemberId) {
    showToast('登録者を特定できません。個人URLから開いて登録してください', 'error');
    return;
  }
  const deliveryDate = document.getElementById('pj-delivery')?.value || '';
  const projectType = document.getElementById('pj-type')?.value || 'standard';
  const recurringSeries = getRecurringSeriesFromProjectForm(projectType);
  if (projectType === 'recurring' && !name) {
    name = suggestedProjectNameFromRecurring(recurringSeries, document.getElementById('pj-recurring-issue')?.value || '');
  }
  if (!clientName || !name) { showToast('クライアント名とプロジェクト名は必須です', 'error'); return; }
  if (projectType === 'recurring' && !recurringSeries) {
    showToast('定期プロジェクトは既存の定期案件を選ぶか、新規名を入力してください', 'error');
    return;
  }
  const templateId = document.getElementById('pj-template')?.value || '';
  const selectedTemplate = DB.Templates.get(templateId);
  if (selectedTemplate?.tasks?.length && !deliveryDate) {
    showToast('タスク付きテンプレートは納品日を入力してください', 'error');
    return;
  }
  if (!confirmProjectDeliveryDate(deliveryDate)) return;
  const taskDrafts = readTemplateTaskDrafts(templateId, deliveryDate);
  const before = {
    projects: DB.Projects.all().map(project => ({ ...project })),
    tasks: taskSnapshot(),
  };
  const project = DB.Projects.add({
    clientName, name,
    deliveryDate,
    budget:       document.getElementById('pj-budget')?.value   || '',
    templateId,
    projectType,
    recurringSeries,
    dealCategory:    document.getElementById('pj-deal-category')?.value || 'existing',
    leadSource:      document.getElementById('pj-lead-source')?.value || '',
    leadSourceDetail: document.getElementById('pj-lead-source-detail')?.value?.trim() || '',
    startDate:       document.getElementById('pj-start')?.value || '',
    progressManagerMemberId: document.getElementById('pj-progress-manager')?.value || '',
    reviewerMemberIds: readMultiSelectValues('pj-reviewers'),
    approvalMemberIds: readMultiSelectValues('pj-approvers'),
    reviewRule: document.getElementById('pj-review-rule')?.value || 'all',
    reviewDueDays: Number(document.getElementById('pj-review-due-days')?.value || 1) || 1,
    notifyProgressManager: Boolean(document.getElementById('pj-notify-progress-manager')?.checked),
    createdByMemberId,
    ownerMemberId:   ownerMemberId || getDefaultOwnerMemberId(),
    isProvisional:   false,
    detailsDueAt:    document.getElementById('pj-details-due')?.value || '',
    projectStatus:   document.getElementById('pj-status')?.value || 'active',
    note:            document.getElementById('pj-note')?.value?.trim() || '',
  });
  const taskCount = createTemplateTasksForProject(project, templateId, ownerMemberId || createdByMemberId, taskDrafts);
  const ok = await DB.syncCloudStore?.();
  if (ok === false) {
    DB.Projects.replaceAll?.(before.projects);
    restoreTaskSnapshot(before.tasks);
    showToast('保存できなかったため、プロジェクト作成を元に戻しました。最新に更新してから再度入力してください', 'error');
    return;
  }
  closeModal();
  showToast(taskCount ? `プロジェクトと標準タスク${taskCount}件を作成しました` : 'プロジェクトを作成しました', 'success');
  refreshCurrentPage();
}

function saveProjectEdit(projectId) {
  const existingProject = DB.Projects.get(projectId);
  const clientName = getClientNameFromProjectForm();
  let name       = document.getElementById('pj-name')?.value?.trim();
  const createdByMemberId = existingProject?.createdByMemberId || document.getElementById('pj-created-by')?.value || getDefaultCreatorMemberId();
  const ownerMemberId = document.getElementById('pj-owner')?.value || '';
  if (!createdByMemberId) {
    showToast('登録者を特定できません。個人URLから開いて更新してください', 'error');
    return;
  }
  const deliveryDate = document.getElementById('pj-delivery')?.value || '';
  if (!confirmProjectDeliveryDate(deliveryDate)) return;
  const projectType = document.getElementById('pj-type')?.value || 'standard';
  const recurringSeries = getRecurringSeriesFromProjectForm(projectType);
  if (projectType === 'recurring' && !name) {
    name = suggestedProjectNameFromRecurring(recurringSeries, document.getElementById('pj-recurring-issue')?.value || '');
  }
  if (!clientName || !name) { showToast('クライアント名とプロジェクト名は必須です', 'error'); return; }
  if (projectType === 'recurring' && !recurringSeries) {
    showToast('定期プロジェクトは既存の定期案件を選ぶか、新規名を入力してください', 'error');
    return;
  }
  DB.Projects.update(projectId, {
    clientName, name,
    deliveryDate,
    budget:       document.getElementById('pj-budget')?.value   || '',
    projectType,
    recurringSeries,
    dealCategory:    document.getElementById('pj-deal-category')?.value || 'existing',
    leadSource:      document.getElementById('pj-lead-source')?.value || '',
    leadSourceDetail: document.getElementById('pj-lead-source-detail')?.value?.trim() || '',
    startDate:       document.getElementById('pj-start')?.value || '',
    progressManagerMemberId: document.getElementById('pj-progress-manager')?.value || '',
    reviewerMemberIds: readMultiSelectValues('pj-reviewers'),
    approvalMemberIds: readMultiSelectValues('pj-approvers'),
    reviewRule: document.getElementById('pj-review-rule')?.value || 'all',
    reviewDueDays: Number(document.getElementById('pj-review-due-days')?.value || 1) || 1,
    notifyProgressManager: Boolean(document.getElementById('pj-notify-progress-manager')?.checked),
    createdByMemberId,
    ownerMemberId,
    isProvisional:   false,
    detailsDueAt:    document.getElementById('pj-details-due')?.value || '',
    projectStatus:   document.getElementById('pj-status')?.value || 'active',
    note:            document.getElementById('pj-note')?.value?.trim() || '',
  });
  closeModal();
  showToast('プロジェクトを更新しました', 'success');
  refreshCurrentPage();
}

function confirmProjectDeliveryDate(deliveryDate) {
  if (deliveryDate) return true;
  return confirm('納品日が未入力です。納品日は必須項目です。\n未入力のまま保存すると、プロジェクト画面に警告が出ます。\nこのまま保存しますか？');
}

function findSakumaMember() {
  return DB.Members.all().find(member => /佐久間|sakuma/i.test(member.name || '')) || null;
}

function uniqueMembers(members) {
  const seen = new Set();
  return members.filter(member => {
    if (!member || seen.has(member.id)) return false;
    seen.add(member.id);
    return true;
  });
}

function projectInfoRequestRecipients(project) {
  const owner = project.ownerMemberId ? DB.Members.get(project.ownerMemberId) : null;
  const createdBy = project.createdByMemberId ? DB.Members.get(project.createdByMemberId) : null;
  const sakuma = findSakumaMember();
  return uniqueMembers([owner || createdBy, sakuma]);
}

function buildProjectInfoRequestMessage(project, recipients, withMention = false) {
  const missing = projectMissingInfo(project);
  const recipientList = Array.isArray(recipients) ? recipients : [recipients].filter(Boolean);
  const primaryRecipient = recipientList[0] || null;
  const url = getMemberProjectEditUrl(primaryRecipient?.id || '', project.id);
  const projectName = `${project.clientName} / ${project.name}`;
  const mention = withMention
    ? recipientList
        .filter(member => member.chatworkAccountId)
        .map(member => `[To:${member.chatworkAccountId}] ${member.name}さん`)
        .join('\n')
    : '';
  return [
    `${mention ? `${mention}\n` : ''}[info][title]プロジェクト情報の入力をお願いします[/title]`,
    `${projectName} に不足している情報があります。`,
    '',
    `不足情報：${missing.map(item => item.label).join('、')}`,
    '',
    '下のURLから開いて、プロジェクト編集画面で入力してください。',
    '',
    `入力URL：${url}`,
    '[/info]',
  ].join('\n');
}

async function copyProjectInfoRequest(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  const recipients = projectInfoRequestRecipients(project);
  const message = buildProjectInfoRequestMessage(project, recipients, true);

  try {
    await navigator.clipboard.writeText(message);
    showToast('Chatwork用の入力依頼文をコピーしました', 'success');
  } catch {
    window.prompt('この文章をコピーしてください', message);
  }
}

async function sendProjectInfoRequest(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  const recipients = projectInfoRequestRecipients(project);
  if (!recipients.length) {
    showToast('登録者と窓口担当が未設定です。先にどちらかを選んでください', 'error');
    return;
  }
  const missingChatworkMembers = recipients.filter(member => !member.chatworkAccountId);
  if (missingChatworkMembers.length) {
    showToast(`${missingChatworkMembers.map(member => member.name).join('、')}さんのChatworkアカウントIDが未設定です。設定 > メンバーから登録してください`, 'error');
    return;
  }

  const body = buildProjectInfoRequestMessage(project, recipients, true);
  let importKey = getSavedChatworkImportKey();
  try {
    let res = await fetch(apiUrl('/api/chatwork/reply'), {
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
      res = await fetch(apiUrl('/api/chatwork/reply'), {
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
    showToast(`${recipients.map(member => member.name).join('、')}さん宛にChatworkへ送信しました`, 'success');
  } catch (error) {
    showToast(error.message || 'Chatwork送信に失敗しました', 'error');
  }
}

function projectCompletionRequestRecipients(project) {
  const createdBy = project.createdByMemberId ? DB.Members.get(project.createdByMemberId) : null;
  const owner = project.ownerMemberId ? DB.Members.get(project.ownerMemberId) : null;
  const manager = project.progressManagerMemberId ? DB.Members.get(project.progressManagerMemberId) : null;
  const sakuma = findSakumaMember();
  return uniqueMembers([createdBy, owner, manager, sakuma]);
}

function buildProjectCompletionRequestMessage(project, recipients, withMention = false) {
  const recipientList = Array.isArray(recipients) ? recipients : [recipients].filter(Boolean);
  const primaryRecipient = recipientList[0] || null;
  const tasks = DB.Tasks.all().filter(task => task.projectId === project.id);
  const doneCount = tasks.filter(task => task.completed === true).length;
  const url = getMemberProjectEditUrl(primaryRecipient?.id || '', project.id);
  const projectName = `${project.clientName || '未設定'} / ${project.name || '名称未設定'}`;
  const mention = withMention
    ? recipientList
        .filter(member => member.chatworkAccountId)
        .map(member => `[To:${member.chatworkAccountId}] ${member.name}さん`)
        .join('\n')
    : '';
  return [
    `${mention ? `${mention}\n` : ''}[info][title]プロジェクト完了確認[/title]`,
    `${projectName} は未完了タスクがありません。`,
    '',
    tasks.length ? `タスク：${doneCount}/${tasks.length}件完了` : 'タスク：0件',
    '',
    '完了してよければ、TaskBoardのプロジェクト画面から「完了」ボタンを押してください。',
    'まだ続く場合は、新しいタスクを追加してください。',
    '',
    `確認URL：${url}`,
    '[/info]',
  ].join('\n');
}

async function copyProjectCompletionRequest(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  const recipients = projectCompletionRequestRecipients(project);
  const message = buildProjectCompletionRequestMessage(project, recipients, true);
  try {
    await navigator.clipboard.writeText(message);
    showToast('完了確認依頼文をコピーしました', 'success');
  } catch {
    window.prompt('この文章をコピーしてください', message);
  }
}

async function sendProjectCompletionRequest(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  const recipients = projectCompletionRequestRecipients(project);
  if (!recipients.length) {
    showToast('登録者・窓口・進行管理役が未設定です', 'error');
    return;
  }
  const missingChatworkMembers = recipients.filter(member => !member.chatworkAccountId);
  if (missingChatworkMembers.length) {
    showToast(`${missingChatworkMembers.map(member => member.name).join('、')}さんのChatworkアカウントIDが未設定です。設定 > メンバーから登録してください`, 'error');
    return;
  }

  const body = buildProjectCompletionRequestMessage(project, recipients, true);
  let importKey = getSavedChatworkImportKey();
  try {
    let res = await fetch(apiUrl('/api/chatwork/reply'), {
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
      res = await fetch(apiUrl('/api/chatwork/reply'), {
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
    showToast(`${recipients.map(member => member.name).join('、')}さん宛に完了確認を送信しました`, 'success');
  } catch (error) {
    showToast(error.message || 'Chatwork送信に失敗しました', 'error');
  }
}

function buildDeliveryDateRequestMessage(project, owner, withMention = false) {
  return buildProjectInfoRequestMessage(project, owner, withMention);
}

function copyDeliveryDateRequest(projectId) {
  return copyProjectInfoRequest(projectId);
}

function sendDeliveryDateRequest(projectId) {
  return sendProjectInfoRequest(projectId);
}

function archiveProject(id) {
  DB.Projects.archive(id);
  showToast('アーカイブしました', 'info');
  refreshCurrentPage();
}

function restoreProject(id) {
  DB.Projects.restore(id);
  showToast('復元しました', 'success');
  refreshCurrentPage();
}

function completeProject(id) {
  if (!confirm('このプロジェクトを完了にしますか？')) return;
  DB.Projects.update(id, { projectStatus: 'completed' });
  showToast('プロジェクトを完了にしました', 'success');
  refreshCurrentPage();
}

function reopenProject(id) {
  DB.Projects.update(id, { projectStatus: 'active' });
  showToast('プロジェクトを進行中に戻しました', 'success');
  refreshCurrentPage();
}

function deleteProject(id) {
  const project = DB.Projects.get(id);
  if (!project) return;
  const relatedTasks = DB.Tasks.allIncludingMerged().filter(task => task.projectId === id);
  const relatedAsks = DB.Asks.all().filter(ask =>
    ask.projectId === id || relatedTasks.some(task => task.id === ask.taskId)
  );
  const projectName = `${project.clientName || '未設定'} / ${project.name || '名称未設定'}`;
  const detail = relatedTasks.length || relatedAsks.length
    ? `\n\n関連タスク ${relatedTasks.length}件、確認・お願い ${relatedAsks.length}件も一緒に削除されます。`
    : '\n\n関連タスクはありません。';

  if (!confirm(`${projectName} を削除しますか？${detail}\nこの操作は元に戻せません。`)) return;
  const removedTaskIds = DB.Tasks.removeByProject(id);
  DB.Asks.removeByProjectOrTasks(id, removedTaskIds);
  DB.Projects.remove(id);
  showToast(`プロジェクトと関連タスク${removedTaskIds.length}件を削除しました`, 'info');
  refreshCurrentPage();
}

/* ============================================================
   データ整理
   ============================================================ */
let _cleanupFilter = { memberId: '', issue: 'all' };

function renderDataCleanup() {
  const main = document.getElementById('main-content');
  const issues = analyzeDataIssues();
  const members = DB.Members.all();
  const memberOpts = members
    .map(m => `<option value="${m.id}" ${_cleanupFilter.memberId === m.id ? 'selected' : ''}>${escHtml(m.name)}</option>`)
    .join('');
  const memberName = _cleanupFilter.memberId ? (DB.Members.get(_cleanupFilter.memberId)?.name || '選択中') : '全員';
  const missingProjectTaskCount = issues.missingProjectTasks.reduce((sum, group) => sum + (group.duplicateCount || 1), 0);
  const missingProjectTaskSub = missingProjectTaskCount === issues.missingProjectTasks.length
    ? `${escHtml(memberName)}の確認待ち`
    : `${escHtml(memberName)}の確認待ち / 実タスク${missingProjectTaskCount}件`;

  main.innerHTML = `
    <div class="page-header">
      <div>
        <h2>データ整理</h2>
        <div class="sub">古い仮プロジェクト、未紐付けタスク、繰り越しの不整合を確認・修正します</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost" onclick="downloadDataBackup()">バックアップ</button>
        <button class="btn btn-secondary" onclick="refreshCleanupData()">最新に更新</button>
      </div>
    </div>

    <div class="page-body">
      <div class="banner banner-info">
        <span>まずバックアップを取ってから整理してください。ここでは基本的に「統合」「紐付け」「アーカイブ」で整えます。</span>
      </div>

      <div class="filter-row">
        <select onchange="_cleanupFilter.memberId=this.value;renderDataCleanup()">
          <option value="">全メンバー</option>
          ${memberOpts}
        </select>
        <select onchange="_cleanupFilter.issue=this.value;renderDataCleanup()">
          <option value="all" ${_cleanupFilter.issue === 'all' ? 'selected' : ''}>すべての確認項目</option>
          <option value="tasks" ${_cleanupFilter.issue === 'tasks' ? 'selected' : ''}>未紐付けタスク</option>
          <option value="duplicates" ${_cleanupFilter.issue === 'duplicates' ? 'selected' : ''}>重複タスク</option>
          <option value="projects" ${_cleanupFilter.issue === 'projects' ? 'selected' : ''}>仮プロジェクト</option>
          <option value="completeCandidates" ${_cleanupFilter.issue === 'completeCandidates' ? 'selected' : ''}>完了候補PJ</option>
          <option value="clients" ${_cleanupFilter.issue === 'clients' ? 'selected' : ''}>クライアント整理</option>
          <option value="carry" ${_cleanupFilter.issue === 'carry' ? 'selected' : ''}>繰り越し不整合</option>
        </select>
      </div>

      <div class="cleanup-grid">
        ${cleanupSummaryCard('未紐付けタスク', issues.missingProjectTasks.length, missingProjectTaskSub)}
        ${cleanupSummaryCard('重複タスク', issues.duplicateTaskGroups.length, '同じ内容・日付違いの整理')}
        ${cleanupSummaryCard('仮プロジェクト', issues.provisionalProjects.length, '古い取り込み仕様の名残')}
        ${cleanupSummaryCard('完了候補PJ', issues.completionCandidateProjects.length, 'タスクなし・全タスク完了')}
        ${cleanupSummaryCard('クライアント名', issues.clientStats.length, '表記ゆれ・重複の整理')}
        ${cleanupSummaryCard('繰り越し不整合', issues.carryoverIssues.length, '完了・持ち越しリンクの確認')}
        ${cleanupSummaryCard('不足情報PJ', issues.missingInfoProjects.length, '登録者・窓口・納品日など')}
      </div>

      ${_cleanupFilter.issue === 'all' || _cleanupFilter.issue === 'tasks' ? cleanupTaskSection(issues.missingProjectTasks) : ''}
      ${_cleanupFilter.issue === 'all' || _cleanupFilter.issue === 'duplicates' ? cleanupDuplicateTaskSection(issues.duplicateTaskGroups) : ''}
      ${_cleanupFilter.issue === 'all' || _cleanupFilter.issue === 'projects' ? cleanupProjectSection(issues.provisionalProjects) : ''}
      ${_cleanupFilter.issue === 'all' || _cleanupFilter.issue === 'completeCandidates' ? cleanupCompletionCandidateSection(issues.completionCandidateProjects) : ''}
      ${_cleanupFilter.issue === 'all' || _cleanupFilter.issue === 'clients' ? cleanupClientSection(issues.clientStats) : ''}
      ${_cleanupFilter.issue === 'all' || _cleanupFilter.issue === 'carry' ? cleanupCarryoverSection(issues.carryoverIssues) : ''}
      ${_cleanupFilter.issue === 'all' ? cleanupMissingInfoSection(issues.missingInfoProjects) : ''}
    </div>
  `;
}

function cleanupSummaryCard(label, count, sub) {
  return `
    <div class="cleanup-summary card">
      <div class="cleanup-count">${count}</div>
      <div class="cleanup-label">${label}</div>
      <div class="cleanup-sub">${sub}</div>
    </div>`;
}

function analyzeDataIssues() {
  const members = DB.Members.all();
  const memberIds = new Set(members.map(m => m.id));
  const projects = DB.Projects.all();
  const projectIds = new Set(projects.map(p => p.id));
  const tasks = DB.Tasks.all().filter(task => !_cleanupFilter.memberId || task.memberId === _cleanupFilter.memberId);

  const allTasks = DB.Tasks.all();
  const provisionalProjects = projects
    .filter(p => isCleanupProvisionalProject(p))
    .filter(p => !cleanupProjectAllTasksDone(p, allTasks))
    .sort((a, b) => cleanupProjectName(a).localeCompare(cleanupProjectName(b), 'ja'));

  const missingProjectTasks = groupCleanupMissingProjectTasks(tasks
    .filter(t => !t.projectId || !projectIds.has(t.projectId) || t.needsProjectReview)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))));

  const carryoverIssues = [];
  tasks.forEach(task => {
    const from = task.carriedFromTaskId ? DB.Tasks.get(task.carriedFromTaskId) : null;
    const to = task.carriedOverToTaskId ? DB.Tasks.get(task.carriedOverToTaskId) : null;
    if (task.carriedFromTaskId && !from) {
      carryoverIssues.push({ task, type: 'missingFrom', label: '繰り越し元が見つかりません' });
    }
    if (task.carriedOverToTaskId && !to) {
      carryoverIssues.push({ task, type: 'missingTo', label: '繰り越し先が見つかりません' });
    }
    if (task.completed === true && to && to.completed !== true) {
      carryoverIssues.push({ task, related: to, type: 'completedParentOpenChild', label: '完了済みタスクに未完了の繰り越し先があります' });
    }
  });

  const orphanPhaseTasks = tasks
    .filter(task => {
      if (!task.phaseId || !task.projectId) return false;
      const project = DB.Projects.get(task.projectId);
      return !project || !(project.phases || []).some(phase => phase.id === task.phaseId);
    })
    .map(task => ({ task, type: 'orphanPhase', label: 'フェーズが見つかりません' }));

  const missingMemberTasks = tasks
    .filter(task => !task.memberId || !memberIds.has(task.memberId))
    .map(task => ({ task, type: 'missingMember', label: '担当者が見つかりません' }));

  const missingInfoProjects = projects
    .filter(p => !p.archived && p.projectStatus !== 'completed' && projectMissingInfo(p).length > 0)
    .sort((a, b) => String(a.deliveryDate || '9999-99-99').localeCompare(String(b.deliveryDate || '9999-99-99')));
  const duplicateTaskGroups = findCleanupDuplicateTaskGroups(tasks);
  const completionCandidateProjects = projects
    .filter(project => isProjectCompletionCandidate(project, allTasks.filter(task => task.projectId === project.id)))
    .sort((a, b) => String(a.deliveryDate || '9999-99-99').localeCompare(String(b.deliveryDate || '9999-99-99')));

  return {
    provisionalProjects,
    missingProjectTasks,
    duplicateTaskGroups,
    completionCandidateProjects,
    clientStats: cleanupClientStats(projects),
    carryoverIssues: [...carryoverIssues, ...orphanPhaseTasks, ...missingMemberTasks],
    missingInfoProjects,
  };
}

function isCleanupProvisionalProject(project) {
  return Boolean(
    project?.isProvisional ||
    project?.projectType === 'provisional' ||
    project?.name === '仮プロジェクト' ||
    String(project?.name || '').includes('仮プロジェクト')
  );
}

function cleanupProjectAllTasksDone(project, tasks = DB.Tasks.all()) {
  const relatedTasks = tasks.filter(task => task.projectId === project?.id);
  return relatedTasks.length > 0 && relatedTasks.every(task => task.completed === true);
}

function normalizeCleanupTaskValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanupTaskDuplicateKey(task) {
  return [
    task.memberId || '',
    normalizeCleanupTaskValue(task.content),
    normalizeCleanupTaskValue(task.sourceProjectName || task.projectId || ''),
    Number(task.estimatedHours) || 0,
  ].join('||');
}

function cleanupTaskDateSummary(tasks) {
  const dates = [...new Set(tasks.map(task => taskDisplayDateValue(task)).filter(Boolean))].sort();
  if (!dates.length) return '日付未設定';
  if (dates.length === 1) return DB.fmtDate(dates[0]);
  return `${DB.fmtDate(dates[0])}〜${DB.fmtDate(dates[dates.length - 1])}`;
}

function groupCleanupMissingProjectTasks(tasks) {
  const groups = new Map();
  tasks.forEach(task => {
    const key = cleanupTaskDuplicateKey(task);
    const group = groups.get(key) || { key, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  });
  return Array.from(groups.values())
    .map(group => {
      const sortedTasks = group.tasks
        .slice()
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return {
        ...group,
        tasks: sortedTasks,
        primaryTask: sortedTasks[0],
        duplicateCount: sortedTasks.length,
        taskIds: sortedTasks.map(task => task.id),
        dateSummary: cleanupTaskDateSummary(sortedTasks),
      };
    })
    .sort((a, b) => {
      const dateCompare = String(taskDisplayDateValue(b.primaryTask)).localeCompare(String(taskDisplayDateValue(a.primaryTask)));
      if (dateCompare) return dateCompare;
      return String(a.primaryTask?.content || '').localeCompare(String(b.primaryTask?.content || ''), 'ja');
    });
}

function cleanupDuplicateTaskKey(task) {
  return [
    task.memberId || '',
    task.projectId || normalizeCleanupTaskValue(task.sourceProjectName) || '',
    normalizeCleanupTaskValue(task.content),
    Number(task.estimatedHours) || 0,
  ].join('||');
}

function findCleanupDuplicateTaskGroups(tasks) {
  const groups = new Map();
  tasks
    .filter(task => task.content && task.memberId)
    .forEach(task => {
      const key = cleanupDuplicateTaskKey(task);
      const group = groups.get(key) || [];
      group.push(task);
      groups.set(key, group);
    });

  return Array.from(groups.values())
    .filter(group => group.length > 1)
    .map(group => {
      const sorted = group.slice().sort((a, b) => String(taskDisplayDateValue(a)).localeCompare(String(taskDisplayDateValue(b))));
      const dates = sorted.map(task => taskDisplayDateValue(task)).filter(Boolean);
      const openTasks = sorted.filter(task => task.completed !== true);
      const keep = (openTasks.length ? openTasks : sorted)
        .slice()
        .sort((a, b) => String(taskDisplayDateValue(b)).localeCompare(String(taskDisplayDateValue(a))))[0];
      return {
        tasks: sorted,
        taskIds: sorted.map(task => task.id),
        keepTaskId: keep?.id || sorted[sorted.length - 1]?.id,
        count: sorted.length,
        dateSummary: dates.length
          ? `${DB.fmtDate(dates[0])}${dates.length > 1 ? `〜${DB.fmtDate(dates[dates.length - 1])}` : ''}`
          : '日付未設定',
        oldestDate: dates[0] || '',
        newestDate: dates[dates.length - 1] || '',
      };
    })
    .sort((a, b) => String(b.newestDate || '').localeCompare(String(a.newestDate || '')));
}

function cleanupProjectName(project) {
  if (!project) return 'プロジェクト未選択';
  return `${project.clientName || 'クライアント未設定'} / ${project.name || '名称未設定'}`;
}

function cleanupProjectOptionsHTML(selectedId = '', includeProvisional = false) {
  return projectOptionsHTML(
    DB.Projects.active().filter(project => includeProvisional || !isCleanupProvisionalProject(project)),
    selectedId,
    true
  );
}

function cleanupClientStats(projects = DB.Projects.all()) {
  const stats = new Map();
  projects.forEach(project => {
    const name = String(project.clientName || '').trim() || 'クライアント未設定';
    const current = stats.get(name) || {
      name,
      total: 0,
      active: 0,
      completed: 0,
      archived: 0,
      provisional: 0,
    };
    current.total += 1;
    if (project.archived) current.archived += 1;
    else if (project.projectStatus === 'completed') current.completed += 1;
    else current.active += 1;
    if (isCleanupProvisionalProject(project)) current.provisional += 1;
    stats.set(name, current);
  });

  return Array.from(stats.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

function cleanupClientOptionsHTML(currentName = '') {
  return cleanupClientStats()
    .filter(client => client.name !== currentName && client.name !== 'クライアント未設定')
    .map(client => `<option value="${escHtml(client.name)}">${escHtml(client.name)}（${client.total}件）</option>`)
    .join('');
}

function cleanupTaskSection(tasks) {
  const actualTaskCount = tasks.reduce((sum, group) => sum + (group.duplicateCount || 1), 0);
  const duplicateCount = actualTaskCount - tasks.length;
  return `
    <section class="cleanup-section card">
      <div class="cleanup-section-head">
        <div>
          <h3>未紐付け・確認待ちタスク</h3>
          <p>Chatwork取り込みや古い入力で、正式プロジェクトに紐付いていないタスクです。重複候補は1行にまとめています。</p>
        </div>
        <span class="cleanup-pill">${tasks.length}行${duplicateCount ? ` / 重複${duplicateCount}件を集約` : ''}</span>
      </div>
      ${tasks.length ? tasks.map(cleanupTaskRow).join('') : cleanupEmpty('未紐付けタスクはありません')}
    </section>`;
}

function cleanupTaskRow(taskGroup) {
  const task = taskGroup.primaryTask || taskGroup;
  const taskIds = taskGroup.taskIds || [task.id];
  const duplicateCount = taskGroup.duplicateCount || 1;
  const dateSummary = taskGroup.dateSummary || (taskDisplayDateValue(task) ? DB.fmtDate(taskDisplayDateValue(task)) : '日付未設定');
  const member = DB.Members.get(task.memberId);
  const currentProject = DB.Projects.get(task.projectId);
  const isDeletedProjectTask = Boolean(task.projectId && !currentProject);
  const projectHint = task.sourceProjectName
    ? `確認名：${task.sourceProjectName}`
    : isDeletedProjectTask
    ? '削除済みプロジェクトの残タスク'
    : `現在の紐付け：${cleanupProjectName(currentProject)}`;
  const selectId = `cleanup-task-project-${task.id}`;
  return `
    <div class="cleanup-row">
      <div class="cleanup-main">
        <div class="cleanup-title">
          ${escHtml(task.content || '未入力タスク')}
          ${duplicateCount > 1 ? `<span class="cleanup-pill" style="margin-left:8px">重複 ${duplicateCount}件</span>` : ''}
        </div>
        <div class="cleanup-meta">
          <span>${escHtml(dateSummary)}</span>
          <span>担当：${member ? escHtml(member.name) : '未設定'}</span>
          <span>${escHtml(projectHint)}</span>
          <span>${Number(task.estimatedHours) || 0}h</span>
        </div>
      </div>
      <div class="cleanup-actions">
        <select id="${selectId}">
          <option value="">正式プロジェクトを選択...</option>
          ${cleanupProjectOptionsHTML(task.projectId || '')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="assignCleanupTaskProjectGroup('${taskIds.join(',')}', '', '${selectId}')">
          ${duplicateCount > 1 ? 'まとめて紐付け' : '紐付け'}
        </button>
        <button class="btn btn-ghost btn-sm" onclick="openTaskModal('${task.id}')">編集</button>
        ${isDeletedProjectTask ? `<button class="btn btn-danger btn-sm" onclick="deleteCleanupTasks('${taskIds.join(',')}')">タスク削除</button>` : ''}
      </div>
    </div>`;
}

function cleanupDuplicateTaskSection(groups) {
  return `
    <section class="cleanup-section card">
      <div class="cleanup-section-head">
        <div>
          <h3>重複タスク</h3>
          <p>同じ担当者・同じ内容・同じプロジェクトで、日付違いなどにより複数あるタスク候補です。確認して1件に統合できます。</p>
        </div>
        <span class="cleanup-pill">${groups.length}件</span>
      </div>
      ${groups.length ? groups.map(cleanupDuplicateTaskRow).join('') : cleanupEmpty('重複タスク候補はありません')}
    </section>`;
}

function cleanupDuplicateTaskRow(group) {
  const task = DB.Tasks.get(group.keepTaskId) || group.tasks[group.tasks.length - 1];
  const member = DB.Members.get(task.memberId);
  const project = task.projectId ? DB.Projects.get(task.projectId) : null;
  const projectLabel = project ? cleanupProjectName(project) : (task.sourceProjectName ? `確認待ち：${task.sourceProjectName}` : 'プロジェクト未選択');
  const doneCount = group.tasks.filter(item => item.completed === true).length;
  const openCount = group.tasks.length - doneCount;
  const detailRows = group.tasks.map(item => cleanupDuplicateTaskDetailRow(item, item.id === group.keepTaskId)).join('');
  return `
    <div class="cleanup-row">
      <div class="cleanup-main">
        <div class="cleanup-title">
          ${escHtml(task.content || '未入力タスク')}
          <span class="cleanup-pill" style="margin-left:8px">${group.count}件</span>
          ${doneCount ? `<span class="cleanup-pill" style="margin-left:6px;background:var(--danger-soft);color:var(--danger)">完了混在</span>` : ''}
        </div>
        <div class="cleanup-meta">
          <span>${escHtml(group.dateSummary)}</span>
          <span>担当：${member ? escHtml(member.name) : '未設定'}</span>
          <span>${escHtml(projectLabel)}</span>
          <span>未完了 ${openCount}件 / 完了 ${doneCount}件</span>
          <span>${Number(task.estimatedHours) || 0}h</span>
        </div>
        <details style="margin-top:10px">
          <summary style="cursor:pointer;color:var(--text-2);font-weight:700">候補タスクの内容を確認</summary>
          <div style="margin-top:8px;display:grid;gap:6px">
            ${detailRows}
          </div>
        </details>
      </div>
      <div class="cleanup-actions">
        <button class="btn btn-secondary btn-sm" onclick="mergeCleanupDuplicateTasks('${group.taskIds.join(',')}', '${group.keepTaskId}')">統合</button>
        <button class="btn btn-ghost btn-sm" onclick="openTaskModal('${group.keepTaskId}')">残すタスクを編集</button>
      </div>
    </div>`;
}

function cleanupDuplicateTaskDetailRow(task, willKeep = false) {
  const member = DB.Members.get(task.memberId);
  const project = task.projectId ? DB.Projects.get(task.projectId) : null;
  const projectLabel = project ? cleanupProjectName(project) : (task.sourceProjectName ? `確認待ち：${task.sourceProjectName}` : 'プロジェクト未選択');
  const status = task.completed === true ? '完了' : task.completed === false ? '未完了' : '未確認';
  const note = visibleTaskNote(task);
  return `
    <div style="border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg-glass)">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        ${willKeep ? '<span class="tag tag-done">残す候補</span>' : ''}
        <span class="tag">${escHtml(taskDisplayDateValue(task) ? DB.fmtDate(taskDisplayDateValue(task)) : '日付未設定')}</span>
        ${task.originalDate ? `<span class="tag">開始 ${escHtml(DB.fmtDate(task.originalDate))}</span>` : ''}
        <span class="tag ${task.completed === true ? 'tag-done' : ''}">${status}</span>
        <span class="tag-hours">${Number(task.estimatedHours) || 0}h</span>
      </div>
      <div style="font-weight:700;color:var(--text-1);margin-bottom:3px">${escHtml(task.content || '未入力タスク')}</div>
      <div class="cleanup-meta">
        <span>担当：${member ? escHtml(member.name) : '未設定'}</span>
        <span>${escHtml(projectLabel)}</span>
        ${note ? `<span>備考：${escHtml(note)}</span>` : ''}
      </div>
    </div>`;
}

function cleanupProjectSection(projects) {
  return `
    <section class="cleanup-section card">
      <div class="cleanup-section-head">
        <div>
          <h3>仮プロジェクト</h3>
          <p>過去の取り込み処理で自動作成されたものです。正式プロジェクトへ統合するか、不要ならアーカイブします。</p>
        </div>
        <span class="cleanup-pill">${projects.length}件</span>
      </div>
      ${projects.length ? projects.map(cleanupProjectRow).join('') : cleanupEmpty('仮プロジェクトはありません')}
    </section>`;
}

function cleanupCompletionCandidateSection(projects) {
  return `
    <section class="cleanup-section card">
      <div class="cleanup-section-head">
        <div>
          <h3>完了候補プロジェクト</h3>
          <p>タスクがない、または全タスクが完了している進行中プロジェクトです。登録者へ確認し、完了なら完了ボタンを押してもらいます。</p>
        </div>
        <span class="cleanup-pill">${projects.length}件</span>
      </div>
      ${projects.length ? projects.map(cleanupCompletionCandidateRow).join('') : cleanupEmpty('完了候補プロジェクトはありません')}
    </section>`;
}

function cleanupCompletionCandidateRow(project) {
  const relatedTasks = DB.Tasks.all().filter(task => task.projectId === project.id);
  const doneCount = relatedTasks.filter(task => task.completed === true).length;
  const createdBy = project.createdByMemberId ? DB.Members.get(project.createdByMemberId) : null;
  const owner = project.ownerMemberId ? DB.Members.get(project.ownerMemberId) : null;
  return `
    <div class="cleanup-row">
      <div class="cleanup-main">
        <div class="cleanup-title">${escHtml(cleanupProjectName(project))}</div>
        <div class="cleanup-meta">
          <span class="cleanup-warning">${relatedTasks.length ? `全タスク完了 ${doneCount}/${relatedTasks.length}件` : 'タスクなし'}</span>
          <span>登録者：${createdBy ? escHtml(createdBy.name) : '未設定'}</span>
          <span>窓口：${owner ? escHtml(owner.name) : '未設定'}</span>
          <span>納品：${project.deliveryDate ? escHtml(DB.fmtDate(project.deliveryDate)) : '未設定'}</span>
        </div>
      </div>
      <div class="cleanup-actions">
        <button class="btn btn-secondary btn-sm" onclick="copyProjectCompletionRequest('${project.id}')">依頼文コピー</button>
        <button class="btn btn-secondary btn-sm" onclick="sendProjectCompletionRequest('${project.id}')">登録者へ送信</button>
        <button class="btn btn-ghost btn-sm" onclick="openProjectTasksModal('${project.id}')">タスク確認</button>
        <button class="btn btn-success btn-sm" onclick="completeProject('${project.id}')">完了にする</button>
      </div>
    </div>`;
}

function cleanupClientSection(clients) {
  return `
    <section class="cleanup-section card">
      <div class="cleanup-section-head">
        <div>
          <h3>クライアント整理</h3>
          <p>京急と京浜急行のような表記ゆれを、正式なクライアント名へ統合します。関連プロジェクトのクライアント名だけを置き換え、タスクは削除しません。</p>
        </div>
        <span class="cleanup-pill">${clients.length}件</span>
      </div>
      ${clients.length ? clients.map(cleanupClientRow).join('') : cleanupEmpty('クライアント名はありません')}
    </section>`;
}

function cleanupClientRow(client, index) {
  const encodedName = encodeURIComponent(client.name);
  const options = cleanupClientOptionsHTML(client.name);
  return `
    <div class="cleanup-row cleanup-row-client">
      <div class="cleanup-main">
        <div class="cleanup-title">${escHtml(client.name)}</div>
        <div class="cleanup-meta">
          <span>関連プロジェクト ${client.total}件</span>
          <span>進行中 ${client.active}件</span>
          <span>完了 ${client.completed}件</span>
          <span>アーカイブ ${client.archived}件</span>
          ${client.provisional ? `<span class="cleanup-warning">仮PJ ${client.provisional}件</span>` : ''}
        </div>
      </div>
      <div class="cleanup-actions cleanup-actions-stack">
        <div class="cleanup-action-line">
          <select id="cleanup-client-target-${index}" ${options ? '' : 'disabled'}>
            <option value="">統合先クライアントを選択...</option>
            ${options}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="mergeCleanupClient('${encodedName}', ${index})" ${options ? '' : 'disabled'}>統合</button>
        </div>
        <div class="cleanup-action-line">
          <input class="form-input" id="cleanup-client-rename-${index}" placeholder="新しい正式名称を入力" value="${escHtml(client.name === 'クライアント未設定' ? '' : client.name)}">
          <button class="btn btn-ghost btn-sm" onclick="renameCleanupClient('${encodedName}', ${index})">名称変更</button>
        </div>
      </div>
    </div>`;
}

function cleanupProjectRow(project) {
  const relatedTasks = DB.Tasks.all().filter(task => task.projectId === project.id);
  const missing = projectMissingInfo(project).map(item => item.label).join('、') || 'なし';
  const hasTasks = relatedTasks.length > 0;
  return `
    <div class="cleanup-row">
      <div class="cleanup-main">
        <div class="cleanup-title">${escHtml(cleanupProjectName(project))}</div>
        <div class="cleanup-meta">
          <span>関連タスク ${relatedTasks.length}件</span>
          <span>不足：${escHtml(missing)}</span>
          <span>${project.archived ? 'アーカイブ済み' : '進行中'}</span>
        </div>
      </div>
      <div class="cleanup-actions">
        <select id="cleanup-merge-${project.id}">
          <option value="">統合先プロジェクトを選択...</option>
          ${cleanupProjectOptionsHTML('', false)}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="mergeCleanupProject('${project.id}')">統合</button>
        <button class="btn btn-ghost btn-sm" onclick="openProjectTasksModal('${project.id}')">タスク確認</button>
        <button class="btn btn-ghost btn-sm" onclick="openProjectModal('${project.id}')">編集</button>
        ${hasTasks
          ? `<button class="btn btn-danger btn-sm" onclick="archiveCleanupProject('${project.id}')">アーカイブ</button>`
          : `<button class="btn btn-danger btn-sm" onclick="deleteEmptyCleanupProject('${project.id}')">削除</button>`}
      </div>
    </div>`;
}

function cleanupCarryoverSection(issues) {
  return `
    <section class="cleanup-section card">
      <div class="cleanup-section-head">
        <div>
          <h3>繰り越し・完了状態の確認</h3>
          <p>完了チェックが戻る、持ち越し表示が不安定になる原因になりやすいリンクを確認します。</p>
        </div>
        <span class="cleanup-pill">${issues.length}件</span>
      </div>
      ${issues.length ? issues.map(cleanupCarryoverRow).join('') : cleanupEmpty('繰り越し不整合はありません')}
    </section>`;
}

function cleanupCarryoverRow(issue) {
  const task = issue.task;
  const member = DB.Members.get(task.memberId);
  return `
    <div class="cleanup-row">
      <div class="cleanup-main">
        <div class="cleanup-title">${escHtml(task.content || '未入力タスク')}</div>
        <div class="cleanup-meta">
          <span class="cleanup-warning">${escHtml(issue.label)}</span>
          <span>${escHtml(taskDisplayDateValue(task) ? DB.fmtDate(taskDisplayDateValue(task)) : '日付未設定')}</span>
          <span>担当：${member ? escHtml(member.name) : '未設定'}</span>
          <span>${task.completed === true ? '完了' : '未完了'}</span>
        </div>
      </div>
      <div class="cleanup-actions">
        ${issue.type === 'missingFrom' ? `<button class="btn btn-secondary btn-sm" onclick="unlinkCleanupCarry('${task.id}', 'from')">元リンク解除</button>` : ''}
        ${issue.type === 'missingTo' ? `<button class="btn btn-secondary btn-sm" onclick="unlinkCleanupCarry('${task.id}', 'to')">先リンク解除</button>` : ''}
        ${issue.type === 'completedParentOpenChild' ? `<button class="btn btn-secondary btn-sm" onclick="completeCleanupCarryChild('${issue.related.id}')">繰り越し先も完了</button>` : ''}
        ${issue.type === 'orphanPhase' ? `<button class="btn btn-secondary btn-sm" onclick="clearCleanupPhase('${task.id}')">フェーズ解除</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="openTaskModal('${task.id}')">編集</button>
      </div>
    </div>`;
}

function cleanupMissingInfoSection(projects) {
  return `
    <section class="cleanup-section card">
      <div class="cleanup-section-head">
        <div>
          <h3>不足情報のあるプロジェクト</h3>
          <p>ガントや進行管理に必要な情報が欠けているプロジェクトです。</p>
        </div>
        <span class="cleanup-pill">${projects.length}件</span>
      </div>
      ${projects.length ? projects.map(project => {
        const missing = projectMissingInfo(project).map(item => item.label).join('、');
        return `
          <div class="cleanup-row">
            <div class="cleanup-main">
              <div class="cleanup-title">${escHtml(cleanupProjectName(project))}</div>
              <div class="cleanup-meta">
                <span class="cleanup-warning">不足：${escHtml(missing)}</span>
                <span>納品：${project.deliveryDate ? escHtml(DB.fmtDate(project.deliveryDate)) : '未設定'}</span>
              </div>
            </div>
            <div class="cleanup-actions">
              <button class="btn btn-secondary btn-sm" onclick="openProjectModal('${project.id}')">編集</button>
            </div>
          </div>`;
      }).join('') : cleanupEmpty('不足情報のあるプロジェクトはありません')}
    </section>`;
}

function cleanupEmpty(text) {
  return `<div class="empty-state" style="padding:24px"><div class="title">${escHtml(text)}</div></div>`;
}

async function saveCleanupAndRefresh(message) {
  const ok = await DB.syncCloudStore?.();
  if (ok === false) showToast('保存に失敗しました。通信状態を確認してください', 'error');
  else showToast(message, 'success');
  renderDataCleanup();
}

async function refreshCleanupData() {
  const ok = await DB.reloadCloudStore?.();
  if (ok === false) showToast('最新データの取得に失敗しました', 'error');
  else showToast('最新データに更新しました', 'success');
  renderDataCleanup();
}

async function assignCleanupTaskProject(taskId, selectedProjectId = '') {
  const projectId = selectedProjectId || document.getElementById(`cleanup-task-project-${taskId}`)?.value;
  if (!projectId) {
    showToast('紐付ける正式プロジェクトを選んでください', 'error');
    return;
  }
  DB.Tasks.update(taskId, {
    projectId,
    phaseId: null,
    sourceProjectName: '',
    needsProjectReview: false,
  });
  await saveCleanupAndRefresh('タスクを正式プロジェクトへ紐付けました');
}

async function assignCleanupTaskProjectGroup(taskIdsText, selectedProjectId = '', selectId = '') {
  const taskIds = String(taskIdsText || '').split(',').map(id => id.trim()).filter(Boolean);
  const projectId = selectedProjectId || (selectId ? document.getElementById(selectId)?.value : '');
  if (!taskIds.length) {
    showToast('紐付けるタスクが見つかりません', 'error');
    return;
  }
  if (!projectId) {
    showToast('紐付ける正式プロジェクトを選んでください', 'error');
    return;
  }
  if (taskIds.length > 1) {
    const project = DB.Projects.get(projectId);
    const projectName = project ? cleanupProjectName(project) : '選択したプロジェクト';
    if (!confirm(`重複タスク${taskIds.length}件を「${projectName}」へまとめて紐付けます。\nよろしいですか？`)) return;
  }
  taskIds.forEach(taskId => {
    DB.Tasks.update(taskId, {
      projectId,
      phaseId: null,
      sourceProjectName: '',
      needsProjectReview: false,
    });
  });
  const message = taskIds.length > 1
    ? `重複タスク${taskIds.length}件を正式プロジェクトへ紐付けました`
    : 'タスクを正式プロジェクトへ紐付けました';
  await saveCleanupAndRefresh(message);
}

async function deleteCleanupTasks(taskIdsText) {
  const taskIds = String(taskIdsText || '').split(',').map(id => id.trim()).filter(Boolean);
  const tasks = taskIds.map(id => DB.Tasks.get(id)).filter(Boolean);
  if (!tasks.length) {
    showToast('削除するタスクが見つかりません', 'error');
    return;
  }
  if (!confirm(`${tasks.length}件の残タスクを削除します。\nこの操作は元に戻せません。よろしいですか？`)) return;
  taskIds.forEach(taskId => DB.Tasks.remove(taskId));
  DB.Asks.removeByProjectOrTasks?.('', taskIds);
  await saveCleanupAndRefresh('削除済みプロジェクトの残タスクを削除しました');
}

async function mergeCleanupDuplicateTasks(taskIdsText, keepTaskId) {
  const taskIds = String(taskIdsText || '').split(',').map(id => id.trim()).filter(Boolean);
  const tasks = taskIds.map(id => DB.Tasks.get(id)).filter(Boolean);
  const keepTask = DB.Tasks.get(keepTaskId);
  if (!tasks.length || !keepTask) {
    showToast('統合するタスクが見つかりません', 'error');
    return;
  }
  if (tasks.length < 2) {
    showToast('統合対象が1件だけです', 'info');
    return;
  }
  const dates = tasks.map(task => task.originalDate || taskDisplayDateValue(task)).filter(Boolean).sort();
  const originalDate = dates[0] || keepTask.originalDate || taskDisplayDateValue(keepTask) || '';
  const openTasks = tasks.filter(task => task.completed !== true);
  const latestOpen = openTasks
    .slice()
    .sort((a, b) => String(taskDisplayDateValue(b)).localeCompare(String(taskDisplayDateValue(a))))[0];
  const target = latestOpen || keepTask;
  const doneCount = tasks.filter(task => task.completed === true).length;
  const openCount = tasks.length - doneCount;
  const warning = doneCount ? `\n完了済み ${doneCount}件、未完了 ${openCount}件が含まれています。` : '';
  if (!confirm(`${tasks.length}件の同じタスクを1件に統合します。${warning}\n残すタスク：${target.content || '未入力タスク'}\n日付：${target.date ? DB.fmtDate(target.date) : '未設定'}\nよろしいですか？`)) return;

  DB.Tasks.update(target.id, {
    date: target.completed === true ? target.date : DB.today(),
    originalDate,
    carriedFromTaskId: null,
    carriedOverToTaskId: null,
  });
  tasks
    .filter(task => task.id !== target.id)
    .forEach(task => DB.Tasks.update(task.id, {
      mergedIntoTaskId: target.id,
      mergedAt: new Date().toISOString(),
    }));

  await saveCleanupAndRefresh('重複タスクを1件に統合しました');
}

async function mergeCleanupProject(projectId) {
  const targetProjectId = document.getElementById(`cleanup-merge-${projectId}`)?.value;
  if (!targetProjectId) {
    showToast('統合先プロジェクトを選んでください', 'error');
    return;
  }
  if (projectId === targetProjectId) {
    showToast('同じプロジェクトには統合できません', 'error');
    return;
  }
  const fromProject = DB.Projects.get(projectId);
  const toProject = DB.Projects.get(targetProjectId);
  if (!fromProject || !toProject) return;
  if (!confirm(`${cleanupProjectName(fromProject)} の関連タスクを ${cleanupProjectName(toProject)} に移します。よろしいですか？`)) return;

  DB.Tasks.all()
    .filter(task => task.projectId === projectId)
    .forEach(task => DB.Tasks.update(task.id, {
      projectId: targetProjectId,
      phaseId: null,
      sourceProjectName: '',
      needsProjectReview: false,
    }));
  DB.Projects.archive(projectId);
  await saveCleanupAndRefresh('仮プロジェクトを正式プロジェクトへ統合しました');
}

async function mergeCleanupClient(encodedClientName, index) {
  const fromName = decodeURIComponent(encodedClientName);
  const toName = document.getElementById(`cleanup-client-target-${index}`)?.value?.trim();
  if (!toName) {
    showToast('統合先クライアントを選んでください', 'error');
    return;
  }
  if (fromName === toName) {
    showToast('同じクライアント名には統合できません', 'error');
    return;
  }
  const affected = DB.Projects.all().filter(project => (String(project.clientName || '').trim() || 'クライアント未設定') === fromName);
  if (!affected.length) {
    showToast('統合対象のプロジェクトが見つかりません', 'error');
    return;
  }
  if (!confirm(`${fromName} を ${toName} に統合します。\n対象プロジェクト：${affected.length}件\nよろしいですか？`)) return;
  affected.forEach(project => DB.Projects.update(project.id, { clientName: toName }));
  await saveCleanupAndRefresh('クライアント名を統合しました');
}

async function renameCleanupClient(encodedClientName, index) {
  const fromName = decodeURIComponent(encodedClientName);
  const toName = document.getElementById(`cleanup-client-rename-${index}`)?.value?.trim();
  if (!toName) {
    showToast('新しいクライアント名を入力してください', 'error');
    return;
  }
  if (fromName === toName) {
    showToast('同じ名前です', 'info');
    return;
  }
  const affected = DB.Projects.all().filter(project => (String(project.clientName || '').trim() || 'クライアント未設定') === fromName);
  if (!affected.length) {
    showToast('名称変更するプロジェクトが見つかりません', 'error');
    return;
  }
  if (!confirm(`${fromName} を ${toName} に名称変更します。\n対象プロジェクト：${affected.length}件\nよろしいですか？`)) return;
  affected.forEach(project => DB.Projects.update(project.id, { clientName: toName }));
  await saveCleanupAndRefresh('クライアント名を変更しました');
}

async function archiveCleanupProject(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  if (!confirm(`${cleanupProjectName(project)} をアーカイブします。関連タスクは削除されません。よろしいですか？`)) return;
  DB.Projects.archive(projectId);
  await saveCleanupAndRefresh('仮プロジェクトをアーカイブしました');
}

async function deleteEmptyCleanupProject(projectId) {
  const project = DB.Projects.get(projectId);
  if (!project) return;
  const relatedTasks = DB.Tasks.all().filter(task => task.projectId === projectId);
  if (relatedTasks.length) {
    showToast('紐付いたタスクがあるため削除できません。先にタスク確認または統合してください', 'error');
    return;
  }
  if (!confirm(`${cleanupProjectName(project)} は紐付いたタスクがありません。\n削除してよろしいですか？`)) return;
  DB.Projects.remove(projectId);
  await saveCleanupAndRefresh('空の仮プロジェクトを削除しました');
}

async function unlinkCleanupCarry(taskId, direction) {
  const patch = direction === 'from' ? { carriedFromTaskId: null } : { carriedOverToTaskId: null };
  DB.Tasks.update(taskId, patch);
  await saveCleanupAndRefresh('繰り越しリンクを解除しました');
}

async function completeCleanupCarryChild(taskId) {
  DB.Tasks.setCompletion(taskId, true, '');
  await saveCleanupAndRefresh('繰り越し先も完了にしました');
}

async function clearCleanupPhase(taskId) {
  DB.Tasks.update(taskId, { phaseId: null });
  await saveCleanupAndRefresh('存在しないフェーズの紐付けを解除しました');
}

function downloadDataBackup() {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    members: DB.Members.all(),
    projects: DB.Projects.all(),
    tasks: DB.Tasks.all(),
    asks: DB.Asks.all(),
    templates: DB.Templates.all(),
    chatworkImports: DB.ChatworkImports.all(),
    projectReviews: DB.ProjectReviews.all(),
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `taskboard-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ============================================================
   設定
   ============================================================ */
const MEMBER_COLORS = [
  '#6366f1','#a855f7','#ec4899','#ef4444','#f97316',
  '#f59e0b','#10b981','#06b6d4','#3b82f6','#84cc16',
];
let _selectedColor = MEMBER_COLORS[0];
let _settingsTab   = 'members'; // 'members' | 'templates' | 'appearance'

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
        <button class="btn ${_settingsTab==='appearance' ? 'btn-primary' : 'btn-ghost'}"
                onclick="_settingsTab='appearance';renderSettings()">表示設定</button>
      </div>
      ${_settingsTab === 'members'
        ? membersTabHTML(members)
        : _settingsTab === 'templates'
          ? templatesTabHTML(templates)
          : appearanceTabHTML()}
    </div>`;
}

function appearanceTabHTML() {
  const theme = getSavedTheme();
  return `
    <div class="card">
      <div class="card-title">画面モード</div>
      <p class="text-secondary" style="margin-bottom:14px">
        使う場所に合わせて、明るい表示と暗い表示を切り替えられます。
      </p>
      <div class="theme-choice-grid">
        <button class="theme-choice ${theme === 'dark' ? 'active' : ''}" onclick="setTheme('dark')">
          <span class="theme-preview dark"><span></span><span></span><span></span></span>
          <strong>ダークモード</strong>
          <small>今までの落ち着いた表示です。</small>
        </button>
        <button class="theme-choice ${theme === 'light' ? 'active' : ''}" onclick="setTheme('light')">
          <span class="theme-preview light"><span></span><span></span><span></span></span>
          <strong>ライトモード</strong>
          <small>明るい場所や画面共有で見やすい表示です。</small>
        </button>
      </div>
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
          `<span style="font-size:11px;padding:2px 8px;background:var(--bg-glass);border:1px solid var(--border);border-radius:4px;color:var(--text-2)">${i+1}.${escHtml(typeof ph === 'string' ? ph : ph.name)}</span>`
        ).join('<span style="color:var(--text-3);font-size:10px">›</span>');
        return `
          <div class="card" style="margin-bottom:8px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-weight:700;font-size:14px">${escHtml(t.name)}</span>
                ${t.tasks?.length ? `<span class="tag">${t.tasks.length}タスク</span>` : ''}
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
  const tasks = tpl?.tasks || [];

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
    <div class="form-group">
      <label class="form-label">標準タスク</label>
      <div class="form-help">担当の右は「営業日前」「遂行期間（日）」「工数」です。営業日前は納品日から何営業日前を締切にするか、遂行期間は開始日から締切日までの営業日数、工数は予定時間です。担当未設定の場合は、プロジェクトの窓口担当が入ります。</div>
      <div id="tpl-tasks-list" class="tpl-task-list">
        <div class="tpl-task-header" aria-hidden="true">
          <span>No.</span>
          <span>タスク名</span>
          <span>フェーズ</span>
          <span>種別</span>
          <span>担当</span>
          <span>営業日前</span>
          <span>遂行(日)</span>
          <span>工数</span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
        ${tasks.map((task, i) => tplTaskRow(task, i, phases)).join('')}
      </div>
      <button class="btn btn-ghost" style="width:100%;margin-top:6px"
              onclick="addTplTaskRow()">＋ 選択行の下に標準タスクを追加</button>
      <div class="form-help">行をクリックして選択すると、追加先になります。行を選択した状態でDeleteキーを押すと削除できます。</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${editId ? `saveTemplateEdit('${editId}')` : 'saveTemplateNew()'}">
        ${editId ? '更新する' : '作成する'}
      </button>
    </div>
  `, editId ? 'テンプレートを編集' : 'テンプレートを追加', { wide: true });
  refreshTplTaskPhaseOptions();
}

function tplPhaseRow(value, i) {
  const phaseName = typeof value === 'string' ? value : value?.name || '';
  return `
    <div class="tpl-phase-row" id="tpl-row-${i}">
      <span class="tpl-phase-number">${i+1}</span>
      <input class="form-input tpl-phase-input" placeholder="フェーズ名" value="${escHtml(phaseName)}" id="tpl-ph-${i}" oninput="refreshTplTaskPhaseOptions()">
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
    <input class="form-input tpl-phase-input" placeholder="フェーズ名" id="tf-dyn-ph-${_tplRowCount}" oninput="refreshTplTaskPhaseOptions()">
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
  refreshTplTaskPhaseOptions();
}

function getTemplatePhases() {
  return Array.from(document.querySelectorAll('#tpl-phases-list input'))
    .map(el => el.value.trim()).filter(Boolean);
}

function memberOptionsHTML(selectedId = '', includeEmpty = true) {
  return [
    includeEmpty ? `<option value="" ${!selectedId ? 'selected' : ''}>未設定</option>` : '',
    ...DB.Members.all().map(member =>
      `<option value="${member.id}" ${selectedId === member.id ? 'selected' : ''}>${escHtml(member.name)}</option>`),
  ].join('');
}

function templatePhaseOptionsHTML(selectedPhase = '', sourcePhases = getTemplatePhases()) {
  const phases = sourcePhases
    .map(phase => typeof phase === 'string' ? phase : phase?.name || '')
    .map(phase => String(phase || '').trim())
    .filter(Boolean);
  if (selectedPhase && !phases.includes(selectedPhase)) phases.push(selectedPhase);
  return [
    `<option value="" ${!selectedPhase ? 'selected' : ''}>フェーズなし</option>`,
    ...phases.map(phase =>
      `<option value="${escHtml(phase)}" ${selectedPhase === phase ? 'selected' : ''}>${escHtml(phase)}</option>`),
  ].join('');
}

function tplTaskRow(task = {}, i = 0, phases = getTemplatePhases()) {
  const phase = task.phase || (phases[0] ? (typeof phases[0] === 'string' ? phases[0] : phases[0].name) : '');
  const type = task.type || '作業';
  return `
    <div class="tpl-task-row" data-index="${i}" tabindex="0" onclick="selectTplTaskRow(this)" onkeydown="handleTplTaskRowKeydown(event)">
      <span class="tpl-task-number">${i + 1}</span>
      <input class="form-input tpl-task-content-edit" placeholder="タスク名" value="${escHtml(task.content || '')}">
      <select class="form-select tpl-task-phase-edit">${templatePhaseOptionsHTML(phase, phases)}</select>
      <select class="form-select tpl-task-type-edit">
        ${['作業','依頼','確認','待ち','修正','連絡','納品'].map(item =>
          `<option value="${item}" ${type === item ? 'selected' : ''}>${item}</option>`).join('')}
      </select>
      <select class="form-select tpl-task-member-edit">${memberOptionsHTML(task.defaultMemberId || '', true)}</select>
      <input type="number" class="form-input tpl-task-offset-edit" value="${Number(task.offset || 0)}" title="納品日からの営業日" aria-label="営業日前" placeholder="営業日前" step="1">
      <input type="number" class="form-input tpl-task-duration-edit" value="${Number(task.durationDays || 1)}" min="1" step="1" title="遂行期間（日）" aria-label="遂行期間（日）" placeholder="遂行">
      <input type="number" class="form-input tpl-task-hours-edit" value="${Number(task.hours || 1)}" min="0.25" step="0.25" title="工数" aria-label="工数" placeholder="工数">
      <button class="btn btn-ghost btn-sm btn-icon" onclick="insertTplTaskAfter(this);event.stopPropagation()" title="下に追加">＋</button>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="duplicateTplTaskRow(this);event.stopPropagation()" title="複製">⧉</button>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="moveTplTaskRow(this, -1)" title="上へ">↑</button>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="moveTplTaskRow(this, 1)" title="下へ">↓</button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="deleteTplTaskRow(this);event.stopPropagation()" title="削除">✕</button>
    </div>`;
}

let _tplTaskRowCount = 0;
function addTplTaskRow() {
  const list = document.getElementById('tpl-tasks-list');
  if (!list) return;
  const selected = getSelectedTplTaskRow();
  if (selected) {
    insertTplTaskAfter(selected);
    return;
  }
  _tplTaskRowCount++;
  const row = createTplTaskRowElement({}, list.querySelectorAll('.tpl-task-row').length);
  list.appendChild(row);
  selectTplTaskRow(row);
  renumberTplTasks();
}

function createTplTaskRowElement(task = {}, index = 0) {
  const div = document.createElement('div');
  div.innerHTML = tplTaskRow(task, index, getTemplatePhases());
  return div.firstElementChild;
}

function getSelectedTplTaskRow() {
  return document.querySelector('#tpl-tasks-list .tpl-task-row.selected');
}

function selectTplTaskRow(row) {
  if (!row) return;
  document.querySelectorAll('#tpl-tasks-list .tpl-task-row.selected').forEach(item => {
    if (item !== row) item.classList.remove('selected');
  });
  row.classList.add('selected');
}

function readTplTaskRow(row) {
  if (!row) return {};
  return {
    content: row.querySelector('.tpl-task-content-edit')?.value?.trim() || '',
    phase: row.querySelector('.tpl-task-phase-edit')?.value || '',
    type: row.querySelector('.tpl-task-type-edit')?.value || '作業',
    defaultMemberId: row.querySelector('.tpl-task-member-edit')?.value || '',
    offset: Number(row.querySelector('.tpl-task-offset-edit')?.value || 0) || 0,
    durationDays: Math.max(1, Number(row.querySelector('.tpl-task-duration-edit')?.value || 1) || 1),
    hours: Number(row.querySelector('.tpl-task-hours-edit')?.value || 1) || 1,
  };
}

function insertTplTaskAfter(target) {
  const row = target?.closest?.('.tpl-task-row') || target;
  const list = document.getElementById('tpl-tasks-list');
  if (!list) return;
  const newRow = createTplTaskRowElement({}, list.querySelectorAll('.tpl-task-row').length);
  if (row?.classList?.contains('tpl-task-row')) {
    row.after(newRow);
  } else {
    list.appendChild(newRow);
  }
  selectTplTaskRow(newRow);
  renumberTplTasks();
  newRow.querySelector('.tpl-task-content-edit')?.focus();
}

function duplicateTplTaskRow(button) {
  const row = button?.closest?.('.tpl-task-row');
  if (!row) return;
  const newRow = createTplTaskRowElement(readTplTaskRow(row), row.dataset.index || 0);
  row.after(newRow);
  selectTplTaskRow(newRow);
  renumberTplTasks();
  newRow.querySelector('.tpl-task-content-edit')?.focus();
}

function deleteTplTaskRow(target) {
  const row = target?.closest?.('.tpl-task-row') || target;
  if (!row?.classList?.contains('tpl-task-row')) return;
  const nextFocus = row.nextElementSibling?.classList?.contains('tpl-task-row')
    ? row.nextElementSibling
    : row.previousElementSibling?.classList?.contains('tpl-task-row')
    ? row.previousElementSibling
    : null;
  row.remove();
  if (nextFocus) {
    selectTplTaskRow(nextFocus);
    nextFocus.focus();
  }
  renumberTplTasks();
}

function handleTplTaskRowKeydown(event) {
  if (event.key !== 'Delete') return;
  const tag = event.target?.tagName;
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return;
  event.preventDefault();
  deleteTplTaskRow(event.currentTarget);
}

function moveTplTaskRow(button, direction) {
  const row = button.closest('.tpl-task-row');
  const list = document.getElementById('tpl-tasks-list');
  if (!row || !list) return;
  if (direction < 0 && row.previousElementSibling?.classList.contains('tpl-task-row')) {
    list.insertBefore(row, row.previousElementSibling);
  }
  if (direction > 0 && row.nextElementSibling) {
    list.insertBefore(row.nextElementSibling, row);
  }
  selectTplTaskRow(row);
  row.focus();
  renumberTplTasks();
}

function renumberTplTasks() {
  document.querySelectorAll('#tpl-tasks-list .tpl-task-row').forEach((row, i) => {
    const num = row.querySelector('.tpl-task-number');
    if (num) num.textContent = String(i + 1);
  });
}

function refreshTplTaskPhaseOptions() {
  document.querySelectorAll('#tpl-tasks-list .tpl-task-phase-edit').forEach(select => {
    const current = select.value;
    select.innerHTML = templatePhaseOptionsHTML(current);
  });
}

function getTemplateTasks() {
  return Array.from(document.querySelectorAll('#tpl-tasks-list .tpl-task-row'))
    .map(row => ({
      content: row.querySelector('.tpl-task-content-edit')?.value?.trim() || '',
      phase: row.querySelector('.tpl-task-phase-edit')?.value || '',
      type: row.querySelector('.tpl-task-type-edit')?.value || '作業',
      defaultMemberId: row.querySelector('.tpl-task-member-edit')?.value || '',
      offset: Number(row.querySelector('.tpl-task-offset-edit')?.value || 0) || 0,
      durationDays: Math.max(1, Number(row.querySelector('.tpl-task-duration-edit')?.value || 1) || 1),
      hours: Number(row.querySelector('.tpl-task-hours-edit')?.value || 1) || 1,
    }))
    .filter(task => task.content);
}

function saveTemplateNew() {
  const name = document.getElementById('tpl-name')?.value?.trim();
  if (!name) { showToast('テンプレート名を入力してください', 'error'); return; }
  DB.Templates.add({ name, phases: getTemplatePhases(), tasks: getTemplateTasks() });
  closeModal();
  showToast('テンプレートを作成しました', 'success');
  renderSettings();
}

function saveTemplateEdit(tplId) {
  const name = document.getElementById('tpl-name')?.value?.trim();
  if (!name) { showToast('テンプレート名を入力してください', 'error'); return; }
  DB.Templates.update(tplId, { name, phases: getTemplatePhases(), tasks: getTemplateTasks() });
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

function updateCloudSaveStatus(status = DB.getCloudStatus?.() || 'local') {
  const el = document.getElementById('cloud-save-status');
  if (!el) return;
  const labels = {
    loading: 'サーバー確認中',
    saving: 'サーバーへ保存中',
    saved: 'サーバー保存済み',
    error: 'サーバー保存待ち',
    local: 'この端末に保存',
  };
  el.dataset.status = status;
  el.textContent = labels[status] || labels.local;
  el.title = status === 'error'
    ? '通信が戻ると自動で再保存します。画面を閉じずにお待ちください。'
    : '';
}

window.addEventListener('taskboard:cloud-status', event => {
  updateCloudSaveStatus(event.detail?.status);
});

/* ============================================================
   アプリ初期化
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme();
  await DB.initStore();
  updateCloudSaveStatus();
  DB.seedDemoData();       // 初回のみデモデータを投入
  const carriedCount = DB.Tasks.carryOverOpenTasks();
  const compacted = DB.Tasks.compactCarryoverDuplicates?.() || { mergedCount: 0 };
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
    showToast(`${carriedCount}件の未完了タスクを今日のタスクへ移動しました`, 'info');
  }
  if (compacted.mergedCount > 0) {
    showToast(`${compacted.mergedCount}件の繰り越し履歴を同じタスクに統合しました`, 'info');
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
