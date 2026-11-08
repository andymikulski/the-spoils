## RQ-mp-8. In a battle window, where does "the other players clockwise" start?
- Atoms: MPX-battle-window (CR 608.1c, 609.1a, 609.1e)
- The rule: the user's ruling RQ-mp-2 says that in battle "the attacker acts first, then the defender, then the other players clockwise". CR 608.1c, 609.1a and 609.1e only name the attacking and defending players.
- Gap: the ruling does not say which seat the "other players clockwise" order starts from. With exactly one other player (3 seats) it makes no difference. With two or more others (4+ seats) the order can differ when the defender is not next to the attacker. Example, seats 1 to 4 clockwise, attacker in seat 1, defender in seat 3: starting after the defender gives seat 4 then seat 2; starting after the attacker gives seat 2 then seat 4.
- Readings: (A) continue clockwise from the defender: the other players in the order of the seats after the defender, skipping the attacker. (B) Start clockwise after the attacker, skipping the defender.
- Tested: the attacker-then-defender part and the 3-seat case are `rule` tests; the 4-seat order of the other players is a `ruleOpen` test.
- Recommendation: reading A. The ruling lists the order as attacker, defender, then the rest, and reading A simply continues the circle from the last named player. It does not change anything at 3 seats.

## RQ-mp-9. What happens to triggers waiting to resolve that an eliminated player controls?
- Atoms: MPX-elim, MPX-elim-timing
- The rules: RQ-mp-3 removes an eliminated player's stack items and pending choices, ends their lasting effects, and removes the cards they own from the game. CR 503.2: triggers are not stack items and cannot be responded to. CR 503.1: a trigger is followed "even if ... the source of the trigger has left play". The elimination-timing ruling says elimination comes before any trigger the unit set off.
- Gap: a trigger set off by the same unit that eliminated a player can belong to that player (for example a "when this card leaves play" trigger on a card they own, or a "when your faction loses influence" trigger). The rulings do not say whether such a waiting trigger is followed or removed.
- Readings: (A) it is removed with the rest of what waits on the player, because the player takes no further actions and their cards have left the game. (B) It is still followed, because CR 503.1 says a trigger is followed even when its source has left play, and a trigger is not an action the player takes.
- Tested: not yet written; once answered, one `rule` test per outcome.
- Recommendation: reading A, in line with "if a player hits 0 faction they basically shouldn't be able to respond or anything".

## RQ-mp-10. If the controller of a card with lasting "your opponent" text changes, does the new controller select the opponent again?
- Atoms: MPX-lasting
- The rules: RQ-mp-5 says the opponent for lasting text is chosen when the effect starts applying, lasts as long as the effect, and is chosen again if that player is eliminated. CR 407.2: "you" and "your" in rules text always mean the card's current controller. CR 407.3 and 407.3a: control of a card can change while it stays in play (Emergency Obfuscation, control-stealing effects).
- Gap: RQ-mp-5 does not say what happens when the card's controller changes while its continuous text (Mud Prison, Underdog, Silencer and others) keeps applying. The old selection may have been made by another player, and the old selected opponent may be the new controller.
- Readings: (A) the effect starts applying under the new controller, so the new controller selects an opponent then (the old selection ends). (B) The old selection stays, unless the selected opponent is now the controller, in which case the new controller selects again.
- Tested: not yet written; once answered, a `rule` test per outcome at 3 seats.
- Recommendation: reading A: "your" always means the current controller (CR 407.2), so the effect is the new controller's from the moment control changes.

## RQ-mp-11. In a multi-player action loop the active player is not involved in, who chooses?
- Atoms: MPX-loop (CR 414.3b, 414.3c)
- The rules: CR 414.3b: "The active player chooses a number, followed by their opponent." CR 414.3c: "During the last repetition of the loop, the active player may choose any point in the loop at which to stop." Both assume the active player takes part in the loop.
- Gap: with three or more players, a voluntary loop can involve two players who are both not the active player (for example repeated responses between them). The wording then has no player to start the numbers or to choose the stopping point.
- Readings: (A) only involved players choose, in clockwise order starting from the active player's seat (so the first involved player clockwise from the active player goes first), and the first of them chooses the stopping point in the last repetition. (B) The active player chooses a number and the stopping point anyway, although not part of the loop.
- Tested: not yet written; the case where the active player is involved is a `rule` test, the other case a `ruleOpen` test. The engine does not implement voluntary loop shortcuts today.
- Recommendation: reading A. It keeps the order of CR 414.3b (active player's position first, then clockwise) and gives the stopping point to a player who actually acts in the loop. This question does not block the engine work for seats, elimination, setup or response windows.
