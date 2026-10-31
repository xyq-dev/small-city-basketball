const ui = require('../../utils/ui');
Component({
  properties: {
    title: { type: String, value: '' },
    locationLabel: { type: String, value: '全国' },
    dark: { type: Boolean, value: false },
    home: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    back: { type: Boolean, value: true },
  },
  data: { statusBarHeight: 24, capsulePresent: false },
  observers: {
    dark(value) {
      this.syncNavigationColor(value);
    },
  },
  lifetimes: {
    attached() {
      this.syncNavigationColor(this.properties.dark);
      try {
        if (typeof wx.getWindowInfo === 'function') {
          const h = wx.getWindowInfo().statusBarHeight;
          if (Number.isFinite(h) && h >= 0 && h <= 80) this.setData({ statusBarHeight: h });
        }
      } catch {}
      try {
        if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
          const r = wx.getMenuButtonBoundingClientRect();
          this.setData({ capsulePresent: !!(r && r.width > 0) });
        }
      } catch {}
    },
  },
  methods: {
    syncNavigationColor(dark) {
      if (typeof wx.setNavigationBarColor === 'function')
        wx.setNavigationBarColor({
          frontColor: dark ? '#ffffff' : '#000000',
          backgroundColor: dark ? '#132c49' : '#ffffff',
          fail() {},
        });
    },
    goBack() {
      if (this.properties.disabled) return;
      if (typeof wx.navigateBack === 'function')
        wx.navigateBack({ delta: 1, fail: () => ui.open('home') });
      else ui.open('home');
    },
    search() {
      if (!this.properties.disabled) this.triggerEvent('search');
    },
  },
});
