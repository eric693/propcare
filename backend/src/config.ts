// 集中管理外部憑證與功能旗標。LINE 未設定時推播一律略過（回傳 false），系統照常運作。
export const config = {
  jwtSecret: process.env.JWT_SECRET ?? 'dev_secret_change_me',
  appUrl: process.env.APP_URL ?? 'http://localhost:3390',
  line: {
    secret: process.env.LINE_CHANNEL_SECRET ?? '',
    token: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
    get enabled() {
      return Boolean(this.secret && this.token);
    },
  },
  // 登入頁公開顯示的示範帳號。兩者都設定才會顯示；清空即隱藏。
  demo: {
    account: (process.env.DEMO_ACCOUNT ?? '').trim().toLowerCase(),
    password: process.env.DEMO_PASSWORD ?? '',
    get enabled() {
      return Boolean(this.account && this.password);
    },
    // 住戶端示範帳號（手機／密碼）
    residentPhone: process.env.DEMO_RESIDENT_PHONE ?? '',
    residentPassword: process.env.DEMO_RESIDENT_PASSWORD ?? '',
  },
};
