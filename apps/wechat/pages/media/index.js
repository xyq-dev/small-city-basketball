const api = require('../../utils/api');
const ui = require('../../utils/ui');
const recent = require('../../utils/recent');

// Media is only what organizers explicitly published under a still-valid public event.
// This tab lists events opened on this device and goes straight to their video section.
Page({
  data: { recentEvents: [], featuredEvent: null },
  onShow() {
    const recentEvents = recent.list();
    this.setData({ recentEvents, featuredEvent: recentEvents[0] || null });
  },
  openRecent(e) {
    try {
      ui.open('event', { event: api.publicId(e.currentTarget.dataset.id), tab: 'media' });
    } catch {
      this.setData({ recentEvents: recent.list() });
    }
  },
  open() {
    wx.redirectTo({ url: '/pages/watch/index' });
  },
  openFeatured() {
    const event = this.data.featuredEvent;
    if (!event) return this.open();
    this.openRecent({ currentTarget: { dataset: { id: event.publicEventId } } });
  },
});
