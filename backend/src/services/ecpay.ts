import crypto from 'crypto';

// 綠界全方位金流（AioCheckOut V5）。規格：https://developers.ecpay.com.tw/2862/

export interface EcpayKeys { merchantId: string; hashKey: string; hashIV: string; stage: boolean }

export const checkoutUrl = (stage: boolean) => (stage ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5' : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5');

/** 綠界公開的測試特店（文件「測試環境」頁）；正式上線須換成社區自己的特店金鑰 */
export const ECPAY_TEST: EcpayKeys = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs', stage: true };

/**
 * 檢查碼（https://developers.ecpay.com.tw/2902/）：參數依名稱排序 → 前後加 HashKey／HashIV →
 * URL encode（等同 .NET 編碼：空白為 +，-_.!*() 不編碼）→ 轉小寫 → SHA256 → 轉大寫
 */
export function checkMacValue(params: Record<string, string | number>, hashKey: string, hashIV: string): string {
  const body = Object.keys(params).filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k}=${params[k]}`).join('&');
  const encoded = encodeURIComponent(`HashKey=${hashKey}&${body}&HashIV=${hashIV}`)
    .replace(/%20/g, '+').replace(/~/g, '%7e').replace(/'/g, '%27')
    .toLowerCase();
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

export function verifyMac(params: Record<string, string>, keys: Pick<EcpayKeys, 'hashKey' | 'hashIV'>): boolean {
  const got = params.CheckMacValue ?? '';
  const want = checkMacValue(params, keys.hashKey, keys.hashIV);
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** 台北時間 yyyy/MM/dd HH:mm:ss */
export function tradeDate(d = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}/${g('month')}/${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}:${g('second')}`;
}

/** 產生要以表單 POST 到綠界的欄位（含檢查碼） */
export function checkoutForm(keys: EcpayKeys, o: { tradeNo: string; amount: number; itemName: string; desc: string; method: string; returnUrl: string; backUrl: string; paymentInfoUrl?: string }) {
  const fields: Record<string, string | number> = {
    MerchantID: keys.merchantId, MerchantTradeNo: o.tradeNo, MerchantTradeDate: tradeDate(), PaymentType: 'aio',
    TotalAmount: o.amount, TradeDesc: o.desc, ItemName: o.itemName.slice(0, 200), ReturnURL: o.returnUrl,
    ChoosePayment: o.method, EncryptType: 1, ClientBackURL: o.backUrl, NeedExtraPaidInfo: 'N',
    ...(o.method === 'ATM' ? { ExpireDate: 3 } : {}),
    ...(o.method === 'CVS' || o.method === 'BARCODE' ? { StoreExpireDate: o.method === 'CVS' ? 4320 : 3 } : {}),
    ...(o.paymentInfoUrl && o.method !== 'Credit' ? { PaymentInfoURL: o.paymentInfoUrl } : {}),
  };
  fields.CheckMacValue = checkMacValue(fields, keys.hashKey, keys.hashIV);
  return { action: checkoutUrl(keys.stage), fields };
}
