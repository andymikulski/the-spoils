# Open questions: r05-abilities

## RQ-r05-abilities-1. Is parenthetical reminder text "italic text", and so not rules text, for a rule that reads a card's rules text (a [V] icon in its rules text)?
- Atoms: CR 501.1
- Rule: "Italic text is not considered part of a card's rules text. It is either a descriptive paragraph relating to the card's overall theme, or a reminder to help answer a common question about the card." Cards that read rules text ("a character with a [V] icon in its rules text", Marduun Ruins, Feckless Chronicler) should therefore ignore italic text.
- Readings:
  - A: reminder text (the `<reminder>` parts of a card's markup, printed in parentheses) is italic, so a [V] that appears only inside reminder text does not count as a [V] in the rules text.
  - B: only the flavor paragraph is italic; reminder text is part of the rules text for this purpose, so a [V] inside it counts.
- Engine: `textMentionsIcon` reads the card's markup projected to plain text with reminder text and ability parts included (a deliberate choice documented at `printedText` in SpoilsEngine.ts), so reading B. Flavor text and subtitle are ignored (a passing test covers this).
- Test: rules/r05-abilities.test.ts "[CR 501.1] italic reminder text is not rules text: a [V] only inside reminder text does not count as a [V] in the card's rules text" (written for reading A).
- Recommendation: A, if printed reminder text really is italic on the cards; then `printedText` should drop `<reminder>` nodes. The user can check one card with a [V] in a reminder.
