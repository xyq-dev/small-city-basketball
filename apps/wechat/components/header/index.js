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
    mode: { type: String, value: '' },
    cityLabel: { type: String, value: '全国' },
    message: { type: Boolean, value: true },
  },
  data: {
    statusBarHeight: 44,
    homeBottomSpace: 12,
    capsulePresent: false,
    capsuleReserve: 96,
    capsuleRowHeight: 44,
    narrow: false,
  },
  observers: {
    dark(value) {
      this.syncNavigationColor(value || this.properties.mode === 'home' || this.properties.home);
    },
    mode(value) {
      this.syncNavigationColor(this.properties.dark || value === 'home' || this.properties.home);
    },
  },
  lifetimes: {
    attached() {
      this.syncNavigationColor(
        this.properties.dark || this.properties.mode === 'home' || this.properties.home,
      );
      this.syncGeometry();
    },
  },
  pageLifetimes: {
    show() {
      this.syncGeometry();
    },
    resize() {
      this.syncGeometry();
    },
  },
  methods: {
    syncGeometry() {
      try {
        const info =
          typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const statusBarHeight =
          Number.isFinite(info.statusBarHeight) &&
          info.statusBarHeight >= 0 &&
          info.statusBarHeight <= 80
            ? info.statusBarHeight
            : this.data.statusBarHeight;
        const width = Number.isFinite(info.windowWidth) ? info.windowWidth : 390;
        const r =
          typeof wx.getMenuButtonBoundingClientRect === 'function'
            ? wx.getMenuButtonBoundingClientRect()
            : null;
        const capsulePresent = !!(r && r.width > 0);
        const capsuleReserve =
          capsulePresent && Number.isFinite(r.left)
            ? Math.max(96, width - r.left + 8)
            : this.data.capsuleReserve;
        const capsuleRowHeight =
          capsulePresent && Number.isFinite(r.bottom)
            ? Math.max(44, Math.ceil(r.bottom - statusBarHeight + 5))
            : 44;
        // Figma's 390/430 reference uses a 44px status area. Keep the visual
        // header at the same total height while still respecting a taller
        // native status bar instead of adding that difference twice.
        const homeBottomSpace = Math.max(8, 12 - Math.max(0, statusBarHeight - 44));
        const narrow = width <= 360;
        const homeMode = this.properties.mode === 'home' || this.properties.home;
        const height = homeMode
          ? statusBarHeight + (narrow ? capsuleRowHeight : 0) + 44 + 8 + 44 + homeBottomSpace
          : statusBarHeight + 44;
        this.setData(
          {
            statusBarHeight,
            homeBottomSpace,
            capsulePresent,
            capsuleReserve,
            capsuleRowHeight,
            narrow,
          },
          () => {
            this.triggerEvent('layoutchange', {
              height,
              statusBarHeight,
              capsuleReserve,
              capsuleRowHeight,
              narrow,
            });
          },
        );
      } catch {}
    },
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
      if (typeof wx.navigateBack === 'function')
        wx.navigateBack({ delta: 1, fail: () => ui.open('home') });
      else ui.open('home');
    },
    search() {
      if (!this.properties.disabled) this.triggerEvent('search');
    },
    city() {
      if (!this.properties.disabled) this.triggerEvent('city');
    },
    openMessages() {
      if (!this.properties.disabled) this.triggerEvent('message');
    },
  },
});
