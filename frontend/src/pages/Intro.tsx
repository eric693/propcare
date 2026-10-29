import { Link } from 'react-router-dom';
import { Bell, Building, CalendarDays, ClipboardCheck, Gavel, Home, Package, Receipt, Smartphone, Wallet, Wrench, Megaphone, Landmark, UserCheck, MessageSquare, FolderOpen } from 'lucide-react';

const FEATURES = [
  { icon: Receipt, title: '管理費自動化', body: '依坪數或固定金額每月自動開帳、LINE 繳費提醒、部分繳與多期一次沖銷，收款自動開收據。' },
  { icon: Wallet, title: '公共基金專戶列帳', body: '收款時依規約比例自動提撥公共基金，兩個帳戶分開記帳；支出須委員核准，一鍵產生月報公告。' },
  { icon: Gavel, title: '區權會出席與表決', body: '開會通知 10 日期限檢查、逐戶簽到與委託出席，依條例第 27、31、32 條判定定額與表決（含 1/5 上限、重新召集異議期），提醒會議紀錄 15 日內送達。' },
  { icon: Package, title: '包裹代收', body: '登記即產生取件碼並 LINE 通知住戶，輸入取件碼即可領取，逾期未領每天自動提醒。' },
  { icon: CalendarDays, title: '公設預約', body: '健身房、KTV、交誼廳線上預約，自動控管時段名額、每戶每週上限與可提前天數。' },
  { icon: Wrench, title: '報修派工', body: '住戶手機報修、管理中心派工給廠商，進度與處理說明住戶即時看得到。' },
  { icon: ClipboardCheck, title: '法定檢查申報', body: '消防安全設備檢修申報、公共安全檢查、電梯安檢、水塔清洗預設排程，完成後自動排下一次。' },
  { icon: Bell, title: '欠費與催告', body: '逾期未繳自動彙整，催告標準可依規約設定（條例第 21 條），列印民國年催告函並保存掛號送達紀錄。' },
  { icon: Megaphone, title: '社區公告', body: '停水停電、會議公告同步 LINE 推播，看得到已讀人數。' },
  { icon: Building, title: '多社區管理', body: '物業公司一個帳號管理所有社區，總覽各社區收繳率、欠費、待辦與帳戶餘額。' },
  { icon: Landmark, title: '虛擬帳號自動銷帳', body: '每戶一組專屬繳費帳號，匯入網銀入帳明細即自動沖銷最舊的帳單，同一筆不會重複入帳。' },
  { icon: UserCheck, title: '訪客與巡邏', body: '訪客登記與在場名單、寄放物品取件碼；巡邏點貼 QR Code，保全掃描即打卡。' },
  { icon: MessageSquare, title: '意見反映與調查', body: '住戶線上反映問題、管理中心回覆；一戶一票的意見調查，結果即時統計。' },
  { icon: FolderOpen, title: '文件與財產清冊', body: '規約、圖說、會議紀錄線上查閱（條例第 35 條）；財產清冊方便改選交接。' },
  { icon: Smartphone, title: '住戶手機專區', body: '住戶用手機號碼登入：查帳單與收據、包裹取件碼、預約公設、報修、看財報與會議紀錄。' },
];

export default function Intro() {
  return (
    <div className="min-h-[100dvh] bg-warm">
      <header className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-2.5">
        <div className="w-9 h-9 bg-brand rounded-xl flex items-center justify-center"><Home className="w-5 h-5 text-white" strokeWidth={2.5} /></div>
        <b>PropCare 物業管家</b>
        <div className="ml-auto flex gap-2"><Link to="/r/login" className="btn-ghost">住戶登入</Link><Link to="/login" className="btn-primary">管理登入</Link></div>
      </header>
      <section className="max-w-5xl mx-auto px-4 pt-10 pb-12">
        <div className="text-xs font-semibold tracking-widest text-brand mb-3">社區管委會・物業管理公司</div>
        <h1 className="text-3xl sm:text-5xl font-bold leading-tight text-gray-900">社區大小事，<br />一支手機管好。</h1>
        <p className="text-gray-600 mt-4 max-w-2xl leading-relaxed">管理費收繳、公共基金帳務、包裹代收、公設預約、報修、區分所有權人會議表決與法定檢查申報，依《公寓大廈管理條例》設計。總幹事少跑腿、委員帳目清楚、住戶隨時查得到。</p>
        <div className="flex flex-wrap gap-2 mt-6"><Link to="/login" className="btn-primary px-5 py-2.5">試用示範帳號</Link><Link to="/r/login" className="btn-secondary px-5 py-2.5">看住戶端畫面</Link></div>
      </section>
      <section className="max-w-5xl mx-auto px-4 pb-14">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">實際畫面</h2>
        <p className="text-sm text-gray-500 mb-5">以下為示範社區的資料，登入示範帳號即可操作。</p>
        <Shot src="/intro/dashboard.jpg" w={1280} h={860} title="總幹事工作台" body="收繳率、欠費、待辦一眼看完；近 6 個月收繳與收支、支出科目、報修類別都畫成圖表。" />
        <div className="grid md:grid-cols-[2fr_1fr] gap-4 mt-4 items-start">
          <Shot src="/intro/arrears.jpg" w={1280} h={860} title="欠費帳齡與催告" body="依欠繳期數分組，逾二期的戶數與金額清楚列出，可直接列印催告函。" />
          <Shot src="/intro/resident.jpg" w={780} h={1560} title="住戶手機財報" body="住戶看得到每個月的錢花在哪裡，帳目公開透明。" phone />
        </div>
      </section>
      <section className="max-w-5xl mx-auto px-4 pb-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <div className="w-9 h-9 rounded-xl bg-brand-light flex items-center justify-center mb-3"><f.icon className="w-5 h-5 text-brand" /></div>
            <h3 className="font-semibold mb-1">{f.title}</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </section>
      <footer className="text-center text-xs text-gray-400 pb-8">PropCare 物業管家・<Link to="/privacy" className="hover:underline">個資蒐集告知</Link></footer>
    </div>
  );
}

function Shot({ src, w, h, title, body, phone }: { src: string; w: number; h: number; title: string; body: string; phone?: boolean }) {
  return (
    <figure className="card p-3">
      <div className={phone ? 'mx-auto max-w-[240px] rounded-[1.75rem] border-[6px] border-gray-800 overflow-hidden' : 'rounded-xl border border-gray-200 overflow-hidden'}>
        <img src={src} width={w} height={h} alt={title} loading="lazy" className="block w-full h-auto" />
      </div>
      <figcaption className="px-1 pt-3"><b className="text-sm">{title}</b><p className="text-sm text-gray-600 mt-0.5 leading-relaxed">{body}</p></figcaption>
    </figure>
  );
}
