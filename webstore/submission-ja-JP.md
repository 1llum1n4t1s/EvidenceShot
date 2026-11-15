# EvidenceShot ストア申請情報（ja-JP）

## 1. 基本情報
- 拡張機能名: `EvidenceShot`
- バージョン: `1.0.22`
- カテゴリ候補: `Developer Tools` または `Productivity`
- 言語: `日本語 (ja-JP)`

## 2. ストア掲載文（日本語）
- 短い説明（132文字以内）:
  `Webテスト向けに、表示領域・スクロール連結のスクリーンショットを日時入りで保存できる拡張機能。`
- 詳細説明:
  `webstore/store-listing.txt` を使用

## 3. スクリーンショット / プロモ素材
- `bun --bun run generate-screenshots`（vitrina キット、`webstore/store-assets.json`）で生成する。`webstore/vitrina/` は正本の逐語コピーのため、ここでは編集しない。
- 1280x800（ストア言語ごと。ja は `webstore/images/ja/`、他言語は同じ構成のロケール名ディレクトリ）:
  - `webstore/images/ja/screenshot-01.png` to `screenshot-04.png`
- Small promo tile 440x280:
  - `webstore/images/tile-small.png`
- Marquee promo tile 1400x560:
  - `webstore/images/tile-marquee.png`

## 4. プライバシーポリシー
- 日本語版: `docs/privacy-policy-ja.md`
- 英語版: `docs/privacy-policy.md`
- 申請時に入力する公開URL:
  - `https://evidenceshot.kagayoi.com/privacy`

## 5. 権限説明（申請フォーム用）
- 単一の目的の説明: Webテスト向けに、表示領域・スクロール連結のスクリーンショットを日時入りで保存できる拡張機能。
- `activeTab`: ポップアップの撮影ボタンまたはショートカットキー（Ctrl+Shift+Y）でユーザーが撮影を始めたときに、現在のタブを撮影するために使用します。
- `storage`: 保存形式やタイムスタンプ設定などをローカル保存するため
- `scripting`: 撮影時に必要な制御スクリプトを現在タブへ注入するため
- `offscreen`: 画像合成やタイムスタンプ描画を非表示ドキュメントで行うため
- `downloads`: 生成した画像をダウンロードとして保存するため
- `clipboardWrite`: 撮影完了時に画像をクリップボードへコピーする任意機能のため
- ホスト権限（`https://support.kagayoi.com/*`）: https://support.kagayoi.com/* は、利用者がポップアップのお問い合わせフォームを送信したときだけ、メール確認と問い合わせ内容の送信のために Kagayoi Support と通信します。撮影した画像・閲覧中のページの内容・撮影設定は送信しません。

## 6. データ利用に関する回答の下書き
- 収集するデータの種類（チェックを入れるもの）: `個人を特定できる情報` / `認証に関する情報` / `個人的コミュニケーション`（問い合わせ時に利用者が入力したメールアドレス、任意の名前、カテゴリ、件名、本文、およびメール確認コード）
- 収集しないデータの種類: `健康に関する情報` / `財務状況や支払いに関する情報` / `位置情報` / `ウェブ履歴` / `ユーザーのアクティビティ` / `ウェブサイトのコンテンツ`
- 誓約（3 つともチェック）: `承認されている以外の用途で第三者にユーザーデータを販売、転送しません` / `アイテムの唯一の目的と関係のない目的でユーザーデータを使用または転送しません` / `信用力を判断する目的または融資目的でユーザーデータを使用または転送しません`
- 第三者送信: `Kagayoi Support（https://support.kagayoi.com）へ、利用者が問い合わせを送信した場合だけ送信`
- 販売 / 広告利用: `いいえ`
- 追跡 / 分析SDK: `なし`
- 処理場所: `撮影画像と撮影履歴はブラウザ内のみ。問い合わせデータだけ Kagayoi Support で処理`

## 7. サポート情報
- サポートサイトURL: `https://support.kagayoi.com/`
- サポートメール: CWS Developer Dashboard に登録済みの公開連絡先を使用
- 開発者名: `Kagayoi`

## 8. 最終チェック
- [ ] プライバシーポリシーURLが公開済み
- [ ] ストア説明が最新仕様と一致（WEBP、capture mode、footer text、問い合わせ導線）
- [ ] スクリーンショット5枚以上をアップロード
- [ ] 権限説明が manifest と一致
