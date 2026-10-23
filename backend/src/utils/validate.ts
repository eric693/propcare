import { z, ZodTypeAny } from 'zod';
import { HttpError } from '../services/feeService';

/** 驗證 request body；不合格時丟 400，訊息用欄位的中文說明 */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new HttpError(400, i.message && !i.message.startsWith('Expected') && !i.message.startsWith('Required') && !i.message.startsWith('Invalid')
      ? i.message : `欄位「${i.path.join('.') || '資料'}」格式不正確`);
  }
  return r.data;
}

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式應為 YYYY-MM-DD');
export const zPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '期別格式應為 YYYY-MM');
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時間格式應為 HH:MM');
export const zMoney = z.coerce.number().int('金額須為整數').min(0, '金額不可為負數');
export const zText = (max = 200) => z.string().trim().max(max).default('');
export const zPhone = z.string().trim().regex(/^(09\d{8}|0\d{1,3}-?\d{5,8})?$/, '電話格式不正確').default('');
