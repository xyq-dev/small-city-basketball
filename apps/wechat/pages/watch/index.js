const api = require('../../utils/api');
const ui = require('../../utils/ui');
Page({
  data: { value: '', error: '' },
  input(e) {
    this.setData({ value: e.detail.value });
  },
  open() {
    try {
      ui.open('event', { event: api.eventFromInput(this.data.value) });
    } catch {
      this.setData({ error: '请输入主办方提供的有效观赛链接或43位公开编号。' });
    }
  },
});
