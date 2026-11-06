const destinations = {
  Home: '/pages/home/index',
  Events: '/pages/watch/index',
  Local: '/pages/local/index',
  Teams: '/pages/teams/index',
  Account: '/pages/account/index',
};
Component({
  properties: {
    active: { type: String, value: 'Home' },
    // Kept for caller compatibility; every page renders the same icon bar.
    variant: { type: String, value: 'premium' },
    disabled: { type: Boolean, value: false },
  },
  data: {
    safeBottom: 0,
    items: [
      { key: 'Home', label: '首页', icon: 'home' },
      { key: 'Events', label: '赛事', icon: 'event' },
      { key: 'Local', label: '同城', icon: 'local' },
      { key: 'Teams', label: '球队', icon: 'teams' },
      { key: 'Account', label: '我的', icon: 'account' },
    ],
  },
  lifetimes: {
    attached() {
      this.syncSafeArea();
    },
  },
  pageLifetimes: {
    show() {
      this.syncSafeArea();
    },
    resize() {
      this.syncSafeArea();
    },
  },
  methods: {
    syncSafeArea() {
      try {
        const info =
          typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const height = Number.isFinite(info.screenHeight) ? info.screenHeight : info.windowHeight;
        const bottom = info.safeArea && Number.isFinite(info.safeArea.bottom)
          ? height - info.safeArea.bottom
          : 0;
        if (Number.isFinite(bottom) && bottom >= 0 && bottom <= 80)
          this.setData({ safeBottom: bottom });
      } catch {}
    },
    go(e) {
      if (this.properties.disabled) return;
      const key = e.currentTarget.dataset.key;
      // Video remains reachable from the homepage; legacy media pages belong to Events.
      const active = this.properties.active === 'Video' ? 'Events' : this.properties.active;
      if (Object.prototype.hasOwnProperty.call(destinations, key) && key !== active)
        wx.redirectTo({ url: destinations[key] });
    },
  },
});
