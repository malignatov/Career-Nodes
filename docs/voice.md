# Voice

How this app talks. One page, because a voice you can't hold in your head isn't a
voice — it's a style guide nobody follows.

The reader is in their twenties. Maybe a student who has never had a job, maybe five
years in and quietly stuck. They are smart, they are busy, and nobody has to be here.

## The nine rules

**1. Lead with what happens to them.** Never open with the theory. The old copy said
*"The premise, from career construction theory: early memories are not history…"* — a
lecture before you're allowed to speak. Say what they'll do, then why it works.

**2. Keep the insight, lose the citation.** The ideas are the best thing here. Deliver
them as a claim about the reader: *"The stories you reach for today say more about
today than about back then."* Not as a footnote to a book they haven't read.

**3. One idea per sentence.** Under twenty words when you can. Fragments are fine. The
old copy averaged forty-word sentences with three subordinate clauses.

**4. No process nouns.** Banned on screen: *artifact, induction, elicit, derive,
provisional, stimulus, protocol, node, macronarrative, vicarious environment.* If a
word would appear in a methods section, it doesn't appear in the UI. It stays in the
YAML and the transparency panel, where the method is supposed to be legible.

**5. Warmth is not hype.** No exclamation marks stacked on promises, no "transform your
life," no "unlock your potential." The credibility of this thing is its restraint. It
says exactly what it does, in a voice that sounds like a person.

**6. Every promise stays literally true.** Copy about verbatim quoting, authorization,
and "nothing moves without your yes" is describing enforced behavior, not marketing.
Rewrite the rhythm, never the guarantee.

**7. The instrument is not a style target.** The six anchor questions, the guardrails,
the extraction tasks, `done_when` — these are Savickas's, they're load-bearing, and they
are out of bounds. The engine already treats them that way: the opener is baked with no
model call, and translations are instructed to keep meaning intact. Everything wrapped
*around* the questions is ours.

**8. Match the moment.** The motto step can be light. Earliest memories cannot — that
one stays quiet, slow, and careful, and the skip offer is never buried. The closing is
allowed to feel like something. A single voice does not mean a single volume.

**9. Second person, present tense, active.** "You'll talk about three people" beats
"Three figures will be discussed." "We write down what you say" beats "This step only
records and organizes your own words."

## Russian is a rewrite, not a translation

RU is a first-class surface, not a localization afterthought. Rules that hold:

- The «ты» register throughout, warm and informal — already settled, already in
  `SESSION_LANGS.ru.instruction`.
- No gendered past-tense forms; the reader's gender is unknown.
- No calques. If the English is idiomatic, the Russian gets its own idiom, not a
  word-for-word tracing of the English one.
- Established psych terminology stays where it earns its place. Names that were settled
  deliberately (Формула успеха, Жизненный портрет) are not casualties of a tone pass.

## The test

Read it aloud. If you'd feel embarrassed saying it to a friend who asked what this app
does, rewrite it. If it sounds like it was written by an institution, rewrite it. If it
promises something the code doesn't enforce, it doesn't ship.
