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
    items: [
      { key: 'Home', label: '首页', icon: 'home' },
      { key: 'Events', label: '赛事', icon: 'trophy' },
      { key: 'Local', label: '同城', icon: 'pin' },
      { key: 'Teams', label: '球队', icon: 'users' },
      { key: 'Account', label: '我的', icon: 'user' },
    ],
  },
  methods: {
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
