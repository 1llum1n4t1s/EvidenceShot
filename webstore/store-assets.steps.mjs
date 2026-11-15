// 撮影前の操作: popup は実機と同様に 600px で切れるため、見せたい節までスクロールして撮る。
// 画像側では何も描き足さず、実 UI の表示位置を変えるだけ。
const scrollToTop = (selector, offset) => async ({ page }) => {
  await page.evaluate(
    (sel, off) => {
      const el = document.querySelector(sel);
      window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - off));
    },
    selector,
    offset,
  );
};

export default {
  // 撮影オプション節（日付スタイルのプレビュー canvas を含む）
  "popup-stamp": scrollToTop("#timestamp-enabled", 30),
  // 撮影ボタンと保存節
  "popup-save": scrollToTop("#capture-now", 120),
};
