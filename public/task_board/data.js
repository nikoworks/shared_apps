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
const CLOUD_PENDING_KEY = 'tb_cloud_pending';
let cloudClient = null;
let cloudReady = false;
let cloudSaveTimer = null;
let cloudRetryTimer = null;
let cloudSyncPromise = null;
let cloudDirty = false;
let cloudStatus = 'local';

// ============================================================
// ユーティリティ
// ============================================================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toLocalISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function today() {
  return toLocalISODate();
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toLocalISODate(d);
}

function prevDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return toLocalISODate(d);
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
  localStorage.setItem(CLOUD_PENDING_KEY, '1');
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

function setCloudStatus(status, detail = '') {
  cloudStatus = status;
  window.dispatchEvent(new CustomEvent('taskboard:cloud-status', {
    detail: { status, detail },
  }));
}

function getCloudStatus() {
  return cloudStatus;
}

async function initCloudStore() {
  if (!isCloudConfigured()) {
    setCloudStatus('local');
    return false;
  }

  const cfg = getCloudConfig();
  cloudClient = window.supabase.createClient(cfg.url, cfg.anonKey);
  cloudReady = true;
  setCloudStatus('loading');

  const { data, error } = await cloudClient
    .from('taskboard_data')
    .select('data')
    .eq('id', CLOUD_ROW_ID)
    .maybeSingle();

  if (error) {
    console.warn('Supabase load failed:', error.message);
    setCloudStatus('error', error.message);
    scheduleCloudRetry();
    return false;
  }

  const hasPendingLocalChanges = localStorage.getItem(CLOUD_PENDING_KEY) === '1';
  if (hasPendingLocalChanges) {
    const ok = await syncCloudStore();
    if (!ok) scheduleCloudRetry();
    return ok;
  }

  if (data?.data) {
    applyStoreSnapshot(data.data);
    setCloudStatus('saved');
  } else {
    localStorage.setItem(CLOUD_PENDING_KEY, '1');
    const ok = await syncCloudStore();
    if (!ok) scheduleCloudRetry();
    return ok;
  }
  return true;
}

function queueCloudSave() {
  if (!cloudReady || !cloudClient) return;
  cloudDirty = true;
  setCloudStatus('saving');
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(syncCloudStore, 80);
}

async function syncCloudStore() {
  if (!cloudReady || !cloudClient) return false;
  cloudDirty = true;
  clearTimeout(cloudSaveTimer);
  clearTimeout(cloudRetryTimer);
  cloudRetryTimer = null;

  if (cloudSyncPromise) {
    await cloudSyncPromise;
    if (cloudDirty) return syncCloudStore();
    return cloudStatus === 'saved';
  }

  cloudSyncPromise = (async () => {
    while (cloudDirty) {
      cloudDirty = false;
      setCloudStatus('saving');
      const writeId = `${Date.now()}-${genId()}`;
      const snapshot = {
        ...getStoreSnapshot(),
        _sync: { writeId, savedAt: new Date().toISOString() },
      };

      const { data, error } = await cloudClient
        .from('taskboard_data')
        .upsert({
          id: CLOUD_ROW_ID,
          data: snapshot,
          updated_at: snapshot._sync.savedAt,
        })
        .select('data')
        .single();

      if (error || data?.data?._sync?.writeId !== writeId) {
        const message = error?.message || '保存内容をサーバーで確認できませんでした';
        console.warn('Supabase save failed:', message);
        cloudDirty = true;
        setCloudStatus('error', message);
        scheduleCloudRetry();
        return false;
      }
    }

    localStorage.removeItem(CLOUD_PENDING_KEY);
    setCloudStatus('saved');
    return true;
  })();

  try {
    return await cloudSyncPromise;
  } finally {
    cloudSyncPromise = null;
  }
}

function scheduleCloudRetry() {
  if (!cloudReady || !cloudClient || cloudRetryTimer) return;
  cloudRetryTimer = setTimeout(() => {
    cloudRetryTimer = null;
    syncCloudStore();
  }, 5000);
}

async function reloadCloudStore() {
  if (!cloudReady || !cloudClient) return false;
  if (localStorage.getItem(CLOUD_PENDING_KEY) === '1' || cloudDirty || cloudSyncPromise) {
    const saved = await syncCloudStore();
    if (!saved) return false;
  }

  const { data, error } = await cloudClient
    .from('taskboard_data')
    .select('data')
    .eq('id', CLOUD_ROW_ID)
    .single();

  if (error) {
    console.warn('Supabase reload failed:', error.message);
    setCloudStatus('error', error.message);
    return false;
  }

  applyStoreSnapshot(data?.data);
  setCloudStatus('saved');
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
  {
    id: 'tpl_present_campaign',
    name: 'プレゼントキャンペーン更新',
    category: 'production',
    phases: ['事前準備','制作・設定','公開前最終準備','公開作業','キャンペーン実施中'],
    tasks: [
      { phase: '事前準備', content: 'プレゼント候補のリストアップ', type: '作業', offset: -55, hours: 1 },
      { phase: '事前準備', content: '数値分析に基づく候補追加・削除', type: '作業', offset: -45, hours: 1 },
      { phase: '事前準備', content: '商品説明の作成', type: '作業', offset: -40, hours: 1 },
      { phase: '事前準備', content: 'クライアント確認・商品提供の相談', type: '確認', offset: -40, hours: 1 },
      { phase: '事前準備', content: 'LP構成作成', type: '作業', offset: -40, hours: 2 },
      { phase: '事前準備', content: 'チャットボット離脱防止モーダル作成', type: '作業', offset: -35, hours: 1 },
      { phase: '制作・設定', content: 'LP制作依頼', type: '依頼', offset: -35, hours: 1 },
      { phase: '制作・設定', content: '抽選プレゼント・全員プレゼントのコンパネ登録', type: '作業', offset: -25, hours: 1 },
      { phase: '制作・設定', content: '応募完了ページを新規作成', type: '作業', offset: -25, hours: 1 },
      { phase: '制作・設定', content: '応募完了ページ更新内容確認', type: '確認', offset: -22, hours: 1 },
      { phase: '制作・設定', content: '応募者への自動配信メール作成・設定', type: '作業', offset: -22, hours: 1 },
      { phase: '制作・設定', content: '公式用バナー制作', type: '依頼', offset: -20, hours: 1 },
      { phase: '制作・設定', content: '広告バナー制作依頼', type: '依頼', offset: -20, hours: 1 },
      { phase: '制作・設定', content: '広告テキスト作成', type: '作業', offset: -18, hours: 1 },
      { phase: '公開前最終準備', content: 'Googleタグマネージャー計測設定', type: '作業', offset: -7, hours: 1 },
      { phase: '公開前最終準備', content: 'ミエルカヒートマップにURL登録', type: '作業', offset: -7, hours: 1 },
      { phase: '公開前最終準備', content: 'テスト応募', type: '確認', offset: -5, hours: 1 },
      { phase: '公開前最終準備', content: '広告配信依頼', type: '依頼', offset: -3, hours: 1 },
      { phase: '公開前最終準備', content: 'スマホバー設定', type: '作業', offset: -3, hours: 1 },
      { phase: '公開前最終準備', content: 'ポップアップ設定', type: '作業', offset: -3, hours: 1 },
      { phase: '公開作業', content: 'ビルド', type: '作業', offset: -1, hours: 1 },
      { phase: '公開作業', content: '公式TOP更新', type: '作業', offset: 0, hours: 1 },
      { phase: '公開作業', content: 'マイページ更新', type: '作業', offset: 0, hours: 1 },
      { phase: '公開作業', content: 'その他更新', type: '作業', offset: 0, hours: 1 },
      { phase: 'キャンペーン実施中', content: '広告バナー改善', type: '作業', offset: 5, hours: 1 },
      { phase: 'キャンペーン実施中', content: '数値確認', type: '確認', offset: 5, hours: 1 },
      { phase: 'キャンペーン実施中', content: '必要に応じてLP・広告調整', type: '作業', offset: 10, hours: 1 },
    ],
  },
  {
    id: 'tpl_ad_ops',
    name: '広告運用',
    category: 'production',
    phases: ['配信準備','入稿・設定','配信開始','効果確認','改善'],
    tasks: [
      { phase: '配信準備', content: '配信目的・ターゲット確認', type: '確認', offset: -15, hours: 1 },
      { phase: '配信準備', content: '広告文案作成', type: '作業', offset: -12, hours: 1 },
      { phase: '配信準備', content: '広告バナー制作依頼', type: '依頼', offset: -12, hours: 1 },
      { phase: '入稿・設定', content: '広告入稿・配信設定', type: '作業', offset: -5, hours: 1 },
      { phase: '入稿・設定', content: '計測設定確認', type: '確認', offset: -4, hours: 1 },
      { phase: '配信開始', content: '配信開始確認', type: '確認', offset: 0, hours: 1 },
      { phase: '効果確認', content: '初回数値確認', type: '確認', offset: 3, hours: 1 },
      { phase: '改善', content: '改善案整理・反映', type: '作業', offset: 7, hours: 1 },
    ],
  },
  {
    id: 'tpl_ad_creative',
    name: '広告バナー・クリエイティブ制作',
    category: 'production',
    phases: ['要件整理','制作依頼','初稿確認','修正','入稿'],
    tasks: [
      { phase: '要件整理', content: 'サイズ・訴求・入稿条件確認', type: '確認', offset: -12, hours: 1 },
      { phase: '要件整理', content: 'コピー・素材準備', type: '作業', offset: -10, hours: 1 },
      { phase: '制作依頼', content: 'デザイナーへ制作依頼', type: '依頼', offset: -8, hours: 1 },
      { phase: '初稿確認', content: '初稿確認', type: '確認', offset: -5, hours: 1 },
      { phase: '修正', content: '修正依頼・戻し反映確認', type: '修正', offset: -3, hours: 1 },
      { phase: '入稿', content: '入稿データ確認', type: '確認', offset: -1, hours: 1 },
    ],
  },
  {
    id: 'tpl_lp',
    name: 'LP制作',
    category: 'production',
    phases: ['要件整理','構成・原稿','デザイン','コーディング','確認・公開'],
    tasks: [
      { phase: '要件整理', content: '目的・ターゲット・導線確認', type: '確認', offset: -30, hours: 1 },
      { phase: '構成・原稿', content: 'LP構成作成', type: '作業', offset: -25, hours: 2 },
      { phase: '構成・原稿', content: '原稿・素材準備', type: '作業', offset: -22, hours: 2 },
      { phase: 'デザイン', content: 'デザイン制作依頼', type: '依頼', offset: -18, hours: 1 },
      { phase: 'デザイン', content: 'デザイン初稿確認', type: '確認', offset: -12, hours: 1 },
      { phase: 'コーディング', content: 'コーディング依頼', type: '依頼', offset: -10, hours: 1 },
      { phase: '確認・公開', content: '表示・フォーム動作確認', type: '確認', offset: -3, hours: 1 },
      { phase: '確認・公開', content: '公開作業', type: '作業', offset: 0, hours: 1 },
    ],
  },
  {
    id: 'tpl_website_upd',
    name: 'Web更新・保守',
    category: 'production',
    phases: ['依頼確認','原稿・素材収集','修正・制作','確認','公開'],
    tasks: [
      { phase: '依頼確認', content: '更新内容確認', type: '確認', offset: -7, hours: 1 },
      { phase: '原稿・素材収集', content: '原稿・素材確認', type: '確認', offset: -5, hours: 1 },
      { phase: '修正・制作', content: '修正作業', type: '作業', offset: -3, hours: 1 },
      { phase: '確認', content: '表示確認・先方確認依頼', type: '確認', offset: -1, hours: 1 },
      { phase: '公開', content: '公開・反映確認', type: '作業', offset: 0, hours: 1 },
    ],
  },
  {
    id: 'tpl_pamphlet',
    name: 'パンフレット・冊子制作',
    category: 'production',
    phases: ['要件整理','構成','原稿・素材','デザイン','校正','入稿・納品'],
    tasks: [
      { phase: '要件整理', content: '仕様・ページ数・納品形態確認', type: '確認', offset: -30, hours: 1 },
      { phase: '構成', content: 'ページ構成作成', type: '作業', offset: -25, hours: 2 },
      { phase: '原稿・素材', content: '原稿・素材準備', type: '作業', offset: -20, hours: 2 },
      { phase: 'デザイン', content: 'デザイン制作依頼', type: '依頼', offset: -15, hours: 1 },
      { phase: '校正', content: '初校確認・修正整理', type: '確認', offset: -8, hours: 1 },
      { phase: '校正', content: '最終校正', type: '確認', offset: -3, hours: 1 },
      { phase: '入稿・納品', content: '入稿データ確認・納品', type: '納品', offset: 0, hours: 1 },
    ],
  },
  {
    id: 'tpl_flyer',
    name: 'チラシ・ポスター制作',
    category: 'production',
    phases: ['要件整理','原稿・素材','デザイン','校正','入稿・納品'],
    tasks: [
      { phase: '要件整理', content: 'サイズ・用途・納品形態確認', type: '確認', offset: -15, hours: 1 },
      { phase: '原稿・素材', content: '原稿・素材準備', type: '作業', offset: -12, hours: 1 },
      { phase: 'デザイン', content: 'デザイン制作依頼', type: '依頼', offset: -10, hours: 1 },
      { phase: '校正', content: '初稿確認・修正整理', type: '確認', offset: -5, hours: 1 },
      { phase: '校正', content: '最終確認', type: '確認', offset: -2, hours: 1 },
      { phase: '入稿・納品', content: '入稿・納品', type: '納品', offset: 0, hours: 1 },
    ],
  },
  { id: 'tpl_website_new', name: 'Webサイト制作', category: 'production', phases: ['企画','ワイヤー','デザイン','コーディング','テスト','公開'], tasks: [] },
  { id: 'tpl_proposal', name: '提案書作成', category: 'sales', phases: ['情報収集','構成','制作','確認','提出'], tasks: [] },
  { id: 'tpl_blank', name: 'ブランク', category: 'basic', phases: [], tasks: [] },
];

// ============================================================
// 初期化
// ============================================================
async function initStore() {
  await initCloudStore();

  if (!load(KEYS.TEMPLATES)) {
    save(KEYS.TEMPLATES, DEFAULT_TEMPLATES.map(t => ({ ...t, custom: false })));
  } else {
    syncDefaultTemplates();
  }
  if (!load(KEYS.MEMBERS))  save(KEYS.MEMBERS,  []);
  if (!load(KEYS.PROJECTS)) save(KEYS.PROJECTS, []);
  if (!load(KEYS.TASKS))    save(KEYS.TASKS,    []);
  if (!load(KEYS.ASKS))     save(KEYS.ASKS,     []);
  if (!load(KEYS.CHATWORK_IMPORTS)) save(KEYS.CHATWORK_IMPORTS, []);
  if (!load(KEYS.PROJECT_REVIEWS)) save(KEYS.PROJECT_REVIEWS, []);
  if (!load(KEYS.META))     save(KEYS.META,     { lastDate: today() });
}

function syncDefaultTemplates() {
  const current = load(KEYS.TEMPLATES) ?? [];
  const defaults = DEFAULT_TEMPLATES.map(t => ({ ...t, custom: false }));
  const byId = new Map(current.map(t => [t.id, t]));
  let changed = false;
  defaults.forEach(tpl => {
    const existing = byId.get(tpl.id);
    if (!existing) {
      current.push(tpl);
      changed = true;
      return;
    }
    if (!existing.custom) {
      Object.assign(existing, tpl, { custom: false });
      changed = true;
    }
  });
  if (changed) save(KEYS.TEMPLATES, current);
}

// ============================================================
// デモデータ（初回のみ投入）
// ============================================================
function seedDemoData() {
  // クラウドの読み込み失敗中にサンプルデータを作ると、
  // 通信復旧後に本番データを上書きするため投入しない。
  if (isCloudConfigured() && cloudStatus === 'error') return;
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
    progressManagerMemberId = '', reviewerMemberIds = [], approvalMemberIds = [],
    reviewRule = 'all', reviewDueDays = 1, notifyProgressManager = true,
    leadSource = '', leadSourceDetail = '',
    isProvisional = false, detailsDueAt = '', projectStatus = 'active', note = '',
    scheduleAdjustments = [],
  }) {
    const list = this.all();
    const phases = buildPhasesFromTemplate(templateId);
    const project = {
      id: genId(), clientName, name, deliveryDate, budget,
      projectType, recurringSeries, ownerMemberId, createdByMemberId, dealCategory, startDate,
      progressManagerMemberId, reviewerMemberIds, approvalMemberIds,
      reviewRule, reviewDueDays, notifyProgressManager,
      leadSource, leadSourceDetail,
      isProvisional, detailsDueAt,
      projectStatus, note,
      scheduleAdjustments,
      archived: false, createdAt: today(), phases,
    };
    list.push(project);
    save(KEYS.PROJECTS, list);
    return project;
  },
  update(id, patch) {
    save(KEYS.PROJECTS, this.all().map(p => p.id === id ? { ...p, ...patch } : p));
  },
  replaceAll(list) {
    save(KEYS.PROJECTS, Array.isArray(list) ? list : []);
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
  dueDateOf(task) { return task?.dueDate || task?.date || ''; },
  displayDateOf(task) { return task?.displayDate || task?.date || task?.dueDate || ''; },
  byDate(date)     { return this.all().filter(t => this.displayDateOf(t) === date); },
  byDateRange(startDate, endDate) {
    const start = startDate || today();
    const end = endDate || start;
    const from = start <= end ? start : end;
    const to = start <= end ? end : start;
    return this.all().filter(t => {
      const taskDate = this.displayDateOf(t);
      const originalDate = t.originalDate || '';
      return (taskDate >= from && taskDate <= to) ||
        (originalDate >= from && originalDate <= to);
    });
  },
  todayTasks()     { return this.byDate(today()).filter(t => t.completed !== true); },
  yesterdayTasks() { return this.byDate(yesterday()); },

  add({
    memberId, projectId = null, phaseId = null, content, estimatedHours,
    durationDays = 1,
    note = '', date = today(), dueDate = '', displayDate = '', startDate = '',
    dueDateIsTemporary = false,
    carriedFromTaskId = null,
    sourceProjectName = '', needsProjectReview = false,
    taskType = '作業',
    parentTaskId = null, reviewTaskId = null, generatedByWorkflow = false,
    resultStatus = '', rejectionReason = '', holdReason = '', respondedAt = '',
    reservedReviewDueDate = '', scheduleAdjustedAt = '', scheduleAdjustmentReason = '',
    dependencyTaskIds = [], dependencyMode = 'all',
    reviewConfigMode = 'inherit', reviewerMemberIds = [], approvalMemberIds = [],
    reviewRule = 'inherit', reviewDueDays = null, notifyProgressManager = true,
    chatworkRoomId = '', chatworkMessageId = '',
  }) {
    const list = this.all();
    const resolvedDueDate = dueDate || date || today();
    const resolvedDisplayDate = displayDate || date || resolvedDueDate;
    const task = {
      id: genId(),
      date: resolvedDueDate, // 旧データ互換用。新しい画面では dueDate / displayDate を正本にする。
      dueDate: resolvedDueDate,
      displayDate: resolvedDisplayDate,
      dueDateIsTemporary: Boolean(dueDateIsTemporary),
      memberId, projectId, phaseId,
      startDate,
      content, estimatedHours: parseFloat(estimatedHours),
      durationDays: Math.max(1, parseInt(durationDays, 10) || 1),
      taskType,
      parentTaskId,
      reviewTaskId,
      generatedByWorkflow,
      resultStatus,
      rejectionReason,
      holdReason,
      respondedAt,
      reservedReviewDueDate,
      scheduleAdjustedAt,
      scheduleAdjustmentReason,
      dependencyTaskIds: Array.isArray(dependencyTaskIds) ? dependencyTaskIds : [],
      dependencyMode: dependencyMode === 'any' ? 'any' : 'all',
      reviewConfigMode,
      reviewerMemberIds,
      approvalMemberIds,
      reviewRule,
      reviewDueDays,
      notifyProgressManager,
      note,
      sourceProjectName,
      needsProjectReview,
      chatworkRoomId,
      chatworkMessageId,
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
  removeByProject(projectId) {
    const list = this.allIncludingMerged();
    const removedIds = list
      .filter(t => t.projectId === projectId)
      .map(t => t.id);
    save(KEYS.TASKS, list.filter(t => t.projectId !== projectId));
    return removedIds;
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
    const sourceDisplayDate = this.displayDateOf(source);
    if (!source || source.completed === true || sourceDisplayDate >= targetDate) return null;
    const originDate = source.originalDate || sourceDisplayDate;
    this.update(source.id, {
      displayDate: targetDate,
      originalDate: originDate,
      carriedFromTaskId: null,
      carriedOverToTaskId: null,
    });
    return this.get(source.id);
  },

  carryOverOpenTasks(targetDate = today()) {
    const candidates = this.all().filter(t =>
      this.displayDateOf(t) < targetDate &&
      t.completed !== true
    );
    let count = 0;
    candidates.forEach(t => {
      if (this.carryOverTask(t.id, targetDate)) count++;
    });
    return count;
  },

  compactCarryoverDuplicates() {
    const list = this.allIncludingMerged();
    const active = list.filter(t => !t.mergedIntoTaskId);
    const groups = new Map();

    active
      .filter(t => t.memberId && t.content)
      .forEach(task => {
        const source = String(task.sourceProjectName || '').trim().replace(/\s+/g, ' ');
        const content = String(task.content || '').trim().replace(/\s+/g, ' ');
        const key = [
          task.memberId || '',
          task.projectId || source || '',
          content,
          Number(task.estimatedHours) || 0,
        ].join('||');
        const group = groups.get(key) || [];
        group.push(task);
        groups.set(key, group);
      });

    let mergedCount = 0;
    let mergedGroupCount = 0;
    const now = new Date().toISOString();
    const updated = list.map(task => ({ ...task }));

    groups.forEach(group => {
      if (group.length < 2) return;
      const openTasks = group.filter(task => task.completed !== true);
      const candidates = openTasks.length ? openTasks : group;
      const target = candidates.slice().sort((a, b) => {
        const dateCompare = String(this.displayDateOf(b)).localeCompare(String(this.displayDateOf(a)));
        if (dateCompare) return dateCompare;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      })[0];
      if (!target) return;

      const dates = group
        .flatMap(task => [task.originalDate, this.displayDateOf(task)])
        .filter(Boolean)
        .sort();
      const originalDate = dates[0] || target.originalDate || this.displayDateOf(target) || '';
      const targetIndex = updated.findIndex(task => task.id === target.id);
      if (targetIndex >= 0) {
        updated[targetIndex] = {
          ...updated[targetIndex],
          originalDate,
          carriedFromTaskId: null,
          carriedOverToTaskId: null,
        };
      }

      let groupMergedCount = 0;
      group
        .filter(task => task.id !== target.id)
        .forEach(task => {
          const index = updated.findIndex(item => item.id === task.id);
          if (index < 0 || updated[index].mergedIntoTaskId) return;
          updated[index] = {
            ...updated[index],
            mergedIntoTaskId: target.id,
            mergedAt: now,
          };
          mergedCount++;
          groupMergedCount++;
        });

      if (groupMergedCount > 0) mergedGroupCount++;
    });

    if (mergedCount > 0) save(KEYS.TASKS, updated);
    return { mergedCount, groupCount: mergedGroupCount };
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
        const taskDate = this.displayDateOf(t);
        if (!byDate[taskDate]) byDate[taskDate] = [];
        byDate[taskDate].push(t);
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
  normalizeText(value = '') {
    return String(value || '').trim().replace(/\s+/g, ' ');
  },
  uniqueKey(ask = {}) {
    const projectKey = ask.projectId || this.normalizeText(ask.projectName || '');
    const targetKey = ask.taskId || [projectKey, this.normalizeText(ask.content || '')].join(':');
    return [
      ask.type || '',
      projectKey,
      targetKey,
      ask.toMemberId || this.normalizeText(ask.toName || '') || 'all',
      ask.fromMemberId || '',
    ].join('|');
  },
  add({
    type = '質問', fromMemberId = '', toMemberId = '', toName = '',
    content, projectId = null, projectName = '', dueDate = '', dueText = '', status = 'open',
    date = today(), taskId = null,
  }) {
    const list = this.all();
    const normalized = {
      type,
      fromMemberId,
      toMemberId,
      toName,
      content,
      projectId,
      projectName,
      taskId,
      dueDate: dueDate || (/^\d{4}-\d{2}-\d{2}$/.test(dueText) ? dueText : ''),
      dueText: dueText || dueDate,
      status,
      date,
    };
    const key = this.uniqueKey(normalized);
    const existing = status === 'open'
      ? list.find(a => a.status === 'open' && this.uniqueKey(a) === key)
      : null;
    if (existing) {
      const merged = {
        ...existing,
        content: normalized.content || existing.content,
        projectId: normalized.projectId || existing.projectId,
        projectName: normalized.projectName || existing.projectName,
        dueDate: normalized.dueDate || existing.dueDate,
        dueText: normalized.dueText || existing.dueText,
        date: [existing.date, normalized.date].filter(Boolean).sort()[0] || existing.date || normalized.date,
        updatedAt: new Date().toISOString(),
        duplicatePreventedAt: new Date().toISOString(),
      };
      save(KEYS.ASKS, list.map(a => a.id === existing.id ? merged : a));
      return { ...merged, _created: false, _duplicatePrevented: true };
    }
    const ask = {
      id: genId(),
      ...normalized,
      createdAt: new Date().toISOString(),
    };
    list.push(ask);
    save(KEYS.ASKS, list);
    return { ...ask, _created: true };
  },
  update(id, patch) {
    save(KEYS.ASKS, this.all().map(a => a.id === id ? { ...a, ...patch } : a));
  },
  replaceAll(list) {
    save(KEYS.ASKS, Array.isArray(list) ? list : []);
  },
  remove(id) {
    save(KEYS.ASKS, this.all().filter(a => a.id !== id));
  },
  removeByProjectOrTasks(projectId, taskIds = []) {
    const taskIdSet = new Set(taskIds);
    const list = this.all();
    const kept = list.filter(a => a.projectId !== projectId && !taskIdSet.has(a.taskId));
    save(KEYS.ASKS, kept);
    return list.length - kept.length;
  },
  byMember(memberId) {
    return this.all().filter(a => a.toMemberId === memberId || a.toName === '全員');
  },
  fromMember(memberId) {
    return this.all().filter(a => a.fromMemberId === memberId);
  },
  get(id) { return this.all().find(a => a.id === id) ?? null; },
  compactOpenDuplicates() {
    const list = this.all();
    const groups = new Map();
    list.forEach(ask => {
      if (ask.status !== 'open') return;
      const key = this.uniqueKey(ask);
      const group = groups.get(key) || [];
      group.push(ask);
      groups.set(key, group);
    });
    const removeIds = new Set();
    const replacements = new Map();
    groups.forEach(group => {
      if (group.length < 2) return;
      const sorted = [...group].sort((a, b) => {
        const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
        if (dateCompare !== 0) return dateCompare;
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
      const keep = sorted[0];
      const latest = sorted[sorted.length - 1];
      replacements.set(keep.id, {
        ...keep,
        content: latest.content || keep.content,
        dueDate: sorted.map(a => a.dueDate).filter(Boolean).sort()[0] || keep.dueDate || '',
        dueText: sorted.map(a => a.dueText).filter(Boolean).sort()[0] || keep.dueText || '',
        updatedAt: new Date().toISOString(),
        duplicateCompactedAt: new Date().toISOString(),
      });
      sorted.slice(1).forEach(ask => removeIds.add(ask.id));
    });
    if (!removeIds.size) return { removedCount: 0 };
    const next = list
      .filter(ask => !removeIds.has(ask.id))
      .map(ask => replacements.get(ask.id) || ask);
    save(KEYS.ASKS, next);
    return { removedCount: removeIds.size };
  },
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
  add({ name, phases, tasks = [] }) {
    const list = this.all();
    const tpl = { id: genId(), name, phases, tasks, custom: true };
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
    name: typeof name === 'string' ? name : name.name,
    status: i === 0 ? 'active' : 'pending',
    startDate: '',
    dueDate: '',
    reviewConfigMode: 'inherit',
    reviewerMemberIds: [],
    approvalMemberIds: [],
    reviewRule: 'inherit',
    reviewDueDays: null,
    requiredBeforeNextPhase: true,
    order: i,
  }));
}

// ============================================================
// エクスポート（グローバル）
// ============================================================
window.DB = {
  Members, Projects, Tasks, Asks, ChatworkImports, ProjectReviews, Templates,
  today, yesterday, prevDay, fmtDate, daysLeft, genId,
  initStore, seedDemoData, syncCloudStore, reloadCloudStore, getCloudStatus,
};

window.addEventListener('online', () => {
  if (localStorage.getItem(CLOUD_PENDING_KEY) === '1') syncCloudStore();
});
