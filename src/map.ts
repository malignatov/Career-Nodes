export interface MapNode {
  id: string;
  title: string;
  sector: number;
  kind: "conversation" | "derived";
  x: number;
  y: number;
}

export interface MapSector {
  n: number;
  label: string;
  y0: number;
  y1: number;
}

export const MAP_SECTORS: MapSector[] = [
  { n: 1, label: "1 · Set the goal", y0: 30, y1: 115 },
  { n: 2, label: "2 · Career construction interview", y0: 135, y1: 330 },
  { n: 3, label: "3 · Induction", y0: 350, y1: 585 },
  { n: 4, label: "4 · Portrait & intention", y0: 605, y1: 790 },
  { n: 5, label: "5 · Action", y0: 810, y1: 990 },
];

export const MAP_NODES: MapNode[] = [
  { id: "counseling_goal", title: "Counseling goal", sector: 1, kind: "conversation", x: 340, y: 75 },

  { id: "role_models", title: "Role models", sector: 2, kind: "conversation", x: 140, y: 195 },
  { id: "favorite_media", title: "Favorite media", sector: 2, kind: "conversation", x: 340, y: 195 },
  { id: "favorite_story", title: "Favorite story", sector: 2, kind: "conversation", x: 540, y: 195 },
  { id: "motto", title: "Motto", sector: 2, kind: "conversation", x: 240, y: 280 },
  { id: "early_recollections", title: "Early recollections", sector: 2, kind: "conversation", x: 440, y: 280 },

  { id: "character_sketch", title: "Character sketch", sector: 3, kind: "derived", x: 140, y: 425 },
  { id: "preferred_settings", title: "Preferred settings", sector: 3, kind: "derived", x: 340, y: 425 },
  { id: "script", title: "Script", sector: 3, kind: "derived", x: 540, y: 425 },
  { id: "advice_to_self", title: "Advice to self", sector: 3, kind: "derived", x: 240, y: 520 },
  { id: "perspective", title: "Perspective", sector: 3, kind: "derived", x: 440, y: 520 },

  { id: "life_portrait", title: "Life portrait", sector: 4, kind: "derived", x: 340, y: 660 },
  { id: "identity_statement", title: "Identity statement", sector: 4, kind: "derived", x: 340, y: 745 },

  { id: "action_recipe", title: "Action recipe", sector: 5, kind: "derived", x: 340, y: 865 },
  { id: "closing_check", title: "Closing check", sector: 5, kind: "derived", x: 340, y: 945 },
];

export const MAP_EDGES: [string, string][] = [
  ["counseling_goal", "role_models"],
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
