Component({
  properties: {
    city: { type: String, value: '全国' },
    placeholder: { type: String, value: '搜赛事、球队、球员' },
    tools: { type: Boolean, value: true },
  },
  data: {
    statusBarHeight: 47,
    capsuleGap: 96,
  },
  lifetimes: {
    attached() {
      this.sync();
    },
  },
  pageLifetimes: {
    show() {
      this.sync();
    },
  },
  methods: {
    sync() {
      let statusBarHeight = this.data.statusBarHeight;
      let capsuleGap = this.data.capsuleGap;
      try {
        const info =
          typeof wx.getWindowInfo === 'function'
            ? wx.getWindowInfo()
            : typeof wx.getSystemInfoSync === 'function'
              ? wx.getSystemInfoSync()
              : null;
        if (
          info &&
          Number.isFinite(info.statusBarHeight) &&
          info.statusBarHeight >= 0 &&
          info.statusBarHeight <= 80
        )
          statusBarHeight = info.statusBarHeight;
        if (
          info &&
          Number.isFinite(info.windowWidth) &&
          typeof wx.getMenuButtonBoundingClientRect === 'function'
        ) {
          const menu = wx.getMenuButtonBoundingClientRect();
          if (menu && Number.isFinite(menu.left) && menu.left > 0 && menu.left < info.windowWidth)
            capsuleGap = Math.min(160, Math.max(72, info.windowWidth - menu.left + 8));
        }
      } catch {
        /* The platform draws the real status bar and capsule. */
      }
      this.setData({ statusBarHeight, capsuleGap });
    },
    onCity() {
      this.triggerEvent('city');
    },
    onSearch() {
      this.triggerEvent('search');
    },
    onBell() {
      this.triggerEvent('bell');
    },
  },
});
