Component({
  properties: {
    key1: { type: String, value: '' },
    label1: { type: String, value: '' },
    key2: { type: String, value: '' },
    label2: { type: String, value: '' },
    key3: { type: String, value: '' },
    label3: { type: String, value: '' },
    key4: { type: String, value: '' },
    label4: { type: String, value: '' },
    active: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    change(e) {
      if (!this.properties.disabled)
        this.triggerEvent('change', { key: e.currentTarget.dataset.key });
    },
  },
});
