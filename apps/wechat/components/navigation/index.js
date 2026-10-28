const destinations = {
  Home: '/pages/home/index',
  Events: '/pages/watch/index',
  Video: '/pages/media/index',
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
    items: [
      { key: 'Home', label: '首页', icon: 'home' },
      { key: 'Events', label: '赛事', icon: 'trophy' },
      { key: 'Video', label: '视频', icon: 'play' },
      { key: 'Account', label: '我的', icon: 'user' },
    ],
  },
  methods: {
    go(e) {
      if (this.properties.disabled) return;
      const key = e.currentTarget.dataset.key;
      if (Object.prototype.hasOwnProperty.call(destinations, key) && key !== this.properties.active)
        wx.redirectTo({ url: destinations[key] });
    },
  },
});
