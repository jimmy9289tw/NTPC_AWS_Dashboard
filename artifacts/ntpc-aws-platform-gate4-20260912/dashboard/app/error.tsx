"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="shell">
      <section className="panel" role="alert">
        <p className="panel-kicker">系統狀態</p>
        <h1>儀表板暫時無法載入</h1>
        <p>請重新載入；若問題持續，將發生時間與畫面交給系統管理人員查核。</p>
        <button type="button" onClick={reset}>重新載入</button>
      </section>
    </main>
  );
}
