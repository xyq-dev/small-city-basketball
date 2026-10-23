const api = require('../../utils/api');
Page({
  data: { value: '', error: '' },
  input(e) {
    this.setData({ value: e.detail.value });
  },
  open() {
    try {
      const event = api.eventFromInput(this.data.value);
      this.setData({ error: '' });
      wx.navigateTo({ url: '/pages/event/index?event=' + event });
    } catch {
      this.setData({ error: '请输入主办方提供的有效观赛链接或43位公开编号。' });
    }
  },
  account() {
    wx.navigateTo({ url: '/pages/account/index' });
  },
});
