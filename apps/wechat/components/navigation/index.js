const destinations = {
  Home: '/pages/home/index',
  Events: '/pages/watch/index',
  Video: '/pages/media/index',
  Account: '/pages/account/index',
};
Component({
  properties: { active: { type: String, value: 'Home' } },
  data: {
    items: [
      { key: 'Home', label: '首页' },
      { key: 'Events', label: '赛事' },
      { key: 'Video', label: '视频' },
      { key: 'Account', label: '我的' },
    ],
  },
  methods: {
    go(e) {
      const key = e.currentTarget.dataset.key;
      if (destinations[key] && key !== this.properties.active)
        wx.redirectTo({ url: destinations[key] });
    },
  },
});
