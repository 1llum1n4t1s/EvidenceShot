# EvidenceShot ストア申請情報（ja-JP）

## 1. 基本情報
- 拡張機能名: `EvidenceShot`
- バージョン: `1.0.21`
- カテゴリ候補: `Developer Tools` または `Productivity`
- 言語: `日本語 (ja-JP)`

## 2. ストア掲載文（日本語）
- 短い説明（132文字以内）:
  `Webテスト向けに、表示領域・スクロール連結のスクリーンショットを日時入りで保存できる拡張機能。`
- 詳細説明:
  `webstore/store-listing.txt` を使用

## 3. スクリーンショット / プロモ素材
- 1280x800:
  - `webstore/images/01-feature-overview-1280x800.png`
  - `webstore/images/02-how-to-use-1280x800.png`
  - `webstore/images/03-hero-promo-1280x800.png`
- Small promo tile 440x280:
  - `webstore/images/promo-small-440x280.png`
- Marquee promo tile 1400x560:
  - `webstore/images/promo-marquee-1400x560.png`

## 4. プライバシーポリシー
- 日本語版: `docs/privacy-policy-ja.md`
- 英語版: `docs/privacy-policy.md`
- 申請時に入力する公開URL:
  - `https://evidenceshot.kagayoi.com/privacy`

## 5. 権限説明（申請フォーム用）
- `activeTab`: ユーザー操作で現在のタブを撮影するため
- `storage`: 保存形式やタイムスタンプ設定などをローカル保存するため
- `scripting`: 撮影時に必要な制御スクリプトを現在タブへ注入するため
- `offscreen`: 画像合成やタイムスタンプ描画を非表示ドキュメントで行うため
- `downloads`: 生成した画像をダウンロードとして保存するため
- `clipboardWrite`: ユーザー設定に応じて生成画像をクリップボードへコピーするため

## 6. データ利用に関する回答の下書き
- 個人情報の収集: `はい（問い合わせ時に利用者が入力したメールアドレス、任意の名前、カテゴリ、件名、本文、およびメール確認コード）`
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
