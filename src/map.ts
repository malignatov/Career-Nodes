export interface MapNode {
  id: string;
  title: string;
  sector: number;
  kind: "conversation" | "derived";
  desc: string;
  hint?: string;
  skippable?: boolean;
}

export interface MapSector {
  n: number;
  label: string;
}

export const MAP_SECTORS: MapSector[] = [
  { n: 1, label: "Phase 1 · Goal" },
  { n: 2, label: "Phase 2 · Interview" },
  { n: 3, label: "Phase 3 · Induction" },
  { n: 4, label: "Phase 4 · Portrait & intention" },
  { n: 5, label: "Phase 5 · Action" },
];

export const MAP_NODES: MapNode[] = [
  {
    id: "counseling_goal", title: "Goal setting", sector: 1, kind: "conversation",
    desc: "State what you want from this process — it guides everything that follows.",
    hint: "↳ guides every derived step · never your recorded interviews",
  },
  {
    id: "role_models", title: "Role models", sector: 2, kind: "conversation",
    desc: "Three figures you admired as a child — the blueprint you built yourself from.",
  },
  {
    id: "favorite_media", title: "Favorite media", sector: 2, kind: "conversation",
    desc: "The shows, sites, or magazines you keep returning to — your preferred settings.",
  },
  {
    id: "favorite_story", title: "Favorite story", sector: 2, kind: "conversation",
    desc: "Your current favorite story, retold in your words — the script for your next chapter.",
  },
  {
    id: "motto", title: "Motto", sector: 2, kind: "conversation",
    desc: "Your favorite saying — the best advice you have for yourself.",
  },
  {
    id: "early_recollections", title: "Early recollections", sector: 2, kind: "conversation",
    desc: "Three early memories with feelings and headlines — your perspective on today.",
    skippable: true,
  },
  {
    id: "perspective", title: "Perspective", sector: 3, kind: "derived",
    desc: "The vantage point your early stories reveal about the current transition.",
  },
  {
    id: "character_sketch", title: "Character sketch", sector: 3, kind: "derived",
    desc: "Who you are, in your own admired words — the self as a constructed solution.",
  },
  {
    id: "preferred_settings", title: "Preferred settings", sector: 3, kind: "derived",
    desc: "The places, people, and problems you gravitate toward.",
  },
  {
    id: "script", title: "Script", sector: 3, kind: "derived",
    desc: "How your self meets your setting — the storyline you are drawn to enact.",
  },
  {
    id: "advice_to_self", title: "Advice to self", sector: 3, kind: "derived",
    desc: "Your motto unpacked into the call to action it already contains.",
  },
  {
    id: "life_portrait", title: "Life portrait", sector: 4, kind: "derived",
    desc: "The six-part identity narrative assembled from everything you authorized.",
    hint: "· uses all inductions + goal",
  },
  {
    id: "identity_statement", title: "Identity statement", sector: 4, kind: "derived",
    desc: "Your success formula, in one sentence of your own words.",
  },
  {
    id: "action_recipe", title: "Action recipe", sector: 5, kind: "derived",
    desc: "Concrete exploration steps that carry your intention into the world.",
  },
  {
    id: "closing_check", title: "Closing check", sector: 5, kind: "derived",
    desc: "Did we get there? Your goal is read back, and your motto is returned to you.",
    hint: "· reads your goal back, verbatim",
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
