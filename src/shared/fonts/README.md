# UDEV Gothic JPDOC 同梱フォント

- バージョン: v2.2.0（Regular / Bold）
- 配布元: https://github.com/yuru7/udev-gothic/releases/tag/v2.2.0
- 取得資産: `UDEVGothic_v2.2.0.zip`
- 配布 ZIP の SHA256（GitHub 公開 digest と照合済み）:
  `c104c171f6ed8922ca52d74cd915a271e427f1e884e51431aae71d99e8b3b47b`
- ライセンス: [SIL Open Font License 1.1](LICENSE-UDEV-Gothic.txt)

公式 ZIP 内の `UDEVGothicJPDOC-{Regular,Bold}.ttf` を FontTools 4.65.0 / Brotli 1.2.0 の
`TTFont(..., recalcTimestamp=False)` で読み、`flavor = 'woff2'` として保存する。
サブセット化・字形編集は行わず、プレビューと保存画像で同じファイルを使用する。
Dependabot 管理外のため、更新時は公式リリースと実ファイルの name テーブルを照合する。

| ファイル | SHA256 |
| --- | --- |
| UDEVGothicJPDOC-Regular.woff2 | `4a320f5bb11f5bded570a4a888067e387f8c20e1ce179008d50e8aa507556c82` |
| UDEVGothicJPDOC-Bold.woff2 | `dc68e145765c8d3310dec00987b491ff09e7ec23f0b35049cee7641cef60ecea` |
