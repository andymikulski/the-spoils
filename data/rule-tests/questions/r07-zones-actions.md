## RQ-r07-1. What does "terminate an effect" cover beyond a card or ability on the stack?
- Atoms: CR 314.2 ("To terminate an effect is to stop it from having its impact on the game. You must not complete any of the effect's instructions.")
- Readings:
  - (a) An "effect" here is the instruction list of a card or ability that is still unresolved on the stack, so terminating it is the same stop as CR 314.1 (nothing of it happens). The last sentence ("you must not complete any of the effect's instructions") supports this: it speaks of instructions not yet completed.
  - (b) It can also be aimed at a lasting effect that has already resolved and is still in force (a "+2 strength this turn" modifier, a restriction, a replacement), ending its impact on the game from then on.
- Engine does: only (a). `terminate` removes unresolved stack items (`target`, `othersOnStack`, `respondedItem`); nothing ends an already-resolved lasting effect, and no card in the engine's vocabulary asks for that.
- Recommendation: (a), because CR 314.1 and 314.2 are written as two forms of the same stop-before-it-resolves, and the CR gives no way to name a resolved lasting effect as a target. If (b) is intended, an engine verb for it is needed. The `ruleOpen` test asserts reading (b) and stays `todo` until answered.
