## RQ-r11-1. How should the engine represent Constructed vs Limited deck construction (75 / 40 minimum, copy limit)?
- Atoms: CR 103.1b, 103.2b, 103.2c
- The rule: a Constructed deck needs at least 75 cards (not counting the faction card) and at most 4 copies of a card; a Limited deck needs at least 40 cards and has no copy limit (103.1b/c, 103.2b/c).
- Engine today: `findDeckConstructionIssues` has no format notion. It always applies the 4-copy limit, and it applies a minimum size only when the caller passes `minimumSize` or the faction prints `minimumDeckSize`. Called with no options, a 60-card deck has no issue, and there is no way to ask for Limited (5 copies of a card are always a `copyLimit` issue). The header of `deckRules.ts` says "RULES.md has no general minimum", while the Comprehensive Rules do state one (75 / 40).
- Readings: (A) the engine owns the formats: a `format: "constructed" | "limited"` option with defaults 75 / 40 and the copy limit switched off for Limited. (B) Formats are policy of the host application (lobby / server), which passes `minimumSize` itself and handles the copy limit, so the engine's behavior is as intended.
- Tested today: with `minimumSize` passed explicitly, 74 / 75 and 39 / 40 behave correctly, the faction card is not counted and there is no maximum (those are `rule` tests). The two `ruleOpen` tests state reading A (no copy limit in Limited; 75 default minimum) and run as `todo`.
- Recommendation: reading A for the copy limit (the rules differ by format and the engine already hosts the Constructed rules), with the format defaulting to Constructed.

## RQ-r11-3. In a bid, if the first bidder passes, does the remaining player win without bidding, and what if both pass?
- Atoms: CR 413.1
- The rule: "Bidding continues until only 1 player remains, that player wins the bid. All other players lose the bid." A player who passes may not bid again (413.1b).
- Engine today (Auction House): the first bidder passing does NOT end the bidding. The other player is still asked and must make a bid of at least 1 to win (the winner pays the bid). If both pass, nobody wins: the character returns to the deck.
- Readings: (A) once the first bidder passes only one player remains, who wins the bid at once; what they pay is then undefined by CR 413 (the Auction House text says the winning bidder pays the winning bid, so possibly 0). (B) The remaining player must still name a winning number, because a bid has to be higher than the last number and a pass is not a number.
- Both pass: CR 413.1 has no answer (no player remains); the engine leaves the character in the deck.
- Recommendation: reading B for the price (a winner always names the number they pay), but confirm whether the sole remaining bidder may win for 0, and confirm that "everyone passes, nobody wins" is right.
