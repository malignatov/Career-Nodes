/**
 * The dictation turn buffer — what turns streaming transcription events into
 * the text of an input field. Pure, so the one bug it exists to prevent stays
 * testable: words the client already SENT must never repaint into the field.
 *
 * The stream's shape makes that easy to get wrong. Deltas append; the final
 * for an utterance carries the WHOLE utterance again. So when a message is
 * sent mid-utterance, clearing the input is not enough — the rest of that
 * utterance's events, final included, would put the sent words back. sent()
 * marks the in-flight utterance consumed: the remainder of it is dropped, and
 * the next utterance starts from whatever the field then holds.
 */
export function makeVoiceBuffer() {
  let itemId = null;   // the utterance currently streaming
  let base = "";       // what the field held when it began
  let turn = "";       // the utterance's accumulated text
  let spent = null;    // an utterance whose text was sent — ignore its rest

  return {
    /** New field text for a transcription event, or null to leave it alone. */
    insert(item, text, isFinal, current) {
      if (item === spent) return null;
      if (itemId !== item) {
        itemId = item;
        turn = "";
        base = current && !/\s$/.test(current) ? `${current} ` : current;
      }
      turn = isFinal ? text : turn + text;
      const out = base + turn;
      if (isFinal) itemId = null;
      return out;
    },

    /** The composer cleared after a send: nothing of this turn survives. */
    sent() {
      if (itemId !== null) spent = itemId;
      itemId = null;
      base = "";
      turn = "";
    },
  };
}
