# TaskBoard データベース定義書

更新日: 2026-06-09

## 全体像

TaskBoard は、Supabase 上では通常の複数テーブル構成ではなく、`taskboard_data` という 1 つのテーブルにアプリ全体のデータを JSON として保存しています。

その JSON の中に、運用上の「論理テーブル」として `members`、`projects`、`tasks`、`asks` などが入っています。

```mermaid
erDiagram
  TASKBOARD_DATA ||--|| STORE_JSON : stores
  STORE_JSON ||--o{ MEMBER : contains
  STORE_JSON ||--o{ PROJECT : contains
  STORE_JSON ||--o{ TASK : contains
  STORE_JSON ||--o{ ASK : contains
  STORE_JSON ||--o{ TEMPLATE : contains
  STORE_JSON ||--o{ CHATWORK_IMPORT : contains
  STORE_JSON ||--o{ PROJECT_REVIEW : contains

  MEMBER ||--o{ TASK : assigned_to
  MEMBER ||--o{ PROJECT : owner_or_creator
  MEMBER ||--o{ ASK : from_or_to
  PROJECT ||--o{ TASK : has
  PROJECT ||--o{ PHASE : embeds
  PHASE ||--o{ TASK : assigned_phase
  TASK ||--o| TASK : carried_over
  PROJECT_REVIEW ||--o{ TASK : resolves_project
```

## 物理テーブル

### taskboard_data

Supabase に存在する実テーブルです。

| カラム | 型 | 内容 |
|---|---|---|
| `id` | text | 保存行のID。現在は常に `main` |
| `data` | json/jsonb | アプリ全体のデータ |
| `updated_at` | timestamp | 最終保存日時 |

想定SQL:

```sql
create table if not exists public.taskboard_data (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default now()
);
```

## JSON内の論理テーブル

`taskboard_data.data` の中身は、おおむね次の形です。

```json
{
  "members": [],
  "projects": [],
  "tasks": [],
  "asks": [],
  "templates": [],
  "chatworkImports": [],
  "projectReviews": [],
  "meta": {}
}
```

## members

メンバー情報です。タスク担当者、窓口、登録者、Chatwork投稿者の照合に使います。

| 項目 | 内容 |
|---|---|
| `id` | メンバーID |
| `name` | 表示名 |
| `color` | 表示色 |
| `chatworkAccountId` | ChatworkアカウントID |
| `createdAt` | 作成日 |

## projects

プロジェクト情報です。タスクの親になります。

| 項目 | 内容 |
|---|---|
| `id` | プロジェクトID |
| `clientName` | クライアント名 |
| `name` | プロジェクト名 |
| `deliveryDate` | 納品日 |
| `budget` | 予算 |
| `projectType` | `standard` / `recurring` / `provisional` |
| `recurringSeries` | 定期案件名 |
| `ownerMemberId` | 窓口担当メンバーID |
| `createdByMemberId` | 登録者メンバーID。互換性のためフィールド名は createdBy のまま |
| `dealCategory` | 案件区分。既存クライアント / 提案系など |
| `leadSource` | 案件流入元。問い合わせ・紹介・代理店・媒体などのチャネル |
| `leadSourceDetail` | 案件流入元の詳細。フォーム名、紹介元、媒体名、代理店名など |
| `startDate` | 開始日。未設定の場合はタスク日付から補う運用 |
| `isProvisional` | 仮プロジェクトかどうか |
| `detailsDueAt` | 不足情報の確認期限 |
| `projectStatus` | `active` / `completed` など |
| `note` | プロジェクト備考 |
| `archived` | アーカイブ済みか |
| `createdAt` | 作成日 |
| `phases` | フェーズ配列 |

## projects.phases

プロジェクト内に埋め込まれているフェーズ情報です。独立したSupabaseテーブルではありません。

| 項目 | 内容 |
|---|---|
| `id` | フェーズID |
| `name` | フェーズ名 |
| `status` | `pending` / `active` / `done` |
| `startDate` | フェーズ開始日 |
| `dueDate` | フェーズ締切日 |
| `order` | 表示順 |

## tasks

タスク情報です。今日のタスク、繰り越し、完了状態、プロジェクト紐付けに使います。

| 項目 | 内容 |
|---|---|
| `id` | タスクID |
| `date` | タスク締切日。この日までに完了する |
| `startDate` | タスク開始日。未設定の場合は締切日と遂行期間から補う |
| `originalDate` | 未完了で日を跨いだ場合の元の作業日 |
| `memberId` | 担当者メンバーID |
| `projectId` | 紐付くプロジェクトID |
| `phaseId` | 紐付くフェーズID |
| `content` | タスク内容 |
| `estimatedHours` | 予定時間 |
| `durationDays` | 遂行期間（日数）。開始日から締切日までの営業日数 |
| `reviewConfigMode` | `inherit` プロジェクト・フェーズ設定を使用 / `custom` タスク専用 |
| `reviewerMemberIds` | タスク専用の確認者ID配列 |
| `approvalMemberIds` | タスク専用の進行許可者ID配列 |
| `reviewRule` | `inherit` / `all` / `any` |
| `reviewDueDays` | タスク専用の確認期限（日数） |
| `notifyProgressManager` | 進行管理役にも通知するか |
| `note` | 備考 |
| `sourceProjectName` | Chatwork等から来た元のプロジェクト名 |
| `needsProjectReview` | プロジェクト確認待ちか |
| `carriedFromTaskId` | 旧仕様の繰り越し元タスクID |
| `carriedOverToTaskId` | 旧仕様の繰り越し先タスクID |
| `completed` | `null` 未確認 / `true` 完了 / `false` 未完了 |
| `incompleteReason` | 未完了理由 |
| `mergedIntoTaskId` | 重複整理で統合先になったタスクID。設定済みのタスクは通常表示から外す |
| `mergedAt` | 重複整理で統合した日時 |
| `createdAt` | 作成日時 |

## asks

進行に関わる確認・お願いです。個人的な作業相談ではなく、進行に影響する確認を残すためのデータです。

| 項目 | 内容 |
|---|---|
| `id` | 確認ID |
| `type` | 種別。例: 質問、お願い |
| `fromMemberId` | 依頼元メンバーID |
| `toMemberId` | 依頼先メンバーID |
| `toName` | 依頼先名。全員など |
| `content` | 内容 |
| `projectId` | 関連プロジェクトID |
| `projectName` | 関連プロジェクト名 |
| `taskId` | 関連タスクID |
| `dueText` | 期限テキスト |
| `status` | `open` / `done` |
| `date` | 登録日 |
| `createdAt` | 作成日時 |

## templates

プロジェクトテンプレートです。プロジェクト作成時にフェーズを作るために使います。

| 項目 | 内容 |
|---|---|
| `id` | テンプレートID |
| `name` | テンプレート名 |
| `phases` | フェーズ名の配列 |
| `tasks` | 標準タスクの配列。タスク名、フェーズ、営業日前、遂行期間（日）、工数、確認設定を持つ |
| `custom` | ユーザー作成テンプレートか |

## chatworkImports

Chatworkからの重複取り込みを防ぐための履歴です。

| 項目 | 内容 |
|---|---|
| `key` | `roomId:messageId` |
| `roomId` | ChatworkルームID |
| `messageId` | ChatworkメッセージID |
| `accountName` | 投稿者名 |
| `taskCount` | 取り込んだタスク数 |
| `askCount` | 取り込んだ確認数 |
| `importedAt` | 取り込み日時 |

## projectReviews

Chatworkから来たタスクのプロジェクト名が既存プロジェクトと一致しない場合の確認待ちデータです。

| 項目 | 内容 |
|---|---|
| `id` | 確認ID |
| `roomId` | ChatworkルームID |
| `messageId` | ChatworkメッセージID |
| `accountName` | 投稿者名 |
| `memberId` | 紐付いたメンバーID |
| `groups` | 確認対象グループ |
| `status` | `open` / `resolved` |
| `createdAt` | 作成日時 |
| `resolvedAt` | 解決日時 |

### projectReviews.groups

| 項目 | 内容 |
|---|---|
| `sourceProjectName` | Chatworkに書かれたプロジェクト名 |
| `taskIds` | 対象タスクID配列 |
| `suggestionProjectIds` | 類似候補プロジェクトID配列 |

## meta

アプリ全体の補助情報です。

| 項目 | 内容 |
|---|---|
| `lastDate` | 最後に日付処理した日 |

## 現状の注意点

- 実DBは1テーブルなので、Supabaseの画面だけを見ると `taskboard_data` しか見えません。
- `projects.phases` はプロジェクト内に埋め込まれています。
- `tasks.projectId` が空、または `needsProjectReview: true` のタスクは、プロジェクト確認待ちです。
- 過去の運用で作られた `isProvisional: true` のプロジェクトがあるため、プロジェクト一覧に「仮プロジェクト」が多く表示されることがあります。
- 今後データ量や権限管理が増える場合は、`members`、`projects`、`tasks` などをSupabaseの個別テーブルに分ける設計も検討できます。

## データ整理で確認する状態

アプリの「データ整理」画面では、以下を確認します。

| 確認項目 | 判定条件 | 主な対応 |
|---|---|---|
| 未紐付けタスク | `projectId` が空、存在しない、または `needsProjectReview: true` | 正式プロジェクトへ紐付け |
| 仮プロジェクト | `isProvisional: true`、`projectType: provisional`、または名称に `仮プロジェクト` を含む | 正式プロジェクトへ統合、またはアーカイブ |
| クライアント表記ゆれ | `projects.clientName` に複数の表記が存在 | 統合先クライアント名を選び、対象プロジェクトの `clientName` を一括置換 |
| 繰り越し不整合 | `carriedFromTaskId` / `carriedOverToTaskId` の参照先がない、または完了状態が食い違う | リンク解除、繰り越し先も完了、タスク編集 |
| フェーズ不整合 | `phaseId` があるが、対象プロジェクト内にそのフェーズがない | フェーズ解除、またはタスク編集 |
| 不足情報プロジェクト | 登録者、窓口、納品日、定期案件名などが不足 | プロジェクト編集で補完 |

クライアントは独立したテーブルではなく、各プロジェクトの `clientName` 文字列として保存しています。
そのため、クライアント整理は「クライアント行を削除する」のではなく、その名前を使っているプロジェクトの `clientName` を正式名称へ置き換える処理です。
