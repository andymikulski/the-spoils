## RQ-r03-1. Does a cost reduction lower what a Flip Up pays, or is the Flip Up cost already paid in full?
- Atoms: CR 406.7 (with CR 406.3, 406.6)
- Test: rules/r03-costs-effects.p2.test.ts "Flip Up with a cost reduction larger than the extras: the Flip Up cost is already paid, so does a reduction lower what is paid at all"
- Wording: "the running total begins once the Flip Up cost has been paid with an initial value of the card's Flip Up cost. ... Once you've finished satisfying the extra costs and all cost increases and reductions have been applied as normal, you must pay the balance of the numeric cost. To do this, take the final numeric cost and subtract the card's Flip Up cost (since you already paid it). Then, pay that amount."
- Readings:
  - A. The Flip Up cost is paid up front and is final. A reduction can only offset extra costs and increases that came after it; the balance (final total minus the Flip Up cost) is floored at 0 (CR 406.6), so a card with FLIP UP 3 and a "reduce the next numeric cost by 2" still pays the full 3, and the reduction is wasted (or only applies to extras).
  - B. The reduction lowers the final total, and the player effectively pays the final total: FLIP UP 3 reduced by 2 costs 1 in all.
  - Neither reading says what happens when the final numeric cost is below the Flip Up cost (the balance would be negative) or whether a reduction can be saved for a later cost.
- Engine does: reading B. FLIP UP 3 with a pending reduction of 2 pays 1 resource in total (the reduction is applied to the Flip Up cost before anything is attached).
- Recommendation: reading B matches how every other numeric cost behaves and Q30 (a Flip Up deploy is taxed and reduced like a deploy from hand), but 406.7's "since you already paid it" points to A. Needs a ruling. If A is chosen, 406.7's balance must floor at 0 and a reduction should not be consumed by a Flip Up it cannot reduce.

## RQ-r03-2. Does a standing tax create a numeric cost on an ability that has no pay instruction?
- Atoms: CR 406.4 (with CR 406.3 and CR 101.1)
- Test: rules/r03-costs-effects.p2.test.ts "an ability with no pay instruction has no numeric cost at all: does a standing 'opponents must pay 2 to use a character's ability' still make it cost 2"
- Wording: "An ability's numeric cost is handled in the same way as a card's numeric cost. But since abilities don't have a cost number, any ability without a pay instruction in its cost section is considered to not have a numeric cost at all."
- Readings:
  - A. The tax card's own text ("Your opponents must pay 2 to use a character's ability") is a pay instruction, and card text wins over the rules (CR 101.1), so the ability costs 2 even though it printed no pay instruction.
  - B. The ability has no numeric cost at all, so there is no running total to increase: the increase finds nothing to apply to and the ability costs 0.
- Engine does: reading A. The `abilityCostModifiers` tax (Department of Rejections) adds a numeric cost to an ability that printed none, and a pending "reduce the next numeric cost" then reduces it (numeric-cost.test.ts "an ability tax creates a cost when the ability printed none").
- Recommendation: reading A, because the tax is itself a pay instruction on the card that imposes it, and a "no numeric cost" ability without a tax stays free (tested in r03 as CR 406.4). Needs a ruling because 406.4 literally says such an ability has no numeric cost "at all".
