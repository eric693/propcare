import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

/** 個人資料蒐集告知事項（個人資料保護法第 8 條） */
export const PRIVACY_ITEMS: [string, string][] = [
  ['蒐集者', '您所居住社區的管理委員會（或管理負責人），並委託物業管理公司使用本系統代為處理。'],
  ['蒐集目的', '公寓大廈管理（管理費收繳與帳務、包裹代收、公設預約、報修、訪客門禁、區分所有權人會議通知與表決、社區公告與意見反映），以及依法令須辦理的事項。'],
  ['個人資料類別', '姓名、電話、電子郵件、戶別、與戶別的關係（所有權人／承租人／家屬）、繳費紀錄、LINE 帳號識別碼（綁定時）、訪客姓名電話車牌。'],
  ['利用期間', '居住或持有該戶期間，及遷出後依法令或帳務查核需要保存的期間；訪客紀錄於社區規約或管委會決議的保存期間屆滿後刪除。'],
  ['利用地區', '中華民國境內（資料存放於本系統主機）。'],
  ['利用對象', '社區管理委員會、受託的物業管理公司與其服務人員；依法令要求時提供主管機關或法院。'],
  ['利用方式', '以電子或書面方式處理，例如帳單、收據、催告函、公告與 LINE 通知。'],
  ['您的權利', '依個資法第 3 條，您可以向管理中心請求查詢、閱覽、製給複製本、補充或更正、停止蒐集處理利用，或刪除您的個人資料。'],
  ['不提供的影響', '您可以自由選擇是否提供；若不提供，可能無法使用住戶專區、收到繳費與包裹通知，或影響管理服務的提供。'],
];

export default function Privacy() {
  return (
    <div className="min-h-[100dvh] bg-warm">
      <header className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-2.5">
        <div className="w-9 h-9 bg-brand rounded-xl flex items-center justify-center"><Home className="w-5 h-5 text-white" strokeWidth={2.5} /></div>
        <b>PropCare 物業管家</b>
        <Link to="/r/login" className="btn-ghost ml-auto">住戶登入</Link>
      </header>
      <main className="max-w-3xl mx-auto px-4 pb-16">
        <h1 className="text-2xl font-bold text-gray-900 mt-4 mb-1">個人資料蒐集告知事項</h1>
        <p className="text-sm text-gray-500 mb-5">依《個人資料保護法》第 8 條告知以下事項。</p>
        <div className="card divide-y divide-gray-100 p-0">
          {PRIVACY_ITEMS.map(([k, v]) => (
            <div key={k} className="grid sm:grid-cols-[8rem_1fr] gap-1 sm:gap-4 px-4 py-3">
              <div className="font-semibold text-sm text-gray-700">{k}</div><div className="text-sm text-gray-600 leading-relaxed">{v}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-4">系統會記錄資料的修改、匯出與重要操作，以備查核。</p>
      </main>
    </div>
  );
}
