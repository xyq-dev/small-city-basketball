const ui = require('../../utils/ui');
Page({
  data: {
    selected: 'funds',
    options: [
      { key: 'funds', label: '当前费用与资金' },
      { key: 'payment', label: '支付确认' },
      { key: 'unknown', label: '支付待核验' },
      { key: 'refund', label: '取消与退款' },
      { key: 'settlement', label: '球员结算' },
      { key: 'messages', label: '关注与消息' },
      { key: 'profile', label: '长期球员档案' },
    ],
  },
  onLoad(query = {}) {
    if (this.data.options.some((v) => v.key === query.kind)) this.setData({ selected: query.kind });
  },
  select(e) {
    const key = e.currentTarget.dataset.key;
    if (this.data.options.some((v) => v.key === key)) this.setData({ selected: key });
  },
  go(e) {
    ui.open(e.currentTarget.dataset.page);
  },
});
