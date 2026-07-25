export interface MapNode {
  id: string;
  title: string;
  sector: number;
  kind: "conversation" | "derived";
  desc: string;
  hint?: string;
  skippable?: boolean;
  /** Honest expectation-setter: rough minutes of the user's own time. */
  minutes: number;
}

export interface MapSector {
  n: number;
  label: string;
}

// The label's last "·"-separated segment is the phase name shown in the braid
// header counter (braid.js: phaseLabel(sec).split("·").pop()). Keep the shape.
export const MAP_SECTORS: MapSector[] = [
  { n: 1, label: "1 · Why you're here" },
  { n: 2, label: "2 · Your stories" },
  { n: 3, label: "3 · What they mean" },
  { n: 4, label: "4 · The whole picture" },
  { n: 5, label: "5 · What you do next" },
];

export const MAP_NODES: MapNode[] = [
  {
    id: "counseling_goal", minutes: 5, title: "What you're here for", sector: 1, kind: "conversation",
    desc: "Say what you want out of this. It shapes everything that comes after.",
    hint: "↳ shapes everything built later · never your recorded conversations",
  },
  {
    id: "role_models", minutes: 10, title: "Who you looked up to", sector: 2, kind: "conversation",
    desc: "Three people you admired at about six — the blueprint you built yourself from.",
  },
  {
    id: "favorite_media", minutes: 5, title: "What you're into", sector: 2, kind: "conversation",
    desc: "Two or three shows, channels, or sites you keep going back to.",
  },
  {
    id: "favorite_story", minutes: 5, title: "Your favorite story", sector: 2, kind: "conversation",
    desc: "One story, retold your way — the plot your next chapter borrows from.",
  },
  {
    id: "motto", minutes: 2, title: "Your motto", sector: 2, kind: "conversation",
    desc: "The saying you live by. It's usually advice you gave yourself.",
  },
  {
    id: "early_recollections", minutes: 10, title: "Earliest memories", sector: 2, kind: "conversation",
    desc: "Three early memories, what you felt in each, and a headline for it.",
    skippable: true,
  },
  {
    id: "perspective", minutes: 2, title: "How you see it", sector: 3, kind: "derived",
    desc: "The angle your earliest stories reveal about where you are now.",
  },
  {
    id: "character_sketch", minutes: 2, title: "Who you are", sector: 3, kind: "derived",
    desc: "You, described in the words you used for the people you admired.",
  },
  {
    id: "preferred_settings", minutes: 2, title: "Your kind of place", sector: 3, kind: "derived",
    desc: "The places, people, and problems you're drawn to.",
  },
  {
    id: "script", minutes: 2, title: "The story you're in", sector: 3, kind: "derived",
    desc: "What happens when the person you are meets the place you want to be.",
  },
  {
    id: "advice_to_self", minutes: 2, title: "Your own advice", sector: 3, kind: "derived",
    desc: "Your motto, unpacked into the instruction it's been giving you.",
  },
  {
    id: "life_portrait", minutes: 3, title: "Your portrait", sector: 4, kind: "derived",
    desc: "Everything you've approved, assembled into one story in six parts.",
    hint: "· built from everything above",
  },
  {
    id: "identity_statement", minutes: 2, title: "Your success formula", sector: 4, kind: "derived",
    desc: "One sentence, in your words, for what makes all of this worth it.",
  },
  {
    id: "action_recipe", minutes: 3, title: "Your first moves", sector: 5, kind: "derived",
    desc: "Real steps for next week — small enough that you'll actually take them.",
  },
  {
    id: "closing_check", minutes: 5, title: "Did we get there?", sector: 5, kind: "conversation",
    desc: "Your goal, read back word for word. You're the one who decides.",
    hint: "· your words, read back exactly",
  },
];

/** Derivation edges: [from, to] — `to` consumes `from`. */
export const MAP_EDGES: [string, string][] = [
  ["counseling_goal", "role_models"],
  ["counseling_goal", "favorite_media"],
  ["counseling_goal", "favorite_story"],
  ["counseling_goal", "motto"],
  ["counseling_goal", "early_recollections"],
  ["role_models", "character_sketch"],
  ["favorite_media", "preferred_settings"],
  ["favorite_story", "script"],
  ["motto", "advice_to_self"],
  ["early_recollections", "perspective"],
  ["perspective", "character_sketch"],
  ["character_sketch", "script"],
  ["character_sketch", "life_portrait"],
  ["preferred_settings", "life_portrait"],
  ["script", "life_portrait"],
  ["advice_to_self", "life_portrait"],
  ["perspective", "life_portrait"],
  ["life_portrait", "identity_statement"],
  ["identity_statement", "action_recipe"],
  ["action_recipe", "closing_check"],
];
