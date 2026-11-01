Component({
  properties: {
    items: { type: Array, value: [] },
    current: { type: String, value: '' },
    busy: { type: Boolean, value: false },
  },
  methods: {
    choose(e) {
      if (this.properties.busy) return;
      const index = Number(e.currentTarget.dataset.index);
      const item = this.properties.items[index];
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        !item ||
        typeof item.key !== 'string' ||
        item.disabled ||
        item.key === this.properties.current
      )
        return;
      this.triggerEvent('change', { key: item.key, index });
    },
  },
});
