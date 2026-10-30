const cities = require('../../utils/city-preference');
const ui = require('../../utils/ui');

Page({
  data: { city: '', label: '全国', source: '', recent: [], warning: '', input: '', error: '' },
  onLoad() {
    const selection = cities.snapshot();
    this.setData({ ...selection, input: selection.city });
  },
  inputCity(e) {
    this.setData({ input: String(e.detail.value || '').slice(0, 40), error: '' });
  },
  apply() {
    if (!this.data.input.trim()) {
      this.setData({ error: '请填写城市名称，或选择“浏览全国”。' });
      return;
    }
    this.select(this.data.input);
  },
  pickRecent(e) {
    const city = e.currentTarget.dataset.city;
    if (this.data.recent.includes(city)) this.select(city);
  },
  nationwide() {
    this.select('');
  },
  select(city) {
    try {
      this.setData({ ...cities.choose(city), error: '' });
      if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1)
        wx.navigateBack({ delta: 1 });
      else ui.open('watch');
    } catch (error) {
      this.setData({ error: ui.message(error) });
    }
  },
  clearHistory() {
    this.setData(cities.clearRecent());
  },
});
