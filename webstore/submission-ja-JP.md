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
  - `https://privacy.kagayoi.com/evidenceshot`

## 5. 「プライバシー」タブ
- 単一の目的の説明・権限ごとの正当性・データ使用の開示・送信先と処理場所は `webstore/privacy-practices.ja.txt` が正本（Edictora の `privacy` 設定が区間で読む）。ここには複製しない。

## 6. （欠番。5 に統合）

## 7. サポート情報
- サポートサイトURL: `https://support.kagayoi.com/`
- サポートメール: CWS Developer Dashboard に登録済みの公開連絡先を使用
- 開発者名: `Kagayoi`

## 8. 最終チェック
- [ ] プライバシーポリシーURLが公開済み
- [ ] ストア説明が最新仕様と一致（WEBP、capture mode、footer text、問い合わせ導線）
- [ ] スクリーンショット5枚以上をアップロード
- [ ] 権限説明（`webstore/privacy-practices.ja.txt`）が manifest と一致
