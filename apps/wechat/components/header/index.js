const ui = require('../../utils/ui');
Component({
  properties: {
    title: { type: String, value: '' },
    locationLabel: { type: String, value: '全国' },
    dark: { type: Boolean, value: false },
    home: { type: Boolean, value: false },
    main: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    back: { type: Boolean, value: true },
    emitBack: { type: Boolean, value: false },
  },
  data: { statusBarHeight: 20, capsulePresent: false, capsuleGap: 96 },
  observers: {
    dark(value) {
      this.syncNavigationColor(value);
    },
  },
  lifetimes: {
    attached() {
      this.syncNavigationColor(this.properties.dark);
      try {
        const info =
          typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const menu =
          typeof wx.getMenuButtonBoundingClientRect === 'function'
            ? wx.getMenuButtonBoundingClientRect()
            : null;
        const next = {};
        if (
          info &&
          Number.isFinite(info.statusBarHeight) &&
          info.statusBarHeight >= 0 &&
          info.statusBarHeight <= 80
        )
          next.statusBarHeight = info.statusBarHeight;
        if (menu && menu.width > 0) next.capsulePresent = true;
        if (info && menu && Number.isFinite(menu.left) && menu.left > 0)
          next.capsuleGap = Math.min(
            160,
            Math.max(72, Math.round(info.windowWidth - menu.left + 8)),
          );
        if (Object.keys(next).length) this.setData(next);
      } catch {}
    },
  },
  methods: {
    syncNavigationColor(dark) {
      if (typeof wx.setNavigationBarColor === 'function')
        wx.setNavigationBarColor({
          frontColor: dark ? '#ffffff' : '#000000',
          backgroundColor: dark ? '#123c73' : '#ffffff',
          fail() {},
        });
    },
    goBack() {
      if (this.properties.disabled) return;
      if (this.properties.emitBack) {
        this.triggerEvent('back');
        return;
      }
      if (typeof wx.navigateBack === 'function')
        wx.navigateBack({ delta: 1, fail: () => ui.open('home') });
      else ui.open('home');
    },
    search() {
      if (!this.properties.disabled) this.triggerEvent('search');
    },
  },
});
