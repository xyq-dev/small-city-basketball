Component({
  options: { multipleSlots: true },
  properties: {
    variant: { type: String, value: 'orange' },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    block: { type: Boolean, value: true },
    ariaLabel: { type: String, value: '' },
    openType: { type: String, value: '' },
  },
  methods: {
    action() {
      if (!this.properties.disabled && !this.properties.loading) this.triggerEvent('action');
    },
  },
});
