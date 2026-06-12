/**
 * TaskBoard — data.js
 * データ管理・LocalStorage CRUD
 */

// ============================================================
// キー定数
// ============================================================
const KEYS = {
  MEMBERS:   'tb_members',
  PROJECTS:  'tb_projects',
  TASKS:     'tb_tasks',
  ASKS:      'tb_asks',
  TEMPLATES: 'tb_templates',
  CHATWORK_IMPORTS: 'tb_chatwork_imports',
  PROJECT_REVIEWS: 'tb_project_reviews',
  META:      'tb_meta',
};

const CLOUD_ROW_ID = 'main';
let cloudClient = null;
let cloudReady = false;
let cloudSaveTimer = null;

// ============================================================
// ユーティリティ
// ============================================================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function prevDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? null;
  } catch {
    return null;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  queueCloudSave();
}

function getCloudConfig() {
  return window.TASKBOARD_SUPABASE || {};
}

function isCloudConfigured() {
  const cfg = getCloudConfig();
  return Boolean(cfg.url && cfg.anonKey && window.supabase);
}

function getStoreSnapshot() {
  return {
    members: load(KEYS.MEMBERS) ?? [],
    projects: load(KEYS.PROJECTS) ?? [],
    tasks: load(KEYS.TASKS) ?? [],
    asks: load(KEYS.ASKS) ?? [],
    templates: load(KEYS.TEMPLATES) ?? [],
    chatworkImports: load(KEYS.CHATWORK_IMPORTS) ?? [],
    projectReviews: load(KEYS.PROJECT_REVIEWS) ?? [],
    meta: load(KEYS.META) ?? { lastDate: today() },
  };
}

function applyStoreSnapshot(data = {}) {
  saveLocalOnly(KEYS.MEMBERS, data.members ?? []);
  saveLocalOnly(KEYS.PROJECTS, data.projects ?? []);
  saveLocalOnly(KEYS.TASKS, data.tasks ?? []);
  saveLocalOnly(KEYS.ASKS, data.asks ?? []);
  saveLocalOnly(KEYS.TEMPLATES, data.templates ?? DEFAULT_TEMPLATES.map(t => ({ ...t, custom: false })));
  saveLocalOnly(KEYS.CHATWORK_IMPORTS, data.chatworkImports ?? []);
  saveLocalOnly(KEYS.PROJECT_REVIEWS, data.projectReviews ?? []);
  saveLocalOnly(KEYS.META, data.meta ?? { lastDate: today() });
}

function saveLocalOnly(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function initCloudStore() {
  if (!isCloudConfigured()) return false;

  const cfg = getCloudConfig();
  cloudClient = window.supabase.createClient(cfg.url, cfg.anonKey);

  const { data, error } = await cloudClient
    .from('taskboard_data')
    .select('data')
    .eq('id', CLOUD_ROW_ID)
    .single();

  if (error) {
    console.warn('Supabase load failed:', error.message);
    return false;
  }

  applyStoreSnapshot(data?.data);
  cloudReady = true;
  return true;
}

function queueCloudSave() {
  if (!cloudReady || !cloudClient) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(syncCloudStore, 350);
}

async function syncCloudStore() {
  if (!cloudReady || !cloudClient) return false;

  const { error } = await cloudClient
    .from('taskboard_data')
    .upsert({
      id: CLOUD_ROW_ID,
      data: getStoreSnapshot(),
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.warn('Supabase save failed:', error.message);
    return false;
  }
  return true;
}

async function reloadCloudStore() {
  if (!cloudReady || !cloudClient) return false;

  const { data, error } = await cloudClient
    .from('taskboard_data')
    .select('data')
    .eq('id', CLOUD_ROW_ID)
    .single();

  if (error) {
    console.warn('Supabase reload failed:', error.message);
    return false;
  }

  applyStoreSnapshot(data?.data);
  return true;
}

// 日付フォーマット（表示用）
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
}

// 残り日数
function daysLeft(dateStr) {
  if (!dateStr) return null;
  const now = new Date(today() + 'T00:00:00');
  const end = new Date(dateStr  + 'T00:00:00');
  return Math.ceil((end - now) / 86400000);
}

// ============================================================
// 初期テンプレートデータ
// ============================================================
const DEFAULT_TEMPLATES = [
  { id: 'tpl_pamphlet',    name: 'パンフレット・冊子',  phases: ['企画','取材・原稿','デザイン','校正','入稿','納品'] },
  { id: 'tpl_website_new', name: 'Webサイト制作',       phases: ['企画','ワイヤー','デザイン','コーディング','テスト','公開'] },
  { id: 'tpl_website_upd', name: 'Webサイト更新',       phases: ['依頼確認','原稿・素材収集','修正・制作','確認','公開'] },
  { id: 'tpl_proposal',    name: '提案書作成',           phases: ['情報収集','構成','制作','確認','提出'] },
  { id: 'tpl_video',       name: '動画制作',             phases: ['企画','撮影','編集','確認','納品'] },
  { id: 'tpl_sns',         name: 'SNS投稿',              phases: ['企画','素材制作','原稿作成','確認','投稿'] },
  { id: 'tpl_event',       name: 'イベント実施',         phases: ['企画','告知・集客','準備','当日運営','レポート'] },
  { id: 'tpl_simple',      name: 'シンプル',             phases: ['準備','制作','納品'] },
  { id: 'tpl_blank',       name: 'ブランク',             phases: [] },
];

// ============================================================
// 初期化
// ============================================================
async function initStore() {
  await initCloudStore();

  if (!load(KEYS.TEMPLATES)) {
    save(KEYS.TEMPLATES, DEFAULT_TEMPLATES.map(t => ({ ...t, custom: false })));
  }
  if (!load(KEYS.MEMBERS))  save(KEYS.MEMBERS,  []);
  if (!load(KEYS.PROJECTS)) save(KEYS.PROJECTS, []);
  if (!load(KEYS.TASKS))    save(KEYS.TASKS,    []);
  if (!load(KEYS.ASKS))     save(KEYS.ASKS,     []);
  if (!load(KEYS.CHATWORK_IMPORTS)) save(KEYS.CHATWORK_IMPORTS, []);
  if (!load(KEYS.PROJECT_REVIEWS)) save(KEYS.PROJECT_REVIEWS, []);
  if (!load(KEYS.META))     save(KEYS.META,     { lastDate: today() });
}

// ============================================================
// デモデータ（初回のみ投入）
// ============================================================
function seedDemoData() {
  // メンバーが0件の場合のみ投入
  if (load(KEYS.MEMBERS)?.length > 0) return;

  const memberColors = ['#6366f1', '#a855f7', '#ec4899', '#10b981', '#f59e0b'];
  const memberNames  = ['田中 健太', '佐藤 美咲', '鈴木 翔', '高橋 えみ'];
  const memberIds    = memberNames.map((name, i) => {
    const m = Members.add({ name, color: memberColors[i] });
    return m.id;
  });

  // サンプルプロジェクト①
  const p1 = Projects.add({
    clientName: '〇〇株式会社',
    name: '会社案内パンフレット制作',
    deliveryDate: (() => {
      const d = new Date(); d.setDate(d.getDate() + 18);
      return d.toISOString().slice(0, 10);
    })(),
    budget: '480000',
    leadSource: 'website_inquiry',
    leadSourceDetail: '自社HPの問い合わせフォーム',
    templateId: 'tpl_pamphlet',
  });
  // フェーズを進行中状態に更新
  if (p1.phases.length >= 3) {
    const updPhases = p1.phases.map((ph, i) => ({
      ...ph,
      status: i < 2 ? 'done' : i === 2 ? 'active' : 'pending',
    }));
    Projects.updatePhases(p1.id, updPhases);
    const refreshed = Projects.get(p1.id);

    // タスクを追加（デザインフェーズ）
    const designPhase = refreshed.phases[2];
    if (designPhase) {
      Tasks.add({ memberId: memberIds[0], projectId: p1.id, phaseId: designPhase.id, content: 'トップページレイアウト作成', estimatedHours: 3, date: today() });
      Tasks.add({ memberId: memberIds[1], projectId: p1.id, phaseId: designPhase.id, content: '写真セレクト・トリミング', estimatedHours: 1, date: today() });
      Tasks.add({ memberId: memberIds[0], projectId: p1.id, phaseId: designPhase.id, content: '図版・アイコン制作', estimatedHours: 2, date: today() });

      // 前日の完了済みタスク
      Tasks.add({ memberId: memberIds[0], projectId: p1.id, phaseId: designPhase.id, content: 'デザイン方針の確定・クライアント確認', estimatedHours: 1.5, date: yesterday() });
      Tasks.add({ memberId: memberIds[1], projectId: p1.id, phaseId: designPhase.id, content: '素材整理・フォルダ構成', estimatedHours: 1, date: yesterday() });
    }
  }

  // サンプルプロジェクト②
  const p2 = Projects.add({
    clientName: '△△商事',
    name: 'コーポレートサイト更新',
    deliveryDate: (() => {
      const d = new Date(); d.setDate(d.getDate() + 5);
      return d.toISOString().slice(0, 10);
    })(),
    budget: '120000',
    leadSource: 'repeat_client',
    leadSourceDetail: '既存クライアントからの追加依頼',
    templateId: 'tpl_website_upd',
  });
  if (p2.phases.length >= 3) {
    const updPhases2 = p2.phases.map((ph, i) => ({
      ...ph,
      status: i < 1 ? 'done' : i === 1 ? 'active' : 'pending',
    }));
    Projects.updatePhases(p2.id, updPhases2);
    const refreshed2 = Projects.get(p2.id);
    const activePhase2 = refreshed2.phases[1];
    if (activePhase2) {
      Tasks.add({ memberId: memberIds[2], projectId: p2.id, phaseId: activePhase2.id, content: '更新テキストの原稿確認・修正', estimatedHours: 1.5, date: today() });
      Tasks.add({ memberId: memberIds[2], projectId: p2.id, phaseId: activePhase2.id, content: '画像差し替え対応', estimatedHours: 1, date: yesterday() });
    }
  }

  // 前日タスクに完了ステータスを設定
  const yTasks = Tasks.yesterdayTasks();
  yTasks.forEach((t, i) => {
    if (i === 0) Tasks.setCompletion(t.id, true);
    else if (i === 1) Tasks.setCompletion(t.id, true);
    else if (i === 2) Tasks.setCompletion(t.id, false, '素材の最終確認待ちのため');
  });
}

// ============================================================
// メンバー
// ============================================================
const Members = {
  all()  { return load(KEYS.MEMBERS) ?? []; },
  add({ name, color, chatworkAccountId = '' }) {
    const list = this.all();
    const member = { id: genId(), name, color: color ?? '#6366f1', chatworkAccountId, createdAt: today() };
    list.push(member);
    save(KEYS.MEMBERS, list);
    return member;
  },
  update(id, patch) {
    save(KEYS.MEMBERS, this.all().map(m => m.id === id ? { ...m, ...patch } : m));
  },
  remove(id) {
    save(KEYS.MEMBERS, this.all().filter(m => m.id !== id));
  },
  get(id) { return this.all().find(m => m.id === id) ?? null; },
};

// ============================================================
// プロジェクト
// ============================================================
const Projects = {
  all()      { return load(KEYS.PROJECTS) ?? []; },
  active()   { return this.all().filter(p => !p.archived && p.projectStatus !== 'completed'); },
  completed(){ return this.all().filter(p => !p.archived && p.projectStatus === 'completed'); },
  archived() { return this.all().filter(p =>  p.archived); },

  add({
    clientName, name, deliveryDate = '', budget = '', templateId = '',
    projectType = 'standard', recurringSeries = '', ownerMemberId = '',
    createdByMemberId = '',
    dealCategory = 'existing', startDate = '',
    leadSource = '', leadSourceDetail = '',
    isProvisional = false, detailsDueAt = '', projectStatus = 'active', note = '',
  }) {
    const list = this.all();
    const phases = buildPhasesFromTemplate(templateId);
    const project = {
      id: genId(), clientName, name, deliveryDate, budget,
      projectType, recurringSeries, ownerMemberId, createdByMemberId, dealCategory, startDate,
      leadSource, leadSourceDetail,
      isProvisional, detailsDueAt,
      projectStatus, note,
      archived: false, createdAt: today(), phases,
    };
    list.push(project);
    save(KEYS.PROJECTS, list);
    return project;
  },
  update(id, patch) {
    save(KEYS.PROJECTS, this.all().map(p => p.id === id ? { ...p, ...patch } : p));
  },
  updatePhases(projectId, phases) {
    this.update(projectId, { phases });
  },
  archive(id)  { this.update(id, { archived: true  }); },
  restore(id)  { this.update(id, { archived: false }); },
  remove(id)   {
    save(KEYS.PROJECTS, this.all().filter(p => p.id !== id));
  },
  get(id) { return this.all().find(p => p.id === id) ?? null; },
};

// ============================================================
// タスク
// ============================================================
const Tasks = {
  all()            { return (load(KEYS.TASKS) ?? []).filter(t => !t.mergedIntoTaskId); },
  allIncludingMerged() { return load(KEYS.TASKS) ?? []; },
  byDate(date)     { return this.all().filter(t => t.date === date); },
  byDateRange(startDate, endDate) {
    const start = startDate || today();
    const end = endDate || start;
    const from = start <= end ? start : end;
    const to = start <= end ? end : start;
    return this.all().filter(t => {
      const taskDate = t.date || '';
      const originalDate = t.originalDate || '';
      return (taskDate >= from && taskDate <= to) ||
        (originalDate >= from && originalDate <= to);
    });
  },
  todayTasks()     { return this.byDate(today()).filter(t => t.completed !== true); },
  yesterdayTasks() { return this.byDate(yesterday()); },

  add({
    memberId, projectId = null, phaseId = null, content, estimatedHours,
    note = '', date = today(), carriedFromTaskId = null,
    sourceProjectName = '', needsProjectReview = false,
  }) {
    const list = this.all();
    const task = {
      id: genId(), date, memberId, projectId, phaseId,
      content, estimatedHours: parseFloat(estimatedHours),
      note,
      sourceProjectName,
      needsProjectReview,
      carriedFromTaskId,
      carriedOverToTaskId: null,
      completed: null,        // null=未確認, true=完了, false=未完了
      incompleteReason: '',
      createdAt: new Date().toISOString(),
    };
    list.push(task);
    save(KEYS.TASKS, list);
    return task;
  },
  update(id, patch) {
    save(KEYS.TASKS, this.allIncludingMerged().map(t => t.id === id ? { ...t, ...patch } : t));
  },
  replaceAll(list) {
    save(KEYS.TASKS, Array.isArray(list) ? list : []);
  },
  remove(id) {
    save(KEYS.TASKS, this.allIncludingMerged().filter(t => t.id !== id));
  },
  setCompletion(id, completed, reason = '') {
    const list = this.all();
    const target = list.find(t => t.id === id);
    if (!target) return;

    const targetIds = new Set([id]);
    if (completed === true) {
      let current = target;
      const seen = new Set();
      while (current?.carriedFromTaskId && !seen.has(current.id)) {
        seen.add(current.id);
        targetIds.add(current.carriedFromTaskId);
        current = list.find(t => t.id === current.carriedFromTaskId);
      }

      const addDescendants = (parentId) => {
        list
          .filter(t => t.carriedFromTaskId === parentId)
          .forEach(child => {
            if (targetIds.has(child.id)) return;
            targetIds.add(child.id);
            addDescendants(child.id);
          });
      };
      addDescendants(id);
    }

    save(KEYS.TASKS, list.map(t =>
      targetIds.has(t.id) ? { ...t, completed, incompleteReason: reason } : t
    ));
  },
  get(id) { return this.all().find(t => t.id === id) ?? null; },

  carryOverTask(taskId, targetDate = today()) {
    const source = this.get(taskId);
    if (!source || source.completed === true || source.date >= targetDate) return null;
    const originDate = source.originalDate || source.date;
    this.update(source.id, {
      date: targetDate,
      originalDate: originDate,
      carriedFromTaskId: null,
      carriedOverToTaskId: null,
    });
    return this.get(source.id);
  },

  carryOverOpenTasks(targetDate = today()) {
    const candidates = this.all().filter(t =>
      t.date < targetDate &&
      t.completed !== true
    );
    let count = 0;
    candidates.forEach(t => {
      if (this.carryOverTask(t.id, targetDate)) count++;
    });
    return count;
  },

  /** 指定プロジェクト・フェーズのタスク完了率 */
  progressByPhase(projectId, phaseId) {
    const tasks = this.all().filter(t => t.projectId === projectId && t.phaseId === phaseId);
    if (!tasks.length) return null;
    return { total: tasks.length, done: tasks.filter(t => t.completed === true).length };
  },

  /** メンバーの連続未完了日数（修正版：複数タスク対応） */
  consecutiveIncompleteDays(memberId) {
    // 日付ごとにタスクをグループ化
    const byDate = {};
    this.all()
      .filter(t => t.memberId === memberId && t.completed !== null)
      .forEach(t => {
        if (!byDate[t.date]) byDate[t.date] = [];
        byDate[t.date].push(t);
      });

    let days = 0;
    let cursor = yesterday();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const dayTasks = byDate[cursor];
      if (!dayTasks || dayTasks.length === 0) break;
      const allIncomplete = dayTasks.every(t => t.completed === false);
      if (allIncomplete) {
        days++;
        cursor = prevDay(cursor);
      } else {
        break;
      }
    }
    return days;
  },
};

// ============================================================
// 確認・お願い
// ============================================================
const Asks = {
  all() { return load(KEYS.ASKS) ?? []; },
  add({
    type = '質問', fromMemberId = '', toMemberId = '', toName = '',
    content, projectId = null, projectName = '', dueText = '', status = 'open',
    date = today(), taskId = null,
  }) {
    const list = this.all();
    const ask = {
      id: genId(),
      type,
      fromMemberId,
      toMemberId,
      toName,
      content,
      projectId,
      projectName,
      taskId,
      dueText,
      status,
      date,
      createdAt: new Date().toISOString(),
    };
    list.push(ask);
    save(KEYS.ASKS, list);
    return ask;
  },
  update(id, patch) {
    save(KEYS.ASKS, this.all().map(a => a.id === id ? { ...a, ...patch } : a));
  },
  remove(id) {
    save(KEYS.ASKS, this.all().filter(a => a.id !== id));
  },
  byMember(memberId) {
    return this.all().filter(a => a.toMemberId === memberId || a.toName === '全員');
  },
  fromMember(memberId) {
    return this.all().filter(a => a.fromMemberId === memberId);
  },
  get(id) { return this.all().find(a => a.id === id) ?? null; },
};

// ============================================================
// Chatwork取り込み履歴
// ============================================================
const ChatworkImports = {
  all() { return load(KEYS.CHATWORK_IMPORTS) ?? []; },
  key(roomId, messageId) { return `${roomId}:${messageId}`; },
  has(roomId, messageId) {
    const key = this.key(roomId, messageId);
    return this.all().some(item => item.key === key);
  },
  add({ roomId, messageId, accountName = '', taskCount = 0, askCount = 0 }) {
    if (!roomId || !messageId || this.has(roomId, messageId)) return null;
    const list = this.all();
    const item = {
      key: this.key(roomId, messageId),
      roomId: String(roomId),
      messageId: String(messageId),
      accountName,
      taskCount,
      askCount,
      importedAt: new Date().toISOString(),
    };
    list.push(item);
    save(KEYS.CHATWORK_IMPORTS, list.slice(-1000));
    return item;
  },
};

// ============================================================
// プロジェクト確認待ち
// ============================================================
const ProjectReviews = {
  all() { return load(KEYS.PROJECT_REVIEWS) ?? []; },
  add({ roomId = '', messageId = '', accountName = '', memberId = '', groups = [] }) {
    if (!groups.length) return null;
    const list = this.all();
    const review = {
      id: genId(),
      roomId: String(roomId || ''),
      messageId: String(messageId || ''),
      accountName,
      memberId,
      groups,
      status: 'open',
      createdAt: new Date().toISOString(),
      resolvedAt: '',
    };
    list.push(review);
    save(KEYS.PROJECT_REVIEWS, list.slice(-500));
    return review;
  },
  update(id, patch) {
    save(KEYS.PROJECT_REVIEWS, this.all().map(r => r.id === id ? { ...r, ...patch } : r));
  },
  get(id) { return this.all().find(r => r.id === id) ?? null; },
};

// ============================================================
// テンプレート
// ============================================================
const Templates = {
  all() { return load(KEYS.TEMPLATES) ?? []; },
  add({ name, phases }) {
    const list = this.all();
    const tpl = { id: genId(), name, phases, custom: true };
    list.push(tpl);
    save(KEYS.TEMPLATES, list);
    return tpl;
  },
  update(id, patch) {
    save(KEYS.TEMPLATES, this.all().map(t => t.id === id ? { ...t, ...patch } : t));
  },
  remove(id) {
    save(KEYS.TEMPLATES, this.all().filter(t => t.id !== id));
  },
  get(id) { return this.all().find(t => t.id === id) ?? null; },
};

// ============================================================
// ヘルパー
// ============================================================
function buildPhasesFromTemplate(templateId) {
  const tpl = Templates.get(templateId);
  if (!tpl) return [];
  return tpl.phases.map((name, i) => ({
    id: genId(),
    name,
    status: i === 0 ? 'active' : 'pending',
    startDate: '',
    dueDate: '',
    order: i,
  }));
}

// ============================================================
// エクスポート（グローバル）
// ============================================================
window.DB = {
  Members, Projects, Tasks, Asks, ChatworkImports, ProjectReviews, Templates,
  today, yesterday, prevDay, fmtDate, daysLeft, genId,
  initStore, seedDemoData, syncCloudStore, reloadCloudStore,
};
