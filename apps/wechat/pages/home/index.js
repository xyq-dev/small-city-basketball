const api = require('../../utils/api');
const ui = require('../../utils/ui');
Page({
  data: {
    value: '',
    error: '',
    moreOpen: false,
    positions: [
      { code: 'PG', name: '控卫', icon: 'pos-pg' },
      { code: 'SG', name: '分卫', icon: 'pos-sg' },
      { code: 'SF', name: '小前', icon: 'pos-sf' },
      { code: 'PF', name: '大前', icon: 'pos-pf' },
      { code: 'C', name: '中锋', icon: 'pos-c' },
    ],
  },
  openPlayers() {
    ui.open('players');
  },
  moreToggle() {
    this.setData({ moreOpen: !this.data.moreOpen });
  },
  position(e) {
    const position = e.currentTarget.dataset.position;
    if (['PG', 'SG', 'SF', 'PF', 'C'].includes(position)) ui.open('players', { position });
  },
  input(e) {
    this.setData({ value: e.detail.value });
  },
  open() {
    try {
      const event = api.eventFromInput(this.data.value);
      this.setData({ error: '' });
      ui.open('event', { event });
    } catch {
      this.setData({ error: '请输入主办方提供的有效观赛链接或43位公开编号。' });
    }
  },
  account() {
    ui.open('account');
  },
  go(e) {
    ui.open(e.currentTarget.dataset.page);
  },
});
