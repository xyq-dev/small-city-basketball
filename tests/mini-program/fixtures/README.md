# Synthetic mini-program layout states

These portable JSON files contain only `{ name, route, data }`. The compatibility
preview merges `data` into the actual registered Page state and renders the
repository's real WXML/WXSS. These are offline layout samples, not production
records or proof of WeChat runtime behavior. Names and descriptions explicitly
identify synthetic content; no credentials, private records, remote assets or
machine-specific source paths are included.

| Fixture                      | Source and visible state                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `players-filters`            | Actual player Page, SDK validation and player-market conversion: two same-price players, open filters, different travel costs and statistics.                                                                         |
| `player-records-zero`        | Actual player Page and player-market conversion: expanded records preserve a real zero separately from uncollected values.                                                                                            |
| `player-no-statistics`       | Actual player Page and player-market conversion: no authorized personal statistics.                                                                                                                                   |
| `compare-three`              | Actual compare Page and player-market comparison model: three columns, including a player without statistics. The derived `tableHeight` follows the current Page formula, `64 + labels.length * 64 + 128`, in pixels. |
| `booking-create-tournament`  | Actual booking-create Page `renderForm` and booking-form quote model: two selected players, a fixed match and a conditional advancement intention.                                                                    |
| `booking-create-review`      | The same actual form output in the review branch, including the local named fees template.                                                                                                                            |
| `bookings-mixed-status`      | Actual booking-orders `decorateOrder` output: accepted and conditional appearances, with payment unavailable.                                                                                                         |
| `booking-detail-change-form` | Actual booking-orders `decorateOrder` and `form` output: per-appearance actions and a proposed schedule change with a reason.                                                                                         |
| `player-center-edit`         | Actual player-center Page decoration, `formFromProfile` and `updateQuote`: profile editing, two availability windows and a fee breakdown.                                                                             |

The explicit booking consent, command confirmation and adult declaration fields
remain `false`; the detail form also keeps `canSubmit: false`. Player comparison
selection only marks players for comparison and does not imply agreement to a
booking. Quoted amounts are synthetic, and all collected, refunded and settled
amounts are zero. No fixture executes a network request or submits an action.
