# Open questions: r06-keywords

## RQ-r06-keywords-1. When a cost reduction applies to a card deployed with Flip Up, is the Flip Up cost already paid refunded?
- Atoms: CR 507.4e (with CR 406.7, 406.6)
- Rule (406.7): the running total "begins once the Flip Up cost has been paid with an initial value of the card's Flip Up cost. ... Once you've finished satisfying the extra costs and all cost increases and reductions have been applied as normal, you must pay the balance of the numeric cost. To do this, take the final numeric cost and subtract the card's Flip Up cost (since you already paid it). Then, pay that amount."
- Case: Flip Up cost 2, a card that reduces the numeric cost of the controller's deploys by 1. The final numeric cost is 1; subtracting the 2 already paid gives -1.
- Readings:
  - A: the reduction lowers what is paid in total: 1 resource in all (the engine's behavior: the reduction is applied to the Flip Up cost itself).
  - B: the Flip Up cost was paid first and is not refunded; the balance cannot go below 0 (406.6), so 2 resources are paid in all.
- Engine: reading A (`flipUpNumericPay` runs the Flip Up cost through the deploy cost modifiers before paying anything).
- Test: rules/r06-keywords.p2.test.ts "[CR 507.4e] a cost reduction larger than the Flip Up cost's share: the Flip Up cost already paid is not refunded" (asserts B as a placeholder; it runs as `todo`).
- Recommendation: B follows the wording most literally ("since you already paid it"), but A is the more intuitive play pattern. Needs a ruling. Cost increases and "pay N" extra costs are not in question: they add to the running total in both readings (covered by passing tests).
