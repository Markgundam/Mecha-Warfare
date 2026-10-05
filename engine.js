/* Mecha Warfare — rules engine (no DOM). Loaded by index.html and by sim.js under Node. */
(function (root) {
'use strict';

let W = 9, H = 7;   // set by the map in play
const C = {
  EP: 5, START_SUPPLY: 10, INCOME: 4, DEPOT: 2, BASE_HP: 20,
  HAND_START: 4, DRAW: 2, WORKSHOP_MAX: 10, FIELD_MAX: 3, HANGAR_MAX: 3,
  AP: 2, TURRET_DMG: 3, TURRET_RANGE: 3, SCRAP: 2, SALVAGE_CHANCE: 0.6,
  STATION_REPAIR: 2, RADAR_ACC: 5, ENTRENCH_ARMOR: 1, CATCHUP: 2,
  VP_WIN: 12, CRATE_EVERY: 2, CRATE_SUPPLY: 4,
  DEPOT_FULL: 2, DEPOT_EXTRA: 1,     // depots past the first DEPOT_FULL pay DEPOT_EXTRA instead of DEPOT
  CATCHUP_PER_VP: 1, CATCHUP_MAX: 4,  // trailing bonus grows with the points gap, up to the cap
  BASE_VP_PER: 4,                     // every this much damage dealt to the enemy base is worth a victory point (0 = off)
  VP_ROUND_CAP: 2,                    // most victory points one side can score from objectives in a round (0 = no cap)
  LEAD_GAP: 2, LEAD_CAP: 1, LEAD_UNTIL: 99, // once ahead by LEAD_GAP points, objectives earn at most LEAD_CAP a round, up to round LEAD_UNTIL
  START_ARMS: 'all',                  // opening mecha: 'lead' arms only the first in both mounts, 'all' arms every mount that fits
  REQ_COST: 5,                        // supply to requisition one extra card from the Arsenal during the build (0 = off)
  BOUNTY: 0                           // points the trailing side earns per kill on the leader (0 = off)
};

/* ---------- Components ---------- */
const DEFS = {};
[
  // Standard issue: always available, unlimited
  { id: 'b_torso', name: 'Standard Frame', slot: 'torso', basic: true, cost: 3, wt: 4, en: 0, hp: 7, auxSlots: 1, heatCap: 6 },
  { id: 'b_core', name: 'Fission Cell', slot: 'core', basic: true, cost: 2, wt: 2, hp: 4, power: 6, cooling: 2 },
  { id: 'b_legs', name: 'Biped Walker', slot: 'legs', basic: true, cost: 2, hp: 6, capacity: 12, move: 3 },
  { id: 'b_gun', name: 'Autocannon', slot: 'arm', basic: true, cost: 2, wt: 2, en: 1, hp: 3, weapon: { dmg: 2, range: 3, acc: 75, heat: 1 } },

  // Frames: torso and sensor head in one
  { id: 't_heavy', name: 'Heavy Torso', slot: 'torso', cost: 5, wt: 6, hp: 10, armor: 2, auxSlots: 2, heatCap: 7 },
  { id: 't_light', name: 'Light Frame', slot: 'torso', cost: 3, wt: 2, hp: 5, auxSlots: 1, heatCap: 5, move: 1 },
  { id: 't_assault', name: 'Assault Chassis', slot: 'torso', cost: 4, wt: 4, hp: 6, auxSlots: 2, heatCap: 8 },
  { id: 't_fortress', name: 'Fortress Hull', slot: 'torso', cost: 6, wt: 9, hp: 13, armor: 2, auxSlots: 2, heatCap: 7 },
  { id: 't_proto', name: 'Prototype Shell', slot: 'torso', cost: 4, wt: 3, hp: 7, auxSlots: 3, heatCap: 6 },

  // Cores
  { id: 'c_heavy', name: 'Heavy Reactor', slot: 'core', cost: 5, wt: 5, hp: 6, power: 12, cooling: 2, passiveHeat: 1 },
  { id: 'c_compact', name: 'Compact Cell', slot: 'core', cost: 3, wt: 1, hp: 3, power: 5, cooling: 3 },
  { id: 'c_fusion', name: 'Fusion Core', slot: 'core', cost: 5, wt: 3, hp: 5, power: 9, cooling: 3 },
  { id: 'c_sing', name: 'Singularity Core', slot: 'core', cost: 4, wt: 2, hp: 3, power: 14, cooling: 1, passiveHeat: 1, breach: 4 },

  // Legs
  { id: 'l_boost', name: 'Booster Legs', slot: 'legs', cost: 4, en: 2, hp: 4, capacity: 9, move: 4, moveHeat: 1 },
  { id: 'l_treads', name: 'Heavy Treads', slot: 'legs', cost: 4, hp: 10, capacity: 24, move: 3, armor: 1 },
  { id: 'l_quad', name: 'Quad Walker', slot: 'legs', cost: 5, hp: 8, capacity: 18, move: 3 },
  { id: 'l_hover', name: 'Hover Skirt', slot: 'legs', cost: 4, en: 3, hp: 4, capacity: 11, move: 4 },
  { id: 'l_biped', name: 'Reinforced Biped', slot: 'legs', cost: 3, hp: 7, capacity: 15, move: 3 },

  // Arms
  { id: 'w_blade', name: 'Plasma Blade', slot: 'arm', cost: 3, wt: 2, en: 2, hp: 4, weapon: { dmg: 4, range: 1, acc: 80, heat: 1, ap: true, melee: true } },
  { id: 'w_rail', name: 'Heavy Rail Cannon', slot: 'arm', cost: 6, wt: 6, en: 4, hp: 4, weapon: { dmg: 5, range: 6, acc: 80, heat: 3, ap: true, ammo: 5 } },
  { id: 'w_missile', name: 'Missile Rack', slot: 'arm', cost: 4, wt: 3, en: 1, hp: 3, weapon: { dmg: 3, range: 5, min: 2, acc: 70, heat: 2, indirect: true, ammo: 4 } },
  { id: 'w_howitzer', name: 'Howitzer', slot: 'arm', cost: 6, wt: 7, en: 1, hp: 4, weapon: { dmg: 4, range: 6, min: 3, acc: 65, heat: 2, indirect: true, siege: 1.5, ammo: 4 } },
  { id: 'w_ram', name: 'Siege Ram', slot: 'arm', cost: 4, wt: 4, en: 2, hp: 5, weapon: { dmg: 3, range: 1, acc: 90, heat: 1, siege: 2, melee: true } },
  { id: 'w_laser', name: 'Laser Rifle', slot: 'arm', cost: 4, wt: 2, en: 3, hp: 3, weapon: { dmg: 3, range: 4, acc: 85, heat: 2 } },
  { id: 'w_scatter', name: 'Scatter Cannon', slot: 'arm', cost: 3, wt: 3, en: 1, hp: 3, weapon: { dmg: 3, range: 2, acc: 85, heat: 1 } },
  { id: 'w_gatling', name: 'Gatling Gun', slot: 'arm', cost: 4, wt: 3, en: 1, hp: 3, weapon: { dmg: 2, range: 3, acc: 75, heat: 2, shots: 2 } },
  { id: 'w_shield', name: 'Tower Shield', slot: 'arm', cost: 3, wt: 4, en: 0, hp: 8, armorAll: 1 },
  { id: 'w_lance', name: 'Particle Lance', slot: 'arm', cost: 6, wt: 4, en: 6, hp: 3, weapon: { dmg: 5, range: 5, acc: 75, heat: 4, ap: true } },
  { id: 'w_arc', name: 'Arc Projector', slot: 'arm', cost: 4, wt: 3, en: 4, hp: 3, weapon: { dmg: 3, range: 3, acc: 85, heat: 2, heatDmg: 2 } },
  { id: 'w_repair', name: 'Repair Arm', slot: 'arm', cost: 3, wt: 2, en: 2, hp: 3, weapon: { repair: 3, range: 1, heat: 1 } },

  // Special components: rare, stronger, some inflict status effects
  { id: 's_inferno', name: 'Inferno Cannon', slot: 'arm', special: true, cost: 6, wt: 3, en: 2, hp: 5, weapon: { dmg: 4, range: 3, acc: 85, heat: 2, burn: 3 } },
  { id: 's_cryo', name: 'Cryo Lance', slot: 'arm', special: true, cost: 6, wt: 3, en: 3, hp: 5, weapon: { dmg: 4, range: 4, acc: 85, heat: 1, slow: 2 } },
  { id: 's_emp', name: 'EMP Projector', slot: 'arm', special: true, cost: 6, wt: 3, en: 4, hp: 4, weapon: { dmg: 3, range: 4, acc: 85, heat: 2, shock: true } },
  { id: 's_railgun', name: 'Heavy Railgun', slot: 'arm', special: true, cost: 8, wt: 8, en: 5, hp: 6, weapon: { dmg: 7, range: 8, acc: 90, heat: 3, ap: true, ammo: 4, needsEntrench: true } },
  { id: 's_anchor', name: 'Siege Anchors', slot: 'legs', special: true, cost: 6, hp: 16, armor: 2, capacity: 26, move: 2, entrench: true, hull: 6 },
  { id: 's_frame', name: 'Aegis Frame', slot: 'torso', special: true, cost: 7, wt: 6, hp: 13, armor: 1, auxSlots: 3, heatCap: 9 },
  { id: 's_core', name: 'Lattice Core', slot: 'core', special: true, cost: 6, wt: 2, hp: 7, power: 13, cooling: 4 },

  // Auxiliary systems
  { id: 'a_cool', name: 'Cooling System', slot: 'aux', cost: 2, wt: 1, en: 1, cooling: 2 },
  { id: 'a_sink', name: 'Heat Sink', slot: 'aux', cost: 1, wt: 1, en: 0, heatCap: 3 },
  { id: 'a_plate', name: 'Armor Plating', slot: 'aux', cost: 3, wt: 3, en: 0, armorAll: 1 },
  { id: 'a_jump', name: 'Jump Booster', slot: 'aux', cost: 3, wt: 1, en: 2, move: 1, moveHeat: 1 },
  { id: 'a_apu', name: 'Auxiliary Power Unit', slot: 'aux', cost: 2, wt: 2, power: 4 },
  { id: 'a_nano', name: 'Nano-Repair Module', slot: 'aux', cost: 4, wt: 1, en: 3, selfRepair: 1 },
  { id: 'a_servo', name: 'Servo Struts', slot: 'aux', cost: 2, wt: 0, en: 1, capacity: 4 },
  { id: 'a_shield', name: 'Shield Generator', slot: 'aux', cost: 4, wt: 2, en: 4, shield: 3 },
  { id: 'a_over', name: 'Overcharger', slot: 'aux', cost: 3, wt: 1, en: 0, dmgBonus: 1, shotHeat: 1 },

  // Events: take effect as soon as they are drawn
  { id: 'x_supply', name: 'Supply Drop', slot: 'event', cost: 0, event: { supply: 4 } },
  // doctrine signature cards
  { id: 't_skirm', name: 'Skirmisher Frame', slot: 'torso', cost: 2, wt: 1, hp: 4, auxSlots: 1, heatCap: 5, move: 1 },
  { id: 'w_smg', name: 'Twin SMGs', slot: 'arm', cost: 2, wt: 1, en: 1, hp: 3, weapon: { dmg: 2, range: 2, acc: 72, heat: 1, shots: 2 } },
  { id: 'a_bulwark', name: 'Bulwark Plating', slot: 'aux', cost: 3, wt: 3, plate: 4 },
  { id: 'a_relay', name: 'Quantum Relay', slot: 'aux', cost: 3, wt: 1, en: 2, energyRange: 1 },
  { id: 'x_overtime', name: 'Overtime Shift', slot: 'event', cost: 0, event: { ep: 3 } },
  { id: 'x_req', name: 'Tech Requisition', slot: 'event', cost: 0, event: { draw: 2 } },
  { id: 'x_repair', name: 'Field Repairs', slot: 'event', cost: 0, event: { repair: 2 } }
].forEach(d => { DEFS[d.id] = d; });
/* Chassis: the frame and its reactor in one card. It sets HP, power and cooling, which weapon mounts each arm takes,
   how many aux systems it carries, and often a signature trait. The reactor is built in: it can still be hit,
   overheated or detonated, but it is never fitted on its own. */
const CHASSIS = {
  b_torso: { name: 'Standard Chassis', cost: 3, mounts: ['any', 'any'], reactor: { hp: 4, power: 6, cooling: 2 }, trait: 'Universal mounts take any weapon' },
  t_skirm: { name: 'Skirmisher Chassis', cost: 2, mounts: ['gun', 'any'], reactor: { hp: 3, power: 5, cooling: 3 }, trait: '+1 move' },
  t_light: { name: 'Scout Chassis', cost: 4, mounts: ['gun', 'energy'], reactor: { hp: 3, power: 7, cooling: 3 }, evasive: 10, trait: 'Evasive: enemies have −10% to hit it' },
  t_assault: { name: 'Striker Chassis', cost: 4, mounts: ['any', 'gun'], reactor: { hp: 4, power: 8, cooling: 3 }, meleeBonus: 1, trait: 'Melee weapons +1 damage' },
  t_heavy: { name: 'Heavy Chassis', cost: 6, mounts: ['gun', 'heavy'], reactor: { hp: 6, power: 10, cooling: 2 }, trait: 'Armour 2' },
  t_fortress: { name: 'Fortress Chassis', cost: 7, mounts: ['melee', 'heavy'], reactor: { hp: 6, power: 12, cooling: 2, passiveHeat: 1 }, bulwark: 1, trait: 'Bulwark: bracing gives +2 armour' },
  t_proto: { name: 'Prototype Chassis', cost: 5, mounts: ['energy', 'energy'], reactor: { hp: 5, power: 12, cooling: 3 }, energyRange: 1, trait: 'Energy weapons +1 range' },
  s_frame: { name: 'Aegis Chassis', cost: 8, mounts: ['any', 'any'], reactor: { hp: 6, power: 12, cooling: 3 }, shield: 2, trait: 'Shield 2 a round, universal mounts' },
  c_sing: { name: 'Singularity Chassis', slot: 'torso', cost: 6, wt: 3, hp: 6, auxSlots: 2, heatCap: 7, mounts: ['energy', 'heavy'], reactor: { hp: 3, power: 16, cooling: 1, passiveHeat: 1, breach: 4 }, trait: 'Huge power, but its reactor explodes when breached' },
  s_core: { name: 'Lattice Chassis', slot: 'torso', special: true, cost: 7, wt: 3, hp: 9, auxSlots: 2, heatCap: 8, mounts: ['energy', 'any'], reactor: { hp: 7, power: 14, cooling: 4 }, selfRepair: 1, trait: 'Self-repairs 1 a round' }
};
for (const id in CHASSIS) {
  const d = DEFS[id], c = CHASSIS[id];
  for (const k of ['power', 'cooling', 'passiveHeat', 'breach']) delete d[k];   // reactor stats now live on the built-in reactor
  Object.assign(d, c);
  DEFS['r_' + id] = { id: 'r_' + id, name: c.name.replace(' Chassis', '') + ' reactor', slot: 'core', basic: true, hidden: true, cost: 0, wt: 0, hp: c.reactor.hp, power: c.reactor.power, cooling: c.reactor.cooling, passiveHeat: c.reactor.passiveHeat || 0, breach: c.reactor.breach || 0 };
}
/* Hardpoints: every weapon belongs to a mount class, and fits an arm whose mount matches or is universal */
const MOUNT_NAME = { gun: 'Gun', energy: 'Energy', melee: 'Melee', heavy: 'Heavy', any: 'Universal' };
function mountOf(d) {
  if (!d || !d.weapon) return 'any';
  if (d.id === 's_railgun') return 'heavy';
  return { ballistic: 'gun', incendiary: 'gun', cryo: 'gun', support: 'gun', energy: 'energy', melee: 'melee', siege: 'melee', shield: 'melee', missile: 'heavy', artillery: 'heavy' }[d.cat] || 'gun';
}
function armMount(m, key) { const t = m.slots.torso, d = t && DEFS[t.id]; return d && d.mounts ? d.mounts[key === 'armL' ? 0 : 1] : 'any'; }
const fitsMount = (mount, d) => mount === 'any' || !d.weapon || mountOf(d) === mount;
/* Locomotion: legs give a way of moving, not only a speed */
const LOCO = {
  b_legs: { mode: null },
  l_biped: { mode: 'surefoot', modeText: 'Sure-footed: cannot be knocked back' },
  l_boost: { mode: 'jump', modeText: 'Jump: moves over rocks, ruins and mecha' },
  l_treads: { mode: 'ram', modeText: 'Ram: smash an adjacent enemy for 3 and shove it back' },
  l_quad: { mode: 'stable', modeText: 'Stable: heavy weapons keep full accuracy after moving' },
  l_hover: { mode: 'hover', modeText: 'Hover: immune to slowing' },
  s_anchor: { mode: 'entrench', modeText: 'Entrench: dig in to fire siege guns' }
};
for (const id in LOCO) Object.assign(DEFS[id], LOCO[id]);
/* Size classes replace weight and load: a chassis is Light (1), Medium (2) or Heavy (3), and legs carry up to a class.
   Capacity pips replace energy and power: a chassis has a budget, each weapon and aux system costs pips. */
const SIZE_NAME = ['', 'Light', 'Medium', 'Heavy'];
const SIZE = { b_torso: 2, t_skirm: 1, t_light: 1, t_assault: 2, t_heavy: 3, t_fortress: 3, t_proto: 2, s_frame: 3, c_sing: 2, s_core: 2 };
const CARRY = { b_legs: 2, l_boost: 2, l_hover: 2, l_biped: 3, l_treads: 3, l_quad: 3, s_anchor: 3 };
const CAP = { b_torso: 3, t_skirm: 3, t_light: 3, t_assault: 4, t_heavy: 4, t_fortress: 5, t_proto: 5, s_frame: 5, c_sing: 6, s_core: 5 };
const PIPS = { b_gun: 1, w_smg: 1, w_scatter: 1, w_blade: 1, w_ram: 1, w_shield: 1, w_repair: 1, w_gatling: 2, w_rail: 2, w_laser: 2, w_lance: 2, w_arc: 2, w_missile: 2, w_howitzer: 2, s_inferno: 2, s_cryo: 2, s_emp: 2, s_railgun: 3,
  a_cool: 1, a_sink: 1, a_plate: 1, a_bulwark: 2, a_relay: 1, a_jump: 1, a_apu: 0, a_nano: 1, a_servo: 0, a_shield: 1, a_over: 1 };
for (const id in SIZE) DEFS[id].size = SIZE[id];
for (const id in CARRY) DEFS[id].carry = CARRY[id];
for (const id in CAP) DEFS[id].cap = CAP[id];
for (const id in PIPS) DEFS[id].pips = PIPS[id];
// the two aux systems that only made sense under the old budgets get new jobs
Object.assign(DEFS.a_apu, { capBonus: 2 });         // +2 capacity
Object.assign(DEFS.a_servo, { carryBonus: 1 });     // legs carry one class heavier
function sizeOf(m) { const t = m.slots.torso; return t ? DEFS[t.id].size || 2 : 0; }
function carryOf(m) { const l = m.slots.legs; return l ? (DEFS[l.id].carry || 2) + m.slots.aux.reduce((a, x) => a + (x && x.hp > 0 ? DEFS[x.id].carryBonus || 0 : 0), 0) : 0; }
// capacity budget: the chassis's, plus power units, less what a damaged reactor can no longer supply
function capOf(m) {
  const t = m.slots.torso, c = m.slots.core;
  if (!t) return 0;
  let cap = (DEFS[t.id].cap || 3) + m.slots.aux.reduce((a, x) => a + (x && x.hp > 0 ? DEFS[x.id].capBonus || 0 : 0), 0);
  if (c && c.hp <= 0) return 0;
  if (c && c.hp <= DEFS[c.id].hp / 2) cap -= 1;
  return Math.max(0, cap);
}
function pipsUsed(m) { return ['armL', 'armR'].map(k => m.slots[k]).concat(m.slots.aux).reduce((a, x) => a + (x ? DEFS[x.id].pips || 0 : 0), 0); }
DEFS.l_boost.cost = 3;
const locoMode = m => { const l = m.slots.legs; return l && l.hp > 0 ? DEFS[l.id].mode || null : null; };
const WCAT = { w_smg: 'ballistic', b_gun: 'ballistic', w_blade: 'melee', w_rail: 'ballistic', w_missile: 'missile', w_howitzer: 'artillery', w_ram: 'siege', w_laser: 'energy', w_scatter: 'ballistic', w_gatling: 'ballistic', w_shield: 'shield', w_lance: 'energy', w_arc: 'energy', w_repair: 'support', s_inferno: 'incendiary', s_cryo: 'cryo', s_emp: 'energy', s_railgun: 'ballistic' };
Object.keys(WCAT).forEach(id => { DEFS[id].cat = WCAT[id]; if (DEFS[id].weapon) DEFS[id].weapon.cat = WCAT[id]; });

const DOCTRINES = {
  assault: {
    name: 'Assault Doctrine',
    blurb: 'A swarm of light, fast mecha that overwhelm by numbers and speed.',
    perks: ['Up to 4 mecha on the field, starts with 3', 'Every mech moves +1', 'Issue parts: Striker Chassis, Booster Legs (jump), Scatter Cannon, Plasma Blade'],
    traits: { fieldMax: 4, hangarMax: 4, move: 1, ep: 5, startMechs: 3 },
    deck: { l_boost: 3, l_biped: 2, t_light: 2, t_assault: 2, t_skirm: 2, c_compact: 2, c_fusion: 1, w_blade: 3, w_scatter: 2, w_laser: 3, w_smg: 3, a_jump: 3, a_cool: 1, a_over: 1, s_inferno: 2, s_cryo: 1, s_emp: 1, s_core: 1, x_supply: 2, x_overtime: 1, x_req: 1, x_repair: 1 }
  },
  armored: {
    name: 'Armored Doctrine',
    blurb: 'A handful of near-indestructible war machines that grind the enemy down.',
    perks: ['Only 2 mecha on the field', '+3 plating HP per mech, regains 3 a round', '+15% accuracy when it has not moved', 'Holds objectives up to 2 tiles away', '1 victory point per 2 enemy mecha destroyed', 'Issue parts: Heavy Chassis, Heavy Treads (ram), Missile Rack', 'Fortress base: +6 HP, turret fires twice for 5'],
    traits: { fieldMax: 2, plate: 3, plateRegen: 3, steady: 15, control: 2, killVp: 0.5, baseHp: 6, turretShots: 2, turretDmg: 2 },
    deck: { l_treads: 2, l_quad: 3, t_heavy: 3, t_fortress: 2, c_heavy: 1, c_fusion: 2, w_howitzer: 3, w_missile: 2, w_rail: 4, w_shield: 1, a_plate: 3, a_shield: 1, a_bulwark: 2, a_sink: 1, s_railgun: 2, s_anchor: 2, s_frame: 1, x_supply: 2, x_overtime: 2, x_repair: 1 }
  },
  experimental: {
    name: 'Experimental Doctrine',
    blurb: 'Overclocked prototypes that out-act and out-draw the enemy, if the heat allows.',
    perks: ['3 actions per mech instead of 2', 'Overclocked reactors: +2 heat every round', 'Draws 3 cards a round instead of 2', 'Issue parts: Prototype Chassis (two energy mounts), Hover Skirt, Laser Rifle'],
    traits: { ap: 3, heatTick: 2, draw: 3 },
    deck: { l_hover: 3, l_quad: 1, l_biped: 1, t_proto: 3, t_assault: 1, c_sing: 2, c_fusion: 2, w_lance: 2, w_arc: 2, w_laser: 3, w_missile: 1, a_nano: 2, a_over: 2, a_shield: 2, a_cool: 1, a_relay: 2, s_emp: 2, s_cryo: 1, s_inferno: 1, s_core: 1, x_req: 2, x_supply: 1, x_overtime: 1, x_repair: 1 }
  }
};

const CALLSIGNS = [
  ['Vanguard', 'Hammer', 'Lancer', 'Bulwark', 'Kestrel', 'Anvil', 'Warden', 'Javelin', 'Mastiff', 'Halberd', 'Osprey', 'Granite'],
  ['Ashfall', 'Cinder', 'Ravager', 'Brand', 'Vulture', 'Scoria', 'Furnace', 'Harrier', 'Magma', 'Reaver', 'Slag', 'Pyre']
];

/* ---------- Battlefield ---------- */
// Every map is point-symmetric, (x, y) -> (W-1-x, H-1-y), so neither side has the better half.
// rules: map-wide changes to how points are scored. traits: per-doctrine balance for this map.
const MAPS = {
  open: {
    name: 'Open Field', goal: 'Capture points',
    blurb: 'Radars score wherever they stand; depots score on the enemy half. A compact, open field.',
    W: 9, H: 7, bases: [[0, 3], [8, 3]],
    obj: [[2, 5, 'depot'], [3, 1, 'depot'], [6, 1, 'depot'], [5, 5, 'depot'], [4, 0, 'radar'], [4, 6, 'radar'], [4, 3, 'repair']],
    rocks: [[2, 2], [6, 4], [3, 3], [5, 3]],
    ruins: [[2, 1], [6, 5], [3, 4], [5, 2], [2, 3], [6, 3]],
    rules: {},
    traits: {}
  },
  lanes: {
    name: 'Three Lanes', goal: 'Capture points',
    blurb: 'Rock walls split the field into three lanes. Radars hold the central crossroads; depots and repair pads sit in the outer lanes.',
    W: 11, H: 8, bases: [[0, 3], [10, 4]],
    obj: [[2, 0, 'depot'], [8, 7, 'depot'], [6, 1, 'depot'], [4, 6, 'depot'], [5, 3, 'radar'], [5, 4, 'radar'], [5, 0, 'repair'], [5, 7, 'repair']],
    rocks: [[3, 2], [4, 2], [6, 2], [7, 2], [3, 5], [4, 5], [6, 5], [7, 5]],
    ruins: [[2, 1], [8, 6], [4, 0], [6, 7], [3, 3], [7, 4], [3, 4], [7, 3], [8, 1], [2, 6]],
    rules: {},
    traits: { assault: { startMechs: 2 }, armored: { control: 1 }, experimental: { heatTick: 2.5 } },
    notes: 'Assault starts with 2 mecha; Armored holds objectives only from an adjacent tile; Experimental reactors gain +2.5 heat a round.'
  },
  uplink: {
    name: 'Uplink', goal: 'King of the hill',
    blurb: 'One uplink in the centre is worth 2 points a round to whoever holds it. Depots only pay Supply, and repair pads wait on the flanks.',
    W: 9, H: 7, bases: [[0, 3], [8, 3]],
    obj: [[4, 3, 'uplink'], [2, 0, 'depot'], [6, 6, 'depot'], [2, 6, 'depot'], [6, 0, 'depot'], [4, 0, 'repair'], [4, 6, 'repair']],
    rocks: [[4, 1], [4, 5], [2, 2], [6, 4]],
    ruins: [[3, 2], [5, 4], [3, 4], [5, 2], [1, 1], [7, 5]],
    rules: { depotVp: false, uplinkVp: 2, baseHp: 6 },
    traits: { assault: { draw: 3 } },
    notes: 'Bases +6 HP. Assault draws 3 cards a round.'
  },
  salvage: {
    name: 'Scrapyard', goal: 'Salvage race',
    blurb: 'No capture points. Crates drop in pairs every round across the yard; each one grabbed is worth a point plus what is inside.',
    W: 10, H: 7, bases: [[0, 3], [9, 3]],
    obj: [[2, 1, 'depot'], [7, 5, 'depot'], [2, 5, 'depot'], [7, 1, 'depot'], [4, 3, 'repair'], [5, 3, 'repair']],
    rocks: [[3, 2], [6, 4], [3, 4], [6, 2]],
    ruins: [[4, 1], [5, 5], [4, 5], [5, 1], [2, 3], [7, 3], [1, 0], [8, 6]],
    rules: { depotVp: false, crateVp: 1, crateEvery: 1, cratePairs: true, crateMax: 6, crateBand: [2, 7], baseHp: 8, crateSupply: 2 },
    traits: { armored: { killVp: 1, move: 1 } },
    notes: 'Bases +8 HP, crates hold +2 Supply. Armored moves +1 and scores 1 point per kill.'
  }
};
const MAP_IDS = Object.keys(MAPS);
let MAP = null, OBJ = [], TERRAIN = {}, BASE_POS = [];
function setMap(id) {
  MAP = MAPS[id] || MAPS.open;
  MAP.id = MAPS[id] ? id : 'open';
  W = MAP.W; H = MAP.H;
  OBJ = MAP.obj.map(([x, y, type]) => ({ x, y, type }));
  TERRAIN = {};
  MAP.rocks.forEach(([x, y]) => { TERRAIN[x + ',' + y] = 'rock'; });
  MAP.ruins.forEach(([x, y]) => { TERRAIN[x + ',' + y] = 'ruins'; });
  BASE_POS = MAP.bases.map(([x, y]) => ({ x, y }));
  return MAP;
}
setMap('open');
const rule = (k, d) => (MAP.rules[k] != null ? MAP.rules[k] : d);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const REQUIRED = ['torso', 'core', 'legs'];
const SLOT_NAME = { torso: 'Chassis', core: 'Reactor', legs: 'Legs', armL: 'Left arm', armR: 'Right arm', arm: 'Arm', aux: 'Aux' };
const SUM = ['evasive', 'meleeBonus', 'bulwark', 'plate', 'energyRange', 'armorAll', 'cooling', 'heatCap', 'capacity', 'power', 'move', 'moveHeat', 'shield', 'selfRepair', 'dmgBonus', 'shotHeat', 'passiveHeat'];

let S = null;
let rnd = Math.random;

const K = (x, y) => x + ',' + y;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const terrain = (x, y) => {
  const t = TERRAIN[K(x, y)] || 'open';
  return t === 'ruins' && S && S.flat && S.flat.indexOf(K(x, y)) >= 0 ? 'rubble' : t;
};
const baseAt = (x, y) => (x === BASE_POS[0].x && y === BASE_POS[0].y) ? 0 : (x === BASE_POS[1].x && y === BASE_POS[1].y) ? 1 : null;
const passable = (x, y) => inb(x, y) && terrain(x, y) !== 'rock' && baseAt(x, y) === null;
const man = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);
const coord = (x, y) => 'ABCDEFGHIJK'[x] + (y + 1);
const mechAt = (x, y) => S.mechs.find(m => m.x === x && m.y === y) || null;
const fieldMech = uid => S.mechs.find(m => m.uid === uid) || null;
const fieldMechs = pid => S.mechs.filter(m => m.owner === pid);
const wreckAt = (x, y) => S.wrecks.find(w => w.x === x && w.y === y) || null;
const objAt = (x, y) => S.objectives.find(o => o.x === x && o.y === y) || null;
const slotName = key => key.startsWith('aux') ? 'Aux ' + (+key.slice(3) + 1) : SLOT_NAME[key];
const slotType = key => key.startsWith('aux') ? 'aux' : key.startsWith('arm') ? 'arm' : key;

function log(t, k) {
  if (S.phase === 'build' && k && k[0] === 'p' && S.players[+k.slice(1)]) (S.players[+k.slice(1)].blog = S.players[+k.slice(1)].blog || []).push({ r: S.round, t, k });
  S.log.push({ r: S.round, t, k: k || 'info' });
  S.logN = (S.logN || 0) + 1;
  if (S.log.length > 400) S.log.splice(0, S.log.length - 400);
}
function fx(o) { if (S.phase === 'resolve') o.res = true; S.fx.push(o); if (S.fx.length > 120) S.fx.splice(0, S.fx.length - 120); }
function mark(m) { (S.order = S.order || []).push({ uid: m.uid, owner: m.owner, name: m.name }); }
function fxFloat(x, y, t, c) { fx({ k: 'float', x, y, t, c }); }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function nid(p) {
  if (p && S.phase === 'build') { p.uidc = Math.max(p.uidc || 0, (p.id + 1) * 10000000 + S.round * 10000) + 1; return p.uidc; }
  return S.uid++;
}
function mk(id, paid, p) {
  const d = DEFS[id];
  const o = { uid: nid(p), id, hp: d.hp || 1 };
  if (d.weapon && d.weapon.ammo) o.ammo = d.weapon.ammo;
  if (d.hull) o.hullHp = d.hull;
  if (paid) o.paid = true;
  return o;
}
function deployTiles(pid) {
  const b = BASE_POS[pid], out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const x = b.x + dx, y = b.y + dy;
    if ((dx || dy) && passable(x, y)) out.push([x, y]);
  }
  return out;
}
function turretTiles(pid) {
  const b = BASE_POS[pid], out = [];
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if ((x !== b.x || y !== b.y) && man(x, y, b.x, b.y) <= C.TURRET_RANGE) out.push([x, y]);
  return out;
}
const inDeployZone = m => deployTiles(m.owner).some(([x, y]) => x === m.x && y === m.y);

/* ---------- Mech model ---------- */
function getSlot(m, key) {
  if (key.startsWith('aux')) return m.slots.aux[+key.slice(3)] || null;
  return m.slots[key] || null;
}
function setSlot(m, key, inst) {
  if (key.startsWith('aux')) m.slots.aux[+key.slice(3)] = inst; else m.slots[key] = inst;
}
function partsOf(m) {
  const out = [];
  for (const key of ['armL', 'armR', 'torso', 'core', 'legs']) if (m.slots[key]) out.push({ key, inst: m.slots[key] });
  m.slots.aux.forEach((inst, i) => { if (inst) out.push({ key: 'aux' + i, inst }); });
  return out;
}
// A mech's HP is its frame's HP. Every hit lowers it; a hit on a core, leg or arm also damages that part.
// extra hull from legs such as Siege Anchors, used up before the frame
// doctrine traits: what sets each army apart beyond its deck
const ISSUE = { assault: ['t_assault', 'l_boost', 'w_scatter', 'w_blade'], armored: ['t_heavy', 'l_treads', 'w_missile'], experimental: ['t_proto', 'l_hover', 'w_laser'] };
const issuedTo = p => (p && ISSUE[p.doctrine]) || [];
// the chassis each doctrine's opening mecha are built on, in order: the issue chassis first, then others from its deck
const START_CHASSIS = { assault: ['t_assault', 't_skirm', 't_light', 't_assault'], armored: ['t_heavy', 't_fortress'], experimental: ['t_proto', 'c_sing'] };
// the old separate cores are gone from play: chassis carry their own reactor now
for (const id of ['b_core', 'c_heavy', 'c_compact', 'c_fusion']) DEFS[id].hidden = true;
const standardFor = p => Object.values(DEFS).filter(d => (d.basic && !d.hidden) || issuedTo(p).includes(d.id)).map(d => d.id);
for (const [doc, add] of Object.entries({ assault: { l_boost: 1, w_blade: 1, t_skirm: 1 }, armored: { l_treads: 1, t_heavy: 1, w_missile: 1 }, experimental: { t_proto: 1, l_hover: 1 } })) {
  const dk = DOCTRINES[doc].deck;
  for (const c of ['c_heavy', 'c_compact', 'c_fusion', 'b_core']) delete dk[c];
  for (const k in add) dk[k] = (dk[k] || 0) + add[k];
}
const TRAIT_KEYS = ['control', 'fieldMax', 'hangarMax', 'startMechs', 'move', 'ep', 'draw', 'ap', 'plate', 'plateRegen', 'steady', 'turretDmg', 'heatTick'];
function docTrait(doc, k) {
  const mt = MAP.traits[doc], t = DOCTRINES[doc] && DOCTRINES[doc].traits;
  if (mt && mt[k] != null) return mt[k];
  return t && t[k] != null ? t[k] : null;
}
const isEasy = p => !!(p && p.ai && PERSONAS[p.ai.persona] && PERSONAS[p.ai.persona].easy);
function trait(pid, k) {
  const p = S && S.players[pid];
  // the Recruit fields at most two mecha
  if (k === 'fieldMax' && isEasy(p)) return Math.min(2, docTrait(p.doctrine, k) || C.FIELD_MAX);
  const v = p ? docTrait(p.doctrine, k) : null;
  if (v != null) return v;
  return { fieldMax: C.FIELD_MAX, hangarMax: C.HANGAR_MAX, startMechs: 2, killVp: 0, baseHp: 0, turretShots: 1, control: 0, move: 0, ep: C.EP, draw: C.DRAW, ap: C.AP, plate: 0, plateRegen: 0, steady: 0, turretDmg: 0, heatTick: 0 }[k];
}
const fieldMax = pid => trait(pid, 'fieldMax');
const hangarMax = p => trait(p.id, 'hangarMax');
// extra plating carried by the mech: the army's own plus any Bulwark Plating fitted
function plateMax(m) { if (m.owner == null || !m.slots) return 0; return trait(m.owner, 'plate') + stats(m).plate; }
function hullOf(m) { const l = m.slots.legs, d = l && DEFS[l.id]; return d && d.hull && l.hp > 0 ? (l.hullHp == null ? d.hull : l.hullHp) : 0; }
function hpOf(m) { return m.slots.torso ? Math.max(0, m.slots.torso.hp) + hullOf(m) + (m.slots.torso.hp > 0 ? Math.min(plateMax(m), m.plate == null ? plateMax(m) : m.plate) : 0) : 0; }
function maxHpOf(m) { const l = m.slots.legs; return m.slots.torso ? DEFS[m.slots.torso.id].hp + (l && DEFS[l.id].hull && l.hp > 0 ? DEFS[l.id].hull : 0) + plateMax(m) : 0; }
const worn = inst => { const d = DEFS[inst.id]; return inst.hp > 0 && (inst.hp < d.hp || (!!d.hull && inst.hullHp != null && inst.hullHp < d.hull)); };
// Sale price: plain parts 1, weapons 2, special parts 3, special weapons 4
function sellValue(d) { return (d.weapon ? 2 : 1) + (d.special ? 2 : 0); }
function auxCount(m) { return m.slots.torso ? (DEFS[m.slots.torso.id].auxSlots || 0) : 0; }

function stats(m) {
  const st = { weight: 0, draw: 0, underpowered: false };
  SUM.forEach(f => { st[f] = 0; });
  for (const { inst } of partsOf(m)) {
    const d = DEFS[inst.id];
    if (d.slot !== 'legs') st.weight += d.wt || 0;
    if (inst.hp <= 0) continue;
    if (d.slot === 'aux' && m.slots.torso && m.slots.torso.hp <= 0) continue; // a wrecked frame takes its aux systems offline
    st.draw += d.en || 0;
    for (const f of SUM) if (d[f]) st[f] += d[f];
    if (d.ignoreCover) st.ignoreCover = true;
  }
  const legs = m.slots.legs, core = m.slots.core;
  if (m.owner != null && S && S.players[m.owner]) st.move += trait(m.owner, 'move');
  if (!legs || legs.hp <= 0) st.move = legs ? 1 : 0;
  else if (legs.hp <= DEFS[legs.id].hp / 2) st.move = Math.max(1, st.move - 1);
  st.fullPower = st.power;
  if (core && core.hp > 0 && core.hp <= DEFS[core.id].hp / 2) st.power = Math.ceil(st.power * 0.6);
  if (m.entrenched) st.armorAll += C.ENTRENCH_ARMOR;
  if (m.slow > 0 && locoMode(m) !== 'hover') st.move = Math.max(1, st.move - 2);
  st.cap = capOf(m); st.used = pipsUsed(m); st.size = sizeOf(m); st.carry = carryOf(m);
  st.underpowered = st.used > st.cap;
  return st;
}

function issues(m) {
  const out = [];
  for (const k of REQUIRED) {
    const i = m.slots[k];
    if (k === 'core' && !m.slots.torso) continue;
    if (!i) out.push('Needs a ' + SLOT_NAME[k].toLowerCase());
    else if (i.hp <= 0) out.push(DEFS[i.id].name + ' is destroyed and must be replaced');
  }
  const st = stats(m);
  if (m.slots.legs && m.slots.torso && st.size > st.carry) out.push(DEFS[m.slots.legs.id].name + ' cannot carry a ' + SIZE_NAME[st.size].toLowerCase() + ' chassis');
  if (m.slots.torso && st.used > st.cap) out.push('Over capacity: parts need ' + st.used + ' pips, the chassis has ' + st.cap);
  for (const k of ['armL', 'armR']) { const w = m.slots[k]; if (w && !fitsMount(armMount(m, k), DEFS[w.id])) out.push(DEFS[w.id].name + ' does not fit the ' + MOUNT_NAME[armMount(m, k)].toLowerCase() + ' mount'); }
  return out;
}

function weaponsOf(m) {
  const out = [];
  for (const key of ['armL', 'armR']) {
    const inst = m.slots[key];
    if (inst && DEFS[inst.id].weapon) out.push({ key, inst, def: DEFS[inst.id], w: DEFS[inst.id].weapon });
  }
  return out;
}
const canEntrench = m => { const l = m.slots.legs; return !!l && l.hp > 0 && !!DEFS[l.id].entrench; };
// Siege Anchors lock every weapon until the mech digs in; the railgun needs to be dug in wherever it is mounted
function weaponLock(m, key) {
  const inst = getSlot(m, key);
  if (!inst || !DEFS[inst.id].weapon || m.entrenched) return null;
  const w = DEFS[inst.id].weapon, l = m.slots.legs, anchored = !!l && !!DEFS[l.id].entrench;
  if (w.needsEntrench && !anchored) return 'Needs Siege Anchors';
  if (w.needsEntrench || anchored) return 'Entrench first';
  return null;
}
function usable(m, key) {
  const inst = getSlot(m, key);
  return !!inst && inst.hp > 0 && (inst.ammo == null || inst.ammo > 0) && !(m.fired && m.fired[key]);
}
const hasWeapon = m => weaponsOf(m).some(wp => !wp.w.repair && wp.inst.hp > 0 && (wp.inst.ammo == null || wp.inst.ammo > 0));
const effRange = (w, st) => w.range + (st && st.energyRange && w.cat === 'energy' ? st.energyRange : 0);

function role(m) {
  if (issues(m).length) return 'Under construction';
  const st = stats(m), ws = weaponsOf(m).filter(wp => wp.inst.hp > 0);
  const t = DEFS[m.slots.torso.id];
  if (DEFS[m.slots.legs.id].entrench) return 'Emplacement';
  if (!ws.length) return st.move >= 4 ? 'Scout' : 'Unarmed frame';
  if (ws.some(wp => wp.w.repair)) return 'Support';
  if (ws.some(wp => wp.w.siege && wp.w.melee)) return 'Siege';
  if (ws.some(wp => wp.w.indirect)) return 'Artillery';
  const maxR = Math.max(...ws.map(wp => wp.w.range));
  if (st.move >= 5) return maxR <= 2 ? 'Interceptor' : 'Scout';
  if ((t.armor || 0) + st.armorAll >= 2 || t.hp >= 14) return 'Tank';
  if (st.move >= 4 || maxR <= 2) return 'Assault';
  if (maxR >= 5) return 'Sniper';
  return 'Trooper';
}

/* ---------- Setup ---------- */
function newGame(opts) {
  const mapId = opts.map === 'random' || !opts.map ? (opts.map === 'random' ? MAP_IDS[Math.floor(rnd() * MAP_IDS.length)] : 'open') : opts.map;
  setMap(mapId);
  S = { v: 4, map: MAP.id, crates: [], winReason: null, uid: 1, round: 1, phase: 'build', current: 0, first: rnd() < 0.5 ? 0 : 1, active: null, winner: null, players: [], mechs: [], wrecks: [], objectives: OBJ.map(o => ({ x: o.x, y: o.y, type: o.type, owner: null })), log: [], fx: [] };
  opts.players.forEach((o, i) => {
    const ids = [];
    Object.entries(DOCTRINES[o.doctrine].deck).forEach(([id, n]) => { for (let j = 0; j < n; j++) ids.push(id); });
    const p = { id: i, name: o.name, doctrine: o.doctrine, isAI: !!o.isAI, supply: C.START_SUPPLY, ep: 0, deck: shuffle(ids).map(id => mk(id)), workshop: [], hangar: [], base: { x: BASE_POS[i].x, y: BASE_POS[i].y, hp: C.BASE_HP + rule('baseHp', 0) + (docTrait(o.doctrine, 'baseHp') || 0), max: C.BASE_HP + rule('baseHp', 0) + (docTrait(o.doctrine, 'baseHp') || 0) }, names: shuffle(CALLSIGNS[i].slice()), lost: 0, kills: 0, vp: 0 };
    S.players.push(p);
    setupCommander(p, o);
    for (let guard = 0; p.workshop.length < C.HAND_START && p.deck.length && guard < 200; guard++) {
      const c = p.deck.pop();
      if (DEFS[c.id].event) p.deck.unshift(c); else p.workshop.push(c);
    }
    // each side opens with standard mecha ready to deploy; the swarm army brings an extra one
    for (let j = 0; j < (docTrait(p.doctrine, 'startMechs') || 2); j++) {
      const m = blankMech(p);
      // the army opens with its own signature machines: issue chassis, issue legs, a weapon in each mount that takes one
      const iss = ISSUE[o.doctrine] || [], line = START_CHASSIS[o.doctrine] || [], lg = iss.find(id => DEFS[id].slot === 'legs') || 'b_legs';
      const ch = line[j % Math.max(1, line.length)] || iss.find(id => DEFS[id].slot === 'torso') || 'b_torso';
      m.slots.torso = mk(ch, true); m.slots.torso.issued = true; m.slots.core = mk('r_' + ch, true); m.slots.legs = mk(lg, true); m.slots.legs.issued = true;
      const guns = ['b_gun'].concat(iss.filter(id => DEFS[id].slot === 'arm'));
      // the lead mech is armed in both mounts; the others carry one weapon, in whichever mount takes one
      for (const k of ['armR', 'armL']) { const g = guns.slice().reverse().find(id => fitsMount(armMount(m, k), DEFS[id])); if (g && (j === 0 || C.START_ARMS === 'all' || !m.slots.armR)) { m.slots[k] = mk(g, true); m.slots[k].issued = true; if (j > 0 && C.START_ARMS !== 'all') break; } }
      p.hangar.push(m);
    }
  });
  log('Round 1 begins.', 'sys');
  startBuildPhase();
  return S;
}
// an empty frame waits in the hangar whenever there is room, so nobody has to lay one down by hand
const isBlank = m => !m.slots.torso && !m.slots.core && !m.slots.legs && !m.slots.armL && !m.slots.armR && !m.slots.aux.some(Boolean);
const hangarFull = p => p.hangar.filter(m => !isBlank(m)).length >= hangarMax(p);
function ensureBlank(p) {
  const blanks = p.hangar.filter(isBlank);
  for (const b of blanks.slice(1)) dropBlank(p, b);
  if (!blanks.length && p.hangar.length < hangarMax(p)) p.hangar.push(blankMech(p));
}
function dropBlank(p, b) { p.hangar.splice(p.hangar.indexOf(b), 1); p.names.unshift(b.name); }
function blankMech(p) {
  const name = p.names.length ? p.names.shift() : 'Unit ' + S.uid;
  return { uid: nid(p), owner: p.id, name, slots: { torso: null, core: null, legs: null, armL: null, armR: null, aux: [] }, x: null, y: null, heat: 0, ap: 0, activated: false, braced: false, shield: 0, shutdown: false, fired: {}, moves: 0, entrenched: false, burn: 0, slow: 0, shock: 0 };
}
function draw(p, n) {
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (!p.deck.length || p.workshop.length >= C.WORKSHOP_MAX) break;
    receive(p, p.deck.pop()); got++;
  }
  return got;
}
// Event cards take effect the moment they are collected; everything else waits in the Workshop
function receive(p, inst) {
  const d = DEFS[inst.id];
  if (!d.event) { p.workshop.push(inst); return; }
  const e = d.event, out = [];
  if (e.supply) { p.supply += e.supply; out.push('+' + e.supply + ' Supply'); }
  if (e.ep) { p.ep += e.ep; out.push('+' + e.ep + ' engineering this round'); }
  if (e.repair) {
    let n = 0;
    for (const m of fieldMechs(p.id).concat(p.hangar)) {
      const pi = mostDamaged(m);
      if (!pi) continue;
      pi.hp = Math.min(DEFS[pi.id].hp, pi.hp + e.repair); n++;
      if (m.x != null) fxFloat(m.x, m.y, '+' + e.repair + ' HP', 'good');
    }
    out.push(n ? n + ' mech' + (n > 1 ? 's' : '') + ' patched' : 'nothing needed fixing');
  }
  if (e.draw) {
    let got = 0;
    if (p.stage === 'draw' && p.extra) {
      // during the Draw step the extra cards are revealed on their own before they reach the Workshop
      for (let i = 0; i < e.draw; i++) {
        if (!p.deck.length || p.workshop.length + p.extra.length >= C.WORKSHOP_MAX) break;
        p.extra.push(p.deck.pop()); got++;
      }
      if (got) p.extraFrom = d.name;
    } else got = draw(p, e.draw);
    out.push(got + ' extra card' + (got === 1 ? '' : 's'));
  }
  log(d.name + ' for ' + p.name + ': ' + out.join(', ') + '.', 'p' + p.id);
}
// Both commanders draw and build at the same time; each marks themselves ready when done
function startBuildPhase() {
  S.phase = 'build'; S.current = S.first;
  for (const p of S.players) {
    ensureBlank(p);
    p.ep = trait(p.id, 'ep'); p.incoming = []; p.wave = 0; p.waveFrom = null;
    for (let i = 0; i < trait(p.id, 'draw'); i++) {
      if (!p.deck.length || p.workshop.length + p.incoming.length >= C.WORKSHOP_MAX) break;
      p.incoming.push(p.deck.pop());
    }
    p.stage = p.incoming.length ? 'draw' : 'build';
    log(p.incoming.length ? p.name + ' receives ' + p.incoming.length + ' card' + (p.incoming.length > 1 ? 's' : '') + ' from the Arsenal.' : p.deck.length ? p.name + "'s Workshop is full. Nothing drawn." : p.name + "'s Arsenal is empty.", 'p' + p.id);
    p.blog = [];
  }
}
function acceptDraw(p) {
  p = p || S.players[S.current];
  if (S.phase !== 'build' || p.stage !== 'draw') return fail('Nothing to collect.');
  const batch = p.incoming || [];
  p.incoming = []; p.extra = []; p.extraFrom = null;
  batch.forEach(c => receive(p, c));
  if (p.extra.length) { p.incoming = p.extra; p.extra = null; p.wave = (p.wave || 0) + 1; p.waveFrom = p.extraFrom; return OK; }
  p.extra = null; p.extraFrom = null;
  p.stage = 'build';
  return OK;
}

/* ---------- Build phase ---------- */
function canRequisition(p) {
  if (!C.REQ_COST) return 'Requisitions are not in use.';
  if (S.phase !== 'build' || p.stage !== 'build') return 'Requisition during your build.';
  if (!p.deck.length) return 'The Arsenal is empty.';
  if (p.workshop.length >= C.WORKSHOP_MAX) return 'The Workshop is full.';
  if (p.supply < C.REQ_COST) return 'Needs ' + C.REQ_COST + ' Supply.';
  return null;
}
function requisition(p) {
  const why = canRequisition(p); if (why) return fail(why);
  p.supply -= C.REQ_COST;
  p.incoming = [p.deck.pop()]; p.extra = null; p.extraFrom = null; p.wave = 0; p.waveFrom = null;
  p.stage = 'draw';
  log(p.name + ' requisitions a card from the Arsenal for ' + C.REQ_COST + ' Supply.', 'p' + p.id);
  return OK;
}
const fail = msg => ({ ok: false, msg });
const OK = { ok: true };
function buildGuard(p) {
  if (S.phase !== 'build' || p.stage !== 'build') return p.stage === 'done' ? 'Your build is locked in.' : 'Parts can only be changed during the Build phase.';
  return null;
}
function toWorkshop(p, inst) {
  if (!inst || DEFS[inst.id].basic || inst.issued || inst.hp <= 0) return;
  p.workshop.push(inst);
}
function installCost(src, p) {
  if (src.basic) return DEFS[src.basic].cost;
  const inst = p.workshop.find(c => c.uid === src.uid);
  return inst ? (inst.paid ? 0 : DEFS[inst.id].cost) : 0;
}
function install(p, m, key, src) {
  const g = buildGuard(p); if (g) return fail(g);
  if (!p.hangar.includes(m)) return fail('That mech is not in your hangar.');
  if (src.basic && !standardFor(p).includes(src.basic)) return fail('That part is not standard issue for this army.');
  const inst0 = src.basic ? null : p.workshop.find(c => c.uid === src.uid);
  const d = DEFS[src.basic || (inst0 && inst0.id)];
  if (!d) return fail('That part is no longer in the Workshop.');
  if (d.slot !== slotType(key)) return fail(d.name + ' does not fit the ' + slotName(key).toLowerCase() + ' slot.');
  if (slotType(key) === 'aux' && +key.slice(3) >= auxCount(m)) return fail('This chassis has no free auxiliary mount there.');
  if (key === 'core') return fail('The reactor is built into the chassis.');
  if (key !== 'torso' && !m.slots.torso) return fail('Fit a chassis first: it decides what else can go on.');
  if (key.startsWith('arm') && !fitsMount(armMount(m, key), d)) return fail(d.name + ' needs a ' + MOUNT_NAME[mountOf(d)].toLowerCase() + ' mount: this arm is ' + MOUNT_NAME[armMount(m, key)].toLowerCase() + '.');
  if (p.ep < 1) return fail('No engineering capacity left this round.');
  const cost = installCost(src, p);
  if (p.supply < cost) return fail('Not enough Supply: ' + d.name + ' costs ' + cost + '.');
  p.ep--; p.supply -= cost;
  const old = getSlot(m, key);
  let inst;
  if (src.basic) { inst = mk(src.basic, true, p); inst.issued = true; }
  else { inst = inst0; p.workshop.splice(p.workshop.indexOf(inst0), 1); inst.paid = true; }
  setSlot(m, key, inst);
  toWorkshop(p, old);
  if (key === 'torso') {
    const n = auxCount(m);
    m.slots.aux.slice(n).forEach(a => toWorkshop(p, a));
    m.slots.aux.length = Math.min(m.slots.aux.length, n);
    m.slots.core = mk('r_' + inst.id, true, p);   // a new chassis comes with its own reactor
    // weapons that no longer fit the new mounts go back to the Workshop
    for (const k of ['armL', 'armR']) { const w = m.slots[k]; if (w && !fitsMount(armMount(m, k), DEFS[w.id])) { m.slots[k] = null; toWorkshop(p, w); log(DEFS[w.id].name + ' does not fit the ' + MOUNT_NAME[armMount(m, k)].toLowerCase() + ' mount and returns to the Workshop.', 'p' + p.id); } }
  }
  log(p.name + ' fits ' + d.name + ' to ' + m.name + ' (' + slotName(key).toLowerCase() + ').', 'p' + p.id);
  ensureBlank(p); return OK;
}
function removePart(p, m, key) {
  const g = buildGuard(p); if (g) return fail(g);
  const inst = getSlot(m, key);
  if (!inst) return fail('That slot is already empty.');
  if (key === 'core') return fail('The reactor is built into the chassis.');
  setSlot(m, key, null);
  toWorkshop(p, inst);
  if (key === 'torso') { m.slots.aux.forEach(a => toWorkshop(p, a)); m.slots.aux = []; m.slots.core = null; }
  ensureBlank(p); return OK;
}
function repairCost(inst) { const d = DEFS[inst.id]; return Math.max(1, Math.ceil((d.hp - inst.hp + (d.hull && inst.hullHp != null ? d.hull - inst.hullHp : 0)) / 2)); }
function repair(p, m, key) {
  const g = buildGuard(p); if (g) return fail(g);
  const inst = getSlot(m, key);
  if (!inst) return fail('Nothing to repair there.');
  const d = DEFS[inst.id];
  if (inst.hp <= 0 && key !== 'core') return fail(d.name + ' is destroyed. Replace it instead.');
  if (!worn(inst)) return fail(d.name + ' is undamaged.');
  const cost = repairCost(inst);
  if (p.ep < 1) return fail('No engineering capacity left this round.');
  if (p.supply < cost) return fail('Not enough Supply: this repair costs ' + cost + '.');
  p.ep--; p.supply -= cost; inst.hp = d.hp; if (d.hull) inst.hullHp = d.hull;
  log(p.name + ' repairs ' + m.name + "'s " + d.name + '.', 'p' + p.id);
  return OK;
}
function newMech(p) {
  const g = buildGuard(p); if (g) return fail(g);
  if (p.hangar.length >= hangarMax(p)) return fail('The hangar holds ' + hangarMax(p) + ' mecha. Deploy or dismantle one first.');
  const m = blankMech(p);
  p.hangar.push(m);
  log(p.name + ' lays down a new frame: ' + m.name + '.', 'p' + p.id);
  return { ok: true, mech: m };
}
function dismantle(p, m) {
  const g = buildGuard(p); if (g) return fail(g);
  const i = p.hangar.indexOf(m);
  if (i < 0) return fail('That mech is not in your hangar.');
  partsOf(m).forEach(({ inst }) => toWorkshop(p, inst));
  p.hangar.splice(i, 1);
  p.names.push(m.name);
  log(p.name + ' dismantles ' + m.name + '.', 'p' + p.id);
  ensureBlank(p); return OK;
}
function scrapCard(p, uid) {
  const g = buildGuard(p); if (g) return fail(g);
  const i = p.workshop.findIndex(c => c.uid === uid);
  if (i < 0) return fail('That card is not in the Workshop.');
  const d = DEFS[p.workshop[i].id];
  const v = sellValue(d);
  p.workshop.splice(i, 1); p.supply += v;
  log(p.name + ' sells ' + d.name + ' for ' + v + ' Supply.', 'p' + p.id);
  return OK;
}
function playTactic(p, uid) {
  const g = buildGuard(p); if (g) return fail(g);
  const i = p.workshop.findIndex(c => c.uid === uid);
  if (i < 0) return fail('That card is not in the Workshop.');
  const d = DEFS[p.workshop[i].id];
  const t = d.tactic || d.event;
  if (!t) return fail(d.name + ' is a component, not a tactic.');
  p.workshop.splice(i, 1);
  if (t.supply) p.supply += t.supply;
  if (t.ep) p.ep += t.ep;
  if (t.draw) draw(p, t.draw);
  log(p.name + ' plays ' + d.name + '.', 'p' + p.id);
  return OK;
}
function endBuild(p) {
  p = p || S.players[S.current];
  if (S.phase !== 'build' || p.stage !== 'build') return fail('Not building right now.');
  p.stage = 'done';
  log(p.name + ' is ready.', 'p' + p.id);
  finishBuildPhase();
  return OK;
}
// once both are ready, deployment runs in player order
function finishBuildPhase() {
  if (S.phase !== 'build' || !S.players.every(x => x.stage === 'done')) return false;
  S.phase = 'deploy'; S.current = S.first;
  log('Deployment: ' + S.players[S.first].name + ' first.', 'sys');
  return true;
}

/* ---------- Deploy phase ---------- */
function canDeploy(p, m) {
  if (!p.hangar.includes(m)) return 'Not in the hangar.';
  const is = issues(m);
  if (is.length) return is[0];
  if (fieldMechs(p.id).length >= fieldMax(p.id)) return 'Command limit reached: ' + fieldMax(p.id) + ' mecha on the field.';
  return null;
}
function deploy(p, m, x, y) {
  if (S.phase !== 'deploy' || S.current !== p.id) return fail('Mecha deploy during your Deploy phase.');
  const why = canDeploy(p, m); if (why) return fail(why);
  if (!deployTiles(p.id).some(t => t[0] === x && t[1] === y)) return fail('Deploy onto a tile next to your base.');
  if (mechAt(x, y)) return fail('That tile is occupied.');
  p.hangar.splice(p.hangar.indexOf(m), 1);
  m.x = x; m.y = y; m.heat = 0; m.activated = false; m.braced = false; m.shutdown = false; m.fired = {}; m.moves = 0; m.plate = plateMax(m);
  m.entrenched = false; m.burn = 0; m.slow = 0; m.shock = 0;
  m.shield = stats(m).shield;
  S.mechs.push(m);
  fx({ k: 'deploy', uid: m.uid, x, y, owner: p.id });
  log(p.name + ' deploys ' + m.name + ' (' + role(m) + ') at ' + coord(x, y) + '.', 'p' + p.id);
  ensureBlank(p);
  return OK;
}
function endDeploy() {
  if (S.phase !== 'deploy') return fail('Not in the Deploy phase.');
  if (S.current === S.first) S.current = 1 - S.first;
  else startCombat();
  return OK;
}

/* ---------- Combat phase ---------- */
function startCombat() {
  S.phase = 'combat'; S.active = null; S.order = [];
  for (const m of S.mechs) {
    const st = stats(m);
    m.ap = (m.shutdown || st.underpowered) ? 1 : trait(m.owner, 'ap');
    if (m.shock) { m.ap = Math.max(1, m.ap - 1); m.shock = 0; }
    m.activated = false; m.braced = false; m.fired = {}; m.moves = 0; m.overwatch = false; m.rammed = false;
  }
  log('Combat begins.', 'sys');
  S.current = S.first;
  if (!activatable(S.current).length) {
    if (activatable(1 - S.current).length) S.current = 1 - S.current;
    else resolution();
  }
}
const activatable = pid => S.mechs.filter(m => m.owner === pid && !m.activated);
function actGuard(m) {
  if (S.phase !== 'combat') return 'Mecha act during the Combat phase.';
  if (m.owner !== S.current) return 'It is the other commander\'s activation.';
  if (m.activated) return m.name + ' has already acted this round.';
  if (S.active != null && S.active !== m.uid) return 'Finish the current activation first.';
  if (m.ap < 1) return m.name + ' has no actions left.';
  return null;
}
function advanceTurn() {
  if (S.phase !== 'combat') return;
  const o = 1 - S.current;
  if (activatable(o).length) S.current = o;
  else if (!activatable(S.current).length) resolution();
}
function endActivation(m) {
  if (S.phase !== 'combat' || m.owner !== S.current || m.activated) return fail('That mech cannot end an activation now.');
  if (S.active != null && S.active !== m.uid) return fail('Finish the current activation first.');
  m.activated = true; S.active = null; mark(m);
  advanceTurn();
  return OK;
}
function passAll(pid) {
  if (S.phase !== 'combat' || S.current !== pid) return fail('Not your activation.');
  activatable(pid).forEach(m => { m.activated = true; mark(m); });
  S.active = null;
  log(S.players[pid].name + ' holds position with the rest of the force.', 'p' + pid);
  advanceTurn();
  return OK;
}
// supply a player collects at the end of a round, before any catch-up bonus
function incomeOf(p) {
  const n = S.objectives.filter(o => o.type === 'depot' && o.owner === p.id).length;
  const easy = isEasy(p) ? 3 : 0;   // the Recruit runs a lean factory
  return C.INCOME - easy + C.DEPOT * Math.min(n, C.DEPOT_FULL) + C.DEPOT_EXTRA * Math.max(0, n - C.DEPOT_FULL);
}
function catchupOf(p) {
  const gap = Math.abs((S.players[0].vp || 0) - (S.players[1].vp || 0));
  return Math.min(C.CATCHUP_MAX, Math.max(C.CATCHUP, gap * C.CATCHUP_PER_VP));
}
function aiLearn() {
  if (!S || S.phase !== 'over' || S.aiLearned) return;
  S.aiLearned = true;
  for (const p of S.players) {
    const a = p.ai;
    if (!a || !a.learn) continue;
    const pm = personaMem(a.persona), won = S.winner === p.id, foe = S.players[1 - p.id];
    pm.games++; if (won) pm.wins++;
    const v = pm.variants.find(x => x.id === a.vid);
    if (v) { v.games++; if (won) v.wins++; }
    // why did we lose? point future experiments the other way
    const L = pm.lessons;
    const nudge = (k, d) => { L[k] = clamp((L[k] || 0) + d, -6, 6); };
    if (!won) {
      if (S.winReason === 'base') { nudge('hold', 1); nudge('caution', 0.5); }
      else if ((foe.vp || 0) - (p.vp || 0) >= 4) { nudge('objective', 1); nudge('cohesion', -0.3); }
      if ((p.lost || 0) > (foe.lost || 0) + 2) { nudge('caution', 1); nudge('aggro', -0.5); }
      if ((foe.siegeDmg || 0) < 4 && (p.siegeDmg || 0) < 4) nudge('siege', 0.5);
    } else for (const k in L) L[k] *= 0.8;     // winning softens old lessons
    // a challenger that has had its trial is promoted if it beat the champion's record, or retired
    for (const c of pm.variants.filter(x => !x.champ && x.games >= TRIAL)) {
      const champ = pm.variants.find(x => x.champ);
      if (champ && vscore(c) > vscore(champ)) { champ.champ = false; c.champ = true; pm.variants.splice(pm.variants.indexOf(champ), 1); pm.promoted = (pm.promoted || 0) + 1; }
      else pm.variants.splice(pm.variants.indexOf(c), 1);
      pm.tried = (pm.tried || 0) + 1;
    }
  }
}
function checkWin() {
  if (S.phase === 'over') return true;
  const down = S.players.find(p => p.base.hp <= 0);
  if (!down) return false;
  down.base.hp = 0;
  if (S.phase === 'combat') {
    if (S.baseDown == null) {
      S.baseDown = down.id; S.active = null;
      log(down.name + "'s base is destroyed! The round ends here.", 'sys');
      resolution();
    }
    return true;
  }
  S.phase = 'over'; S.winner = 1 - down.id; S.active = null; S.winReason = 'base';
  log(down.name + "'s base lies in ruins. " + S.players[1 - down.id].name + ' wins the war.', 'sys');
  aiLearn();
  return true;
}
// a commander gives up the war: the other side wins at once
function concede(pid) {
  if (!S || S.phase === 'over') return fail('The war is already over.');
  S.phase = 'over'; S.winner = 1 - pid; S.winReason = 'concede'; S.active = null;
  log(S.players[pid].name + ' concedes. ' + S.players[1 - pid].name + ' wins the war.', 'sys');
  aiLearn();
  return OK;
}
function settle() {
  if (checkWin() || S.phase !== 'combat') return;
  if (S.active != null) {
    const m = fieldMech(S.active);
    if (!m) { (S.order = S.order || []).push({ uid: S.active, owner: S.current, name: '', dead: true }); S.active = null; advanceTurn(); }
    else if (m.ap <= 0) { m.activated = true; S.active = null; mark(m); advanceTurn(); }
  }
}

function reachable(m) {
  const max = m.entrenched ? 0 : stats(m).move, dist = {}, jump = locoMode(m) === 'jump';
  const seen = {}; seen[K(m.x, m.y)] = 0; dist[K(m.x, m.y)] = 0;
  const q = [[m.x, m.y]];
  while (q.length) {
    const [x, y] = q.shift(), d = seen[K(x, y)];
    if (d >= max) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy, k = K(nx, ny);
      if (k in seen || !inb(nx, ny)) continue;
      const open = passable(nx, ny) && !mechAt(nx, ny);
      if (!open && !(jump && baseAt(nx, ny) === null)) continue;
      seen[k] = d + 1; q.push([nx, ny]);
      if (open) dist[k] = d + 1;
    }
  }
  return dist;
}
function distMap(sources) {
  const dist = {}, q = [];
  sources.forEach(([x, y]) => { dist[K(x, y)] = 0; q.push([x, y]); });
  while (q.length) {
    const [x, y] = q.shift(), d = dist[K(x, y)];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy, k = K(nx, ny);
      if (!passable(nx, ny) || k in dist) continue;
      dist[k] = d + 1; q.push([nx, ny]);
    }
  }
  return dist;
}
function los(x0, y0, x1, y1) {
  if (x0 > x1 || (x0 === x1 && y0 > y1)) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
  const dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy)) * 4;
  for (let i = 1; i < n; i++) {
    const x = Math.round(x0 + dx * i / n), y = Math.round(y0 + dy * i / n);
    if ((x === x0 && y === y0) || (x === x1 && y === y1)) continue;
    if (terrain(x, y) === 'rock') return false;
  }
  return true;
}
function pathTo(m, x, y) {
  const prev = {}, q = [[m.x, m.y]], jump = locoMode(m) === 'jump';
  prev[K(m.x, m.y)] = null;
  while (q.length) {
    const [cx, cy] = q.shift();
    if (cx === x && cy === y) break;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy, k = K(nx, ny);
      if (k in prev || !inb(nx, ny)) continue;
      const open = passable(nx, ny) && !mechAt(nx, ny);
      if (!open && !(jump && baseAt(nx, ny) === null)) continue;
      prev[k] = [cx, cy]; q.push([nx, ny]);
    }
  }
  const out = [];
  let c = [x, y];
  while (c) { out.unshift(c); c = prev[K(c[0], c[1])]; }
  return out;
}
function move(m, x, y) {
  const g = actGuard(m); if (g) return fail(g);
  if (m.entrenched) return fail(m.name + ' is entrenched. Pack up first.');
  const r = reachable(m);
  if (!(K(x, y) in r) || (x === m.x && y === m.y)) return fail(m.name + ' cannot reach ' + coord(x, y) + ' this move.');
  const st = stats(m);
  S.active = m.uid; m.ap--; m.moves++; m.heat += st.moveHeat;
  const from = coord(m.x, m.y);
  const path = pathTo(m, x, y);
  const leaps = locoMode(m) === 'jump' && path.slice(1, -1).some(([px, py]) => !passable(px, py) || mechAt(px, py));
  fx({ k: 'move', uid: m.uid, path, jump: leaps });
  m.x = x; m.y = y;
  log(m.name + ' moves ' + from + ' → ' + coord(x, y) + '.', 'p' + m.owner);
  pickupCrate(m);
  triggerOverwatch(m);
  settle();
  return OK;
}
/* ---------- Ram: treads smash into an adjacent enemy and shove it back ---------- */
const RAM_DMG = 3, CRASH_DMG = 2;
function canRam(m) { return locoMode(m) === 'ram' && !m.rammed && m.ap > 0 && S.mechs.some(e => e.owner !== m.owner && man(e.x, e.y, m.x, m.y) === 1); }
function ramTargets(m) { return locoMode(m) === 'ram' && !m.rammed ? S.mechs.filter(e => e.owner !== m.owner && man(e.x, e.y, m.x, m.y) === 1) : []; }
function ram(m, uid) {
  const g = actGuard(m); if (g) return fail(g);
  if (locoMode(m) !== 'ram') return fail(m.name + ' has no treads to ram with.');
  if (m.rammed) return fail(m.name + ' has already rammed this activation.');
  const tm = fieldMech(uid);
  if (!tm || tm.owner === m.owner || man(tm.x, tm.y, m.x, m.y) !== 1) return fail('Ram an enemy right next to you.');
  S.active = m.uid; m.ap--; m.rammed = true; m.entrenched = false;
  fx({ k: 'shot', x0: m.x, y0: m.y, x1: tm.x, y1: tm.y, hit: true, cat: 'siege' });
  log(m.name + ' rams ' + tm.name + '.', 'p' + m.owner);
  const dx = tm.x - m.x, dy = tm.y - m.y, nx = tm.x + dx, ny = tm.y + dy;
  const immune = locoMode(tm) === 'surefoot' || locoMode(tm) === 'stable' || tm.entrenched;
  applyDamage(tm, rollLocation(tm), RAM_DMG, false);
  if (S.mechs.includes(tm) && !immune) {
    const other = mechAt(nx, ny);
    if (passable(nx, ny) && !other) {
      fx({ k: 'move', uid: tm.uid, path: [[tm.x, tm.y], [nx, ny]] });
      tm.x = nx; tm.y = ny;
      log(tm.name + ' is shoved back to ' + coord(nx, ny) + '.', 'hit');
    } else {
      // nowhere to go: it crashes into the obstacle
      log(tm.name + ' slams into ' + (other ? other.name : inb(nx, ny) ? 'the ' + (baseAt(nx, ny) != null ? 'base' : 'rubble') : 'the edge of the field') + '.', 'hit');
      applyDamage(tm, 'torso', CRASH_DMG, true);
      if (other && S.mechs.includes(other)) applyDamage(other, 'torso', 1, true);
    }
  } else if (S.mechs.includes(tm)) log(tm.name + ' holds its ground.', 'hit');
  settle();
  return OK;
}
/* ---------- Overwatch: hold fire, then shoot the first enemy that moves into range ---------- */
function owReady(o, key) {
  const inst = getSlot(o, key);
  return !!inst && inst.hp > 0 && (inst.ammo == null || inst.ammo > 0) && !(o.fired && o.fired[key]) && !weaponLock(o, key) && !DEFS[inst.id].weapon.repair;
}
function overwatch(m) {
  const g = actGuard(m); if (g) return fail(g);
  if (m.overwatch) return fail(m.name + ' is already on overwatch.');
  if (!weaponsOf(m).some(wp => owReady(m, wp.key))) return fail(m.name + ' has no weapon ready to cover with.');
  S.active = m.uid; m.ap--; m.overwatch = true;
  fxFloat(m.x, m.y, 'Overwatch', 'info');
  log(m.name + ' goes on overwatch.', 'p' + m.owner);
  settle();
  return OK;
}
function applyStatus(w, tm) {
  if (w.heatDmg) { tm.heat += w.heatDmg; fxFloat(tm.x, tm.y, '+' + w.heatDmg + ' heat', 'warn'); }
  if (w.burn) { tm.burn = Math.max(tm.burn || 0, w.burn); fxFloat(tm.x, tm.y, 'Burning', 'warn'); log(tm.name + ' is set on fire.', 'hit'); }
  if (w.slow) { tm.slow = Math.max(tm.slow || 0, w.slow); fxFloat(tm.x, tm.y, 'Slowed', 'info'); log(tm.name + ' is slowed.', 'hit'); }
  if (w.shock) { tm.shock = 1; fxFloat(tm.x, tm.y, 'Shocked', 'info'); log(tm.name + ' is shocked: one action next round.', 'hit'); }
}
function triggerOverwatch(mover) {
  for (const o of S.mechs.slice()) {
    if (!S.mechs.includes(mover)) return;
    if (o.owner === mover.owner || !o.overwatch || !S.mechs.includes(o)) continue;
    const st = stats(o);
    let best = null;
    for (const wp of weaponsOf(o)) {
      if (!owReady(o, wp.key) || !inRange(o, wp.w, st, mover.x, mover.y)) continue;
      const ch = hitChance(o, wp.key, mover, null), ev = ch * (wp.w.dmg + st.dmgBonus) * (wp.w.shots || 1);
      if (!best || ev > best.ev) best = { wp, ch, ev };
    }
    if (!best) continue;
    const { wp, ch } = best, w = wp.w, d = wp.def;
    o.overwatch = false; o.fired[wp.key] = true;
    if (wp.inst.ammo != null) wp.inst.ammo--;
    o.heat += w.heat + st.shotHeat;
    fxFloat(o.x, o.y, 'Overwatch!', 'warn');
    log('Overwatch! ' + o.name + ' fires ' + d.name + ' at ' + mover.name + ' (' + ch + '%).', 'p' + o.owner);
    for (let s = 0; s < (w.shots || 1) && S.mechs.includes(mover); s++) {
      const hit = rnd() * 100 < ch;
      fx({ k: 'shot', x0: o.x, y0: o.y, x1: mover.x, y1: mover.y, hit, cat: d.cat, uid: o.uid, key: wp.key });
      if (!hit) { fxFloat(mover.x, mover.y, 'Miss', 'info'); log(o.name + ' misses.', 'hit'); continue; }
      applyStatus(w, mover);
      applyDamage(mover, rollLocation(mover), w.dmg + st.dmgBonus, w.ap);
    }
  }
}
// every tile an enemy of pid has covered on overwatch, for warning the mover
function overwatchCover(pid) {
  const out = {};
  for (const o of S.mechs) {
    if (o.owner === pid || !o.overwatch) continue;
    const st = stats(o);
    for (const wp of weaponsOf(o)) {
      if (!owReady(o, wp.key)) continue;
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (passable(x, y) && inRange(o, wp.w, st, x, y)) out[K(x, y)] = true;
    }
  }
  return out;
}

/* ---------- Supply crates: dropped mid-field, first mech to reach one takes it ---------- */
const crateAt = (x, y) => (S.crates || []).find(c => c.x === x && c.y === y) || null;
function pickupCrate(m) {
  const c = crateAt(m.x, m.y);
  if (!c) return;
  S.crates.splice(S.crates.indexOf(c), 1);
  const p = S.players[m.owner];
  if (c.kind === 'supply') {
    p.supply += c.amount;
    fxFloat(m.x, m.y, '+' + c.amount + ' Supply', 'good');
    log(m.name + ' grabs a supply crate: +' + c.amount + ' Supply.', 'p' + m.owner);
    salvagePoint(m);
  } else {
    p.workshop.push(mk(c.card, true));
    fxFloat(m.x, m.y, '★ ' + DEFS[c.card].name, 'good');
    log(m.name + ' grabs a crate holding ' + DEFS[c.card].name + '. It goes to the Workshop, free to fit.', 'p' + m.owner);
    salvagePoint(m);
  }
}
// a crate's point is banked now and scored with the rest at the end of the round
function salvagePoint(m) {
  if (!rule('crateVp', 0)) return;
  const p = S.players[m.owner];
  p.salvage = (p.salvage || 0) + rule('crateVp', 0);
}
function crateContents(x, y) {
  const specials = Object.values(DEFS).filter(d => d.special).map(d => d.id);
  return rnd() < 0.6 ? { x, y, kind: 'supply', amount: rule('crateSupply', C.CRATE_SUPPLY) } : { x, y, kind: 'card', card: specials[Math.floor(rnd() * specials.length)] };
}
function dropCrate() {
  S.crates = S.crates || [];
  const free = (x, y) => passable(x, y) && !mechAt(x, y) && !objAt(x, y) && !wreckAt(x, y) && !crateAt(x, y);
  if (rule('cratePairs', false)) {
    // one crate and its mirror image, so both sides are the same distance from salvage
    if (S.crates.length + 2 > rule('crateMax', 2)) return;
    const [lo, hi] = rule('crateBand', [0, W - 1]), tiles = [];
    for (let x = lo; x <= hi; x++) for (let y = 0; y < H; y++) {
      const mx = W - 1 - x, my = H - 1 - y;
      if ((x < mx || (x === mx && y < my)) && free(x, y) && free(mx, my)) tiles.push([x, y]);
    }
    if (!tiles.length) return;
    const [x, y] = tiles[Math.floor(rnd() * tiles.length)];
    for (const [cx, cy] of [[x, y], [W - 1 - x, H - 1 - y]]) {
      const c = crateContents(cx, cy);
      S.crates.push(c);
      fx({ k: 'drop', x: cx, y: cy });
    }
    log('Salvage crates land at ' + coord(x, y) + ' and ' + coord(W - 1 - x, H - 1 - y) + '.', 'sys');
    return;
  }
  if (S.crates.length >= 2) return;
  const mid = Math.floor(W / 2);
  let tiles = [];
  for (let y = 0; y < H; y++) if (free(mid, y)) tiles.push([mid, y]);   // the centre column is the same distance from both bases
  if (!tiles.length) for (let x = mid - 1; x <= mid + 1; x++) for (let y = 0; y < H; y++) if (free(x, y)) tiles.push([x, y]);
  if (!tiles.length) return;
  const [x, y] = tiles[Math.floor(rnd() * tiles.length)];
  const c = crateContents(x, y);
  S.crates.push(c);
  fx({ k: 'drop', x, y });
  log('A supply crate lands at ' + coord(x, y) + (c.kind === 'supply' ? ': +' + c.amount + ' Supply.' : ' holding ' + DEFS[c.card].name + '.'), 'sys');
}
// an objective scores for a player if it is a radar, or a depot on the enemy's half of the map
function scores(o, pid) { return o.type === 'radar' || o.type === 'uplink' || (o.type === 'depot' && rule('depotVp', true) && (pid === 0 ? o.x > (W - 1) / 2 : o.x < (W - 1) / 2)); }
const objVp = o => (o.type === 'uplink' ? rule('uplinkVp', 2) : 1);
const OBJ_NAME = { depot: 'supply depot', radar: 'radar station', uplink: 'uplink', repair: 'repair station' };
// every tile a mech could hit: now, or after one move
function reachZone(m) {
  const now = {}, later = {}, st = stats(m);
  const ws = weaponsOf(m).filter(wp => !wp.w.repair && wp.inst.hp > 0 && (wp.inst.ammo == null || wp.inst.ammo > 0));
  if (!ws.length || m.x == null) return { now, later };
  const ox = m.x, oy = m.y;
  const spots = m.entrenched ? [[m.x, m.y]] : Object.keys(reachable(m)).map(k => k.split(',').map(Number));
  for (const [sx, sy] of spots) withPos(m, sx, sy, () => {
    for (const wp of ws) {
      if (weaponLock(m, wp.key) && !(MW_canDig(m))) continue;
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
        if (x === sx && y === sy) continue;
        if (inRange(m, wp.w, st, x, y)) { if (sx === ox && sy === oy && !weaponLock(m, wp.key)) now[K(x, y)] = true; else if (!now[K(x, y)]) later[K(x, y)] = true; }
      }
    }
  });
  for (const k in now) delete later[k];
  return { now, later };
}
function MW_canDig(m) { return canEntrench(m); }
function inRange(m, w, st, tx, ty) {
  const d = man(m.x, m.y, tx, ty);
  return d <= effRange(w, st) && d >= (w.min || 1) && (w.indirect || los(m.x, m.y, tx, ty));
}
// all tiles within a weapon's reach from where the mech stands (line of sight aside)
function rangeTiles(m, key) {
  const inst = getSlot(m, key);
  if (!inst || !DEFS[inst.id].weapon || m.x == null) return [];
  const w = DEFS[inst.id].weapon, r = w.repair ? w.range : effRange(w, stats(m)), lo = w.repair ? 1 : (w.min || 1), out = [];
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { const d = man(m.x, m.y, x, y); if (d <= r && d >= lo) out.push([x, y]); }
  return out;
}
function isDamaged(m) { return partsOf(m).some(({ inst }) => inst.hp > 0 && inst.hp < DEFS[inst.id].hp); }
function validTargets(m, key) {
  const inst = getSlot(m, key);
  if (!inst || !DEFS[inst.id].weapon || m.x == null) return [];
  if (weaponLock(m, key)) return [];
  const w = DEFS[inst.id].weapon, st = stats(m), out = [];
  if (w.repair) {
    for (const o of S.mechs) if (o.owner === m.owner && o !== m && man(m.x, m.y, o.x, o.y) <= w.range && isDamaged(o)) out.push({ type: 'mech', uid: o.uid, x: o.x, y: o.y });
    return out;
  }
  for (const o of S.mechs) if (o.owner !== m.owner && inRange(m, w, st, o.x, o.y)) out.push({ type: 'mech', uid: o.uid, x: o.x, y: o.y });
  const b = BASE_POS[1 - m.owner];
  if (inRange(m, w, st, b.x, b.y)) out.push({ type: 'base', pid: 1 - m.owner, x: b.x, y: b.y });
  return out;
}
function radarBonus(pid) { return S.objectives.filter(o => o.type === 'radar' && o.owner === pid).length * C.RADAR_ACC; }
function hitChance(m, key, tm, part) {
  const w = DEFS[getSlot(m, key).id].weapon, st = stats(m), ts = stats(tm);
  let c = w.acc + radarBonus(m.owner) + (m.moves ? 0 : trait(m.owner, 'steady'));
  if (m.moves && mountOf(DEFS[getSlot(m, key).id]) === 'heavy' && locoMode(m) !== 'stable' && !m.entrenched) c -= 15;
  c -= ts.evasive || 0;
  if (terrain(tm.x, tm.y) === 'ruins' && !w.melee && !st.ignoreCover) c -= 20;
  if (part) c -= part === 'core' ? 25 : 10;
  return Math.max(5, Math.min(95, c));
}
function rollLocation(tm) {
  const wts = { torso: 48, legs: 20, armL: 12, armR: 12, core: 8 };
  const opts = Object.keys(wts).filter(k => tm.slots[k] && tm.slots[k].hp > 0);
  let r = rnd() * opts.reduce((a, k) => a + wts[k], 0);
  for (const k of opts) { r -= wts[k]; if (r < 0) return k; }
  return 'torso';
}
function mostDamaged(m) {
  let best = null;
  for (const { inst } of partsOf(m)) {
    const miss = DEFS[inst.id].hp - inst.hp;
    if (inst.hp > 0 && miss > 0 && (!best || miss > DEFS[best.id].hp - best.hp)) best = inst;
  }
  return best;
}
function applyDamage(tm, loc, dmg, ap) {
  if (!S.mechs.includes(tm)) return;
  let inst = getSlot(tm, loc);
  if (!inst || inst.hp <= 0) { loc = 'torso'; inst = tm.slots.torso; }
  if (tm.shield > 0) {
    const a = Math.min(tm.shield, dmg); tm.shield -= a; dmg -= a;
    if (dmg <= 0) { fxFloat(tm.x, tm.y, 'Blocked', 'info'); log(tm.name + "'s shield absorbs the hit.", 'hit'); return; }
  }
  const st = stats(tm), d = DEFS[inst.id];
  const armor = ap ? 0 : (d.armor || 0) + st.armorAll + (tm.braced ? 1 : 0);
  dmg = Math.max(1, dmg - armor);
  fxFloat(tm.x, tm.y, '−' + dmg, 'bad');
  // every hit lands on the hull (the frame); a hit on another part also knocks points off that part
  const frame = tm.slots.torso;
  if (loc !== 'torso') {
    const a = Math.min(Math.max(0, inst.hp), dmg);
    inst.hp -= a;
    if (a && inst.hp === 0) { log(tm.name + "'s " + d.name + ' (' + slotName(loc).toLowerCase() + ') is knocked out.', 'kill'); fxFloat(tm.x, tm.y, d.name + ' out', 'warn'); }
  }
  let left = dmg;
  const lg = tm.slots.legs;
  if (hullOf(tm) > 0) { const a = Math.min(hullOf(tm), left); lg.hullHp = hullOf(tm) - a; left -= a; }
  const pl = Math.min(plateMax(tm), tm.plate == null ? plateMax(tm) : tm.plate);
  if (pl > 0 && left > 0) { const a = Math.min(pl, left); tm.plate = pl - a; left -= a; }
  frame.hp = Math.max(0, frame.hp - left);
  log(tm.name + ' takes ' + dmg + ' damage' + (loc !== 'torso' ? ' to its ' + slotName(loc).toLowerCase() : '') + ': HP ' + hpOf(tm) + '/' + maxHpOf(tm) + '.', hpOf(tm) === 0 ? 'kill' : 'hit');
  if (hpOf(tm) <= 0) destroyMech(tm);
}
function destroyMech(tm) {
  const i = S.mechs.indexOf(tm);
  if (i < 0) return;
  S.mechs.splice(i, 1);
  S.players[tm.owner].lost++; S.players[1 - tm.owner].kills++;
  // a lost mech teaches caution; a kill builds confidence
  aiAdjust(tm.owner, 'caution', 0.12); aiAdjust(1 - tm.owner, 'aggro', 0.05);
  { const k = S.players[1 - tm.owner]; if (C.BOUNTY && (k.vp || 0) < (S.players[tm.owner].vp || 0)) k.bounty = (k.bounty || 0) + C.BOUNTY; } S.players[tm.owner].names.push(tm.name);
  const parts = [];
  for (const { inst } of partsOf(tm)) if (inst.hp > 0 && !DEFS[inst.id].basic && rnd() < C.SALVAGE_CHANCE) { inst.paid = true; parts.push(inst); }
  let w = wreckAt(tm.x, tm.y);
  if (!w) { w = { x: tm.x, y: tm.y, parts: [], scrap: 0 }; S.wrecks.push(w); }
  w.parts.push(...parts); w.scrap += C.SCRAP;
  fx({ k: 'boom', x: tm.x, y: tm.y, uid: tm.uid });
  const breach = DEFS[tm.slots.core.id].breach || 0;
  log(tm.name + ' is destroyed at ' + coord(tm.x, tm.y) + (breach ? ' and its unstable core detonates!' : '.') + (parts.length ? ' Wreck holds: ' + parts.map(p => DEFS[p.id].name).join(', ') + '.' : ''), 'kill');
  if (breach) {
    for (const o of S.mechs.slice()) if (S.mechs.includes(o) && man(o.x, o.y, tm.x, tm.y) === 1) applyDamage(o, 'torso', breach, false);
  }
}
function fire(m, key, target, part) {
  const g = actGuard(m); if (g) return fail(g);
  const inst = getSlot(m, key);
  if (!inst || !DEFS[inst.id].weapon) return fail('No weapon in that arm.');
  const d = DEFS[inst.id], w = d.weapon;
  if (inst.hp <= 0) return fail(d.name + ' is destroyed.');
  const lock = weaponLock(m, key);
  if (lock) return fail(d.name + ': ' + lock.toLowerCase() + '.');
  if (m.fired[key]) return fail(d.name + ' has already been used this activation.');
  if (inst.ammo != null && inst.ammo <= 0) return fail(d.name + ' is out of ammunition. Return to base to resupply.');
  const t = validTargets(m, key).find(v => v.type === target.type && (v.type === 'base' || v.uid === target.uid));
  if (!t) return fail('That target is out of range or out of sight.');
  const st = stats(m);
  S.active = m.uid; m.ap--; m.fired[key] = true;
  if (inst.ammo != null) inst.ammo--;
  m.heat += w.heat + st.shotHeat;
  if (w.repair) {
    const tm = fieldMech(t.uid), pi = mostDamaged(tm), pd = DEFS[pi.id];
    pi.hp = Math.min(pd.hp, pi.hp + w.repair);
    fx({ k: 'shot', x0: m.x, y0: m.y, x1: tm.x, y1: tm.y, hit: true, cat: 'support' });
    fxFloat(tm.x, tm.y, '+' + w.repair + ' HP', 'good');
    log(m.name + ' repairs ' + tm.name + "'s " + pd.name + '.', 'p' + m.owner);
    settle(); return OK;
  }
  const dmg = w.dmg + st.dmgBonus + (w.melee ? st.meleeBonus : 0);
  for (let s = 0; s < (w.shots || 1); s++) {
    if (t.type === 'base') {
      const bd = Math.round(dmg * (w.siege || 1)), bp = S.players[t.pid];
      bp.base.hp -= bd; S.players[m.owner].siegeDmg = (S.players[m.owner].siegeDmg || 0) + bd;
      aiAdjust(t.pid, 'hold', 0.08);
      fx({ k: 'shot', x0: m.x, y0: m.y, x1: t.x, y1: t.y, hit: true, cat: d.cat, uid: m.uid, key });
      fxFloat(t.x, t.y, '−' + bd, 'bad');
      log(m.name + ' hits ' + bp.name + "'s base with " + d.name + ' for ' + bd + '. Base at ' + Math.max(0, bp.base.hp) + '.', 'kill');
      if (bp.base.hp <= 0) break;
    } else {
      const tm = fieldMech(t.uid);
      if (!tm) break;
      const ch = hitChance(m, key, tm, part), hit = rnd() * 100 < ch;
      fx({ k: 'shot', x0: m.x, y0: m.y, x1: tm.x, y1: tm.y, hit, cat: d.cat, uid: m.uid, key });
      if (!hit) { fxFloat(tm.x, tm.y, 'Miss', 'info'); log(m.name + ' fires ' + d.name + ' at ' + tm.name + ' (' + ch + '%) and misses.', 'p' + m.owner); continue; }
      log(m.name + ' fires ' + d.name + ' at ' + tm.name + ' (' + ch + '%) and hits.', 'p' + m.owner);
      if (w.heatDmg) { tm.heat += w.heatDmg; fxFloat(tm.x, tm.y, '+' + w.heatDmg + ' heat', 'warn'); }
      if (w.burn) { tm.burn = Math.max(tm.burn || 0, w.burn); fxFloat(tm.x, tm.y, 'Burning', 'warn'); log(tm.name + ' is set on fire.', 'hit'); }
      if (w.slow) { tm.slow = Math.max(tm.slow || 0, w.slow); fxFloat(tm.x, tm.y, 'Slowed', 'info'); log(tm.name + ' is slowed.', 'hit'); }
      if (w.shock) { tm.shock = 1; fxFloat(tm.x, tm.y, 'Shocked', 'info'); log(tm.name + ' is shocked: one action next round.', 'hit'); }
      applyDamage(tm, part || rollLocation(tm), dmg, w.ap);
    }
  }
  settle();
  return OK;
}
function brace(m) {
  const g = actGuard(m); if (g) return fail(g);
  if (m.braced) return fail(m.name + ' is already braced.');
  S.active = m.uid; m.ap--; m.braced = true;
  fx({ k: 'brace', x: m.x, y: m.y });
  log(m.name + ' braces (+1 armor until next round).', 'p' + m.owner);
  settle();
  return OK;
}
function entrench(m) {
  const g = actGuard(m); if (g) return fail(g);
  if (!canEntrench(m)) return fail(m.name + ' has no legs that can entrench.');
  if (m.entrenched) return fail(m.name + ' is already entrenched.');
  S.active = m.uid; m.ap--; m.entrenched = true;
  fx({ k: 'brace', x: m.x, y: m.y }); fxFloat(m.x, m.y, 'Entrenched', 'info');
  log(m.name + ' digs in at ' + coord(m.x, m.y) + '. Weapons online, +1 armor.', 'p' + m.owner);
  settle();
  return OK;
}
function unentrench(m) {
  const g = actGuard(m); if (g) return fail(g);
  if (!m.entrenched) return fail(m.name + ' is not entrenched.');
  S.active = m.uid; m.ap--; m.entrenched = false;
  fxFloat(m.x, m.y, 'Packed up', 'info');
  log(m.name + ' pulls up its anchors.', 'p' + m.owner);
  settle();
  return OK;
}
function salvage(m) {
  const g = actGuard(m); if (g) return fail(g);
  const w = wreckAt(m.x, m.y);
  if (!w) return fail('No wreck here to salvage.');
  const p = S.players[m.owner];
  S.active = m.uid; m.ap--;
  p.workshop.push(...w.parts); p.supply += w.scrap;
  S.wrecks.splice(S.wrecks.indexOf(w), 1);
  fxFloat(m.x, m.y, '+' + w.scrap + ' Supply', 'good');
  if (w.parts.length) fxFloat(m.x, m.y, '+' + w.parts.length + (w.parts.length > 1 ? ' parts' : ' part'), 'good');
  log(m.name + ' salvages the wreck: +' + w.scrap + ' Supply' + (w.parts.length ? ', ' + w.parts.map(x => DEFS[x.id].name).join(', ') + ' sent to the Workshop.' : '.'), 'p' + m.owner);
  settle();
  return OK;
}
/* ---------- Last resorts for a mech that can no longer fight ---------- */
// blast strength comes from the core's output; full damage to adjacent tiles, half at range 2
function coreBlast(m) { const c = m.slots.core; return c && c.hp > 0 ? 3 + Math.floor((DEFS[c.id].power || 0) / 4) : 0; }
function selfDestruct(m) {
  const g = actGuard(m); if (g) return fail(g);
  const dmg = coreBlast(m);
  if (!dmg) return fail(m.name + "'s core is knocked out and cannot detonate.");
  const ox = m.x, oy = m.y, owner = m.owner, p = S.players[owner];
  S.mechs.splice(S.mechs.indexOf(m), 1);
  p.lost++; p.names.push(m.name); mark(m); S.active = null;
  fx({ k: 'nuke', uid: m.uid, x: ox, y: oy, owner, r: 2 });
  log(m.name + ' overloads its core and detonates at ' + coord(ox, oy) + '!', 'kill');
  for (const o of S.mechs.slice()) {
    if (!S.mechs.includes(o)) continue;
    const d = man(o.x, o.y, ox, oy);
    if (d <= 2) applyDamage(o, 'torso', d <= 1 ? dmg : Math.ceil(dmg / 2), true);
  }
  for (const q of S.players) if (q.id !== owner && man(q.base.x, q.base.y, ox, oy) <= 1) {
    q.base.hp -= dmg; S.players[owner].siegeDmg = (S.players[owner].siegeDmg || 0) + dmg; fxFloat(q.base.x, q.base.y, '−' + dmg, 'bad');
    log('The blast hits ' + q.name + "'s base for " + dmg + '. Base at ' + Math.max(0, q.base.hp) + '.', 'kill');
  }
  S.flat = S.flat || [];
  for (let x = ox - 1; x <= ox + 1; x++) for (let y = oy - 1; y <= oy + 1; y++) {
    if (!inb(x, y) || man(x, y, ox, oy) > 1) continue;
    if (TERRAIN[K(x, y)] === 'ruins' && S.flat.indexOf(K(x, y)) < 0) { S.flat.push(K(x, y)); log('The ruins at ' + coord(x, y) + ' collapse into rubble.', 'hit'); }
    const o = objAt(x, y);
    if (o && o.owner != null && o.type !== 'repair') { o.owner = null; log('The ' + (o.type === 'depot' ? 'supply depot' : 'radar station') + ' at ' + coord(x, y) + ' is knocked back to neutral.', 'hit'); }
    const w = wreckAt(x, y);
    if (w) S.wrecks.splice(S.wrecks.indexOf(w), 1);
  }
  if (!checkWin()) advanceTurn();
  return OK;
}
// strip the mech where it stands: surviving special parts go back to the Workshop, standard parts are scrapped for 1 Supply each
function fieldStrip(m) {
  const g = actGuard(m); if (g) return fail(g);
  const p = S.players[m.owner];
  let parts = 0, scrap = 0;
  for (const { inst } of partsOf(m)) {
    if (inst.hp <= 0) continue;
    if (DEFS[inst.id].basic) scrap++; else { inst.paid = true; p.workshop.push(inst); parts++; }
  }
  p.supply += scrap;
  fx({ k: 'strip', uid: m.uid, x: m.x, y: m.y, owner: m.owner });
  if (scrap) fxFloat(m.x, m.y, '+' + scrap + ' Supply', 'good');
  log(p.name + ' strips ' + m.name + ' in the field: ' + parts + ' part' + (parts === 1 ? '' : 's') + ' back to the Workshop, +' + scrap + ' Supply.', 'p' + m.owner);
  S.mechs.splice(S.mechs.indexOf(m), 1);
  p.names.push(m.name); mark(m); S.active = null;
  advanceTurn();
  return OK;
}
function enterBase(m) {
  const g = actGuard(m); if (g) return fail(g);
  const p = S.players[m.owner];
  if (!inDeployZone(m)) return fail(m.name + ' must be next to your base to enter it.');
  if (m.entrenched) return fail(m.name + ' must pack up before it can move.');
  if (hangarFull(p)) return fail('The hangar is full.');
  if (p.hangar.length >= hangarMax(p)) dropBlank(p, p.hangar.find(isBlank));
  S.mechs.splice(S.mechs.indexOf(m), 1);
  log(m.name + ' returns to base from ' + coord(m.x, m.y) + '. Heat vented, ammunition restocked.', 'p' + m.owner);
  fx({ k: 'enter', uid: m.uid, x: m.x, y: m.y, owner: m.owner });
  mark(m);
  m.x = null; m.y = null; m.plate = plateMax(m); m.heat = 0; m.entrenched = false; m.burn = 0; m.slow = 0; m.shock = 0; m.ap = 0; m.activated = true; m.braced = false; m.shutdown = false; m.shield = 0;
  for (const { inst } of partsOf(m)) { const w = DEFS[inst.id].weapon; if (w && w.ammo) inst.ammo = w.ammo; }
  p.hangar.push(m);
  S.active = null;
  advanceTurn();
  return OK;
}

/* ---------- Resolution ---------- */
function resolution() {
  S.phase = 'resolve'; S.active = null;
  log('Resolution.', 'sys');
  for (const m of S.mechs) {
    const pr = trait(m.owner, 'plateRegen'), pm = plateMax(m);
    if (pr && pm) m.plate = Math.min(pm, (m.plate == null ? pm : m.plate) + pr);
    // overclock heat can be fractional: it builds up and lands a point at a time
    const ht = trait(m.owner, 'heatTick'); if (ht) { m.heatAcc = (m.heatAcc || 0) + ht; const add = Math.floor(m.heatAcc); m.heatAcc -= add; m.heat += add; }
  }
  for (const m of S.mechs.slice()) {
    if (!S.mechs.includes(m)) continue;
    const st = stats(m);
    m.heat += st.passiveHeat;
    if (m.heat > st.heatCap) {
      const ex = m.heat - st.heatCap, core = m.slots.core;
      m.shutdown = true;
      log(m.name + ' overheats: ' + ex + ' damage to its ' + DEFS[core.id].name + ', emergency shutdown next round.', 'kill');
      applyDamage(m, 'core', ex, true);
      if (!S.mechs.includes(m)) continue;
    } else m.shutdown = false;
    m.heat = Math.max(0, m.heat - st.cooling);
    if (st.selfRepair) { const pi = mostDamaged(m); if (pi) pi.hp = Math.min(DEFS[pi.id].hp, pi.hp + st.selfRepair); }
    m.shield = st.shield;
    if (m.slow > 0) m.slow--;
    if (m.burn > 0) { m.burn--; log(m.name + ' burns.', 'hit'); applyDamage(m, rollLocation(m), 1, true); }
  }
  for (const o of S.objectives) {
    let m = mechAt(o.x, o.y);
    // armies with zone control hold objectives from an adjacent tile, if no enemy stands as close
    if (!m && o.type !== 'repair') {
      const near = S.mechs.filter(q => trait(q.owner, 'control') && man(q.x, q.y, o.x, o.y) <= trait(q.owner, 'control'));
      const rivals = q => S.mechs.some(e => e.owner !== q.owner && man(e.x, e.y, o.x, o.y) <= man(q.x, q.y, o.x, o.y));
      m = near.find(q => !rivals(q)) || null;
    }
    if (!m) continue;
    if (o.type === 'repair') {
      const pi = mostDamaged(m);
      if (pi) { pi.hp = Math.min(DEFS[pi.id].hp, pi.hp + C.STATION_REPAIR); fxFloat(m.x, m.y, '+' + C.STATION_REPAIR + ' HP', 'good'); log('The repair station patches ' + m.name + "'s " + DEFS[pi.id].name + '.', 'p' + m.owner); }
      m.heat = Math.max(0, m.heat - 2);
    } else if (o.owner !== m.owner) {
      o.owner = m.owner;
      fx({ k: 'capture', x: o.x, y: o.y, owner: m.owner });
      log(S.players[m.owner].name + ' captures the ' + OBJ_NAME[o.type] + ' at ' + coord(o.x, o.y) + '.', 'p' + m.owner);
    }
  }
  for (const p of S.players) {
    if (p.base.hp <= 0) continue;
    for (let shot = 0; shot < trait(p.id, 'turretShots'); shot++) {
    const near = S.mechs.filter(m => m.owner !== p.id && man(m.x, m.y, p.base.x, p.base.y) <= C.TURRET_RANGE);
    if (!near.length) break;
    near.sort((a, b) => hpOf(a) - hpOf(b));
    const tm = near[0];
    fx({ k: 'shot', x0: p.base.x, y0: p.base.y, x1: tm.x, y1: tm.y, hit: true, cat: 'turret' });
    log(p.name + "'s base turret fires on " + tm.name + '.', 'p' + p.id);
    applyDamage(tm, rollLocation(tm), C.TURRET_DMG + trait(p.id, 'turretDmg'), false);
    }
  }
  const trailing = (S.players[0].vp || 0) === (S.players[1].vp || 0) ? null : ((S.players[0].vp || 0) < (S.players[1].vp || 0) ? 0 : 1);
  for (const p of S.players) {
    const bonus = p.id === trailing ? catchupOf(p) : 0;
    p.supply += incomeOf(p) + bonus;
    if (bonus) log(p.name + ' is behind on points: +' + bonus + ' Supply.', 'p' + p.id);
  }
  if (checkWin()) return;
  // victory points: one per depot or radar held at the end of each round, plus pressure on the enemy base
  for (const p of S.players) {
    let n = S.objectives.filter(o => o.owner === p.id && scores(o, p.id)).reduce((a, o) => a + objVp(o), 0);
    if (C.VP_ROUND_CAP) n = Math.min(n, C.VP_ROUND_CAP);
    if (C.LEAD_GAP && S.round <= C.LEAD_UNTIL && (p.vp || 0) - (S.players[1 - p.id].vp || 0) >= C.LEAD_GAP) n = Math.min(n, C.LEAD_CAP);
    if (p.salvage) { n += p.salvage; log(p.name + ' earns ' + p.salvage + ' victory point' + (p.salvage > 1 ? 's' : '') + ' for salvage.', 'p' + p.id); p.salvage = 0; }
    if (p.bounty) { n += p.bounty; log(p.name + ' earns ' + p.bounty + ' bounty point' + (p.bounty > 1 ? 's' : '') + ' for kills on the leader.', 'p' + p.id); p.bounty = 0; }
    // attrition armies score for wrecking the enemy force
    if (trait(p.id, 'killVp')) {
      const kv = Math.floor((p.kills || 0) * trait(p.id, 'killVp') + 1e-9) - (p.killVpGot || 0);
      if (kv > 0) { p.killVpGot = (p.killVpGot || 0) + kv; n += kv; log(p.name + ' earns ' + kv + ' victory point' + (kv > 1 ? 's' : '') + ' for enemy mecha destroyed.', 'p' + p.id); }
    }
    if (C.BASE_VP_PER) {
      const earned = Math.floor((p.siegeDmg || 0) / C.BASE_VP_PER) - (p.siegeVp || 0);
      if (earned > 0) { p.siegeVp = (p.siegeVp || 0) + earned; n += earned; log(p.name + ' earns ' + earned + ' victory point' + (earned > 1 ? 's' : '') + ' for pressure on the enemy base.', 'p' + p.id); }
    }
    if (!n) continue;
    p.vp = (p.vp || 0) + n;
    log(p.name + ' scores ' + n + ' victory point' + (n > 1 ? 's' : '') + ' (' + p.vp + '/' + C.VP_WIN + ').', 'p' + p.id);
    fx({ k: 'vp', pid: p.id, n });
  }
  const [pa, pb] = S.players;
  if ((pa.vp >= C.VP_WIN || pb.vp >= C.VP_WIN) && pa.vp !== pb.vp) {
    S.phase = 'over'; S.winner = pa.vp > pb.vp ? 0 : 1; S.winReason = 'points'; S.active = null;
    log(S.players[S.winner].name + ' reaches ' + S.players[S.winner].vp + ' victory points and wins the war.', 'sys');
    aiLearn();
    return;
  }
  if (S.round % rule('crateEvery', C.CRATE_EVERY) === (rule('crateEvery', C.CRATE_EVERY) === 1 ? 0 : 1)) dropCrate();
  S.round++; S.first = 1 - S.first;
  log('Round ' + S.round + ' begins.', 'sys');
  startBuildPhase();
}

/* ---------- AI commander ---------- */
/* ---------- AI commanders ----------
   Every AI side is led by a commander with a personality: a set of weights that shape how it builds, deploys,
   moves and shoots. Each round it reads the situation and picks a stance (defend, raid, press, regroup).
   During a war it adjusts to what hurts it; across wars it keeps a few variants of its playbook per personality,
   mostly plays the one that has won most, and now and then tries a mutated one, steered away from how it lost. */
const PERSONAS = {
  blitz: { name: 'Blitz', blurb: 'Hits first and drives at the enemy base.', w: { aggro: 0.85, objective: 1.05, siege: 1.35, caution: 0.4, focus: 0.9, cohesion: 0.6, swarm: 0.85, tech: 0.3, hold: 0.1, overwatch: 0.2 } },
  warden: { name: 'Warden', blurb: 'Holds ground, covers it with overwatch and bleeds the attacker.', w: { aggro: 0.4, objective: 1.1, siege: 0.4, caution: 1.4, focus: 0.8, cohesion: 0.7, swarm: 0.3, tech: 0.7, hold: 0.9, overwatch: 0.95 } },
  raider: { name: 'Raider', blurb: 'Spreads out to grab objectives and race on points.', w: { aggro: 0.35, objective: 1.8, siege: 0.6, caution: 0.9, focus: 0.5, cohesion: 0.05, swarm: 0.65, tech: 0.4, hold: 0.3, overwatch: 0.4 } },
  hunter: { name: 'Hunter', blurb: 'Moves as a pack and focuses fire to destroy mecha.', w: { aggro: 0.9, objective: 1.05, siege: 0.5, caution: 0.8, focus: 1.8, cohesion: 0.75, swarm: 0.4, tech: 0.6, hold: 0.2, overwatch: 0.6 } },
  // a gentle opponent for learning: slow to attack, rarely goes for the base, short on Supply, and never learns
  recruit: { name: 'Recruit', easy: true, blurb: 'An easy opponent for learning: cautious, slow to attack, fields at most two mecha and is short on Supply.', w: { aggro: 0.2, objective: 0.8, siege: 0.15, caution: 1.2, focus: 0.2, cohesion: 0.5, swarm: 0.3, tech: 0.2, hold: 0.5, overwatch: 0.1 } },
  // the old single-minded AI, kept as a yardstick for testing
  classic: { name: 'Classic', hidden: true, w: { aggro: 0.5, objective: 1, siege: 1, caution: 0, focus: 0, cohesion: 0, swarm: 0.5, tech: 0.5, hold: 0, overwatch: 0.5 } }
};
const W_KEYS = ['aggro', 'objective', 'siege', 'caution', 'focus', 'cohesion', 'swarm', 'tech', 'hold', 'overwatch'];
const STANCES = {
  defend: { label: 'pulls back to defend its base', mod: { siege: -1, hold: 1.2, caution: 0.3, objective: -0.3 } },
  raid: { label: 'spreads out to raid objectives', mod: { objective: 0.9, aggro: -0.1, cohesion: -0.4 } },
  press: { label: 'presses the attack on the enemy base', mod: { siege: 1.0, aggro: 0.3, objective: -0.5 } },
  regroup: { label: 'regroups to fight together', mod: { cohesion: 0.7, caution: 0.5, aggro: -0.2 } },
  hunt: { label: 'closes in for the kill', mod: { aggro: 0.4, focus: 0.6 } }
};
// every commander plays to its army: heavy machines fight forward, swarms spread over the objectives
const DOCTRINE_STYLE = {
  armored: { aggro: 0.35, focus: 0.3, caution: -0.45, cohesion: 0.3, siege: 0.2, objective: -0.1 },
  assault: { objective: 0.15, swarm: 0.3, cohesion: -0.1 },
  experimental: { aggro: 0.1 }
};
let AIMEM = { v: 1, personas: {} };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function personaMem(id) { return AIMEM.personas[id] = AIMEM.personas[id] || { games: 0, wins: 0, variants: [], lessons: {} }; }
// pick the playbook for this war: the proven champion most of the time, a challenger on trial otherwise
const TRIAL = 6;
const vscore = v => (v.wins + 1) / (v.games + 2);
function chooseVariant(id, learn) {
  const base = PERSONAS[id].w;
  if (!learn) return { vid: 'base', w: Object.assign({}, base), experiment: false };
  const pm = personaMem(id);
  if (!pm.variants.length) pm.variants.push({ id: 'v0', w: Object.assign({}, base), games: 0, wins: 0, champ: true });
  const champ = pm.variants.find(v => v.champ) || pm.variants[0];
  champ.champ = true;
  const trials = pm.variants.filter(v => !v.champ);
  // experiment: a new challenger, mutated from the champion and steered by the lessons of past defeats
  if (trials.length < 2 && champ.games >= 3 && rnd() < 0.3) {
    const w = Object.assign({}, champ.w), keys = W_KEYS.slice().sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 2));
    for (const k of keys) w[k] = w[k] * (0.7 + rnd() * 0.6) + (rnd() - 0.5) * 0.3;
    for (const k in pm.lessons) if (W_KEYS.includes(k)) w[k] += 0.25 * Math.sign(pm.lessons[k]) * Math.min(1, Math.abs(pm.lessons[k]) / 3);
    // stay in character: a playbook may refine the personality, not abandon it
    for (const k of W_KEYS) w[k] = clamp(w[k], Math.max(0, base[k] - 0.5), base[k] + 0.5);
    pm.next = (pm.next || 1);
    const v = { id: 'v' + pm.next++, w, games: 0, wins: 0, from: champ.id };
    pm.variants.push(v);
    return { vid: v.id, w: Object.assign({}, w), experiment: true };
  }
  // challengers still on trial get half the wars until judged
  const open = trials.find(v => v.games < TRIAL);
  const pick = open && rnd() < 0.5 ? open : champ;
  return { vid: pick.id, w: Object.assign({}, pick.w), experiment: pick !== champ };
}
function setupCommander(p, o) {
  if (!p.isAI) { p.ai = null; return; }
  const ids = Object.keys(PERSONAS).filter(k => !PERSONAS[k].hidden && !PERSONAS[k].easy);
  const persona = PERSONAS[o.persona] ? o.persona : ids[Math.floor(rnd() * ids.length)];
  const learn = o.learn !== false && !PERSONAS[persona].easy;
  const v = chooseVariant(persona, learn);
  p.ai = { persona, vid: v.vid, w: v.w, experiment: v.experiment, learn, adj: {}, stance: null, stanceRound: 0, vpGap: 0 };
  const pm = learn ? personaMem(persona) : null;
  log(p.name + ' is led by a ' + PERSONAS[persona].name + ' commander: ' + PERSONAS[persona].blurb + (pm && pm.games ? ' (' + pm.wins + ' wins in ' + pm.games + ' wars' + (v.experiment ? ', trying a new playbook' : '') + ')' : ''), 'p' + p.id);
}
// the weights a commander plays by right now: its playbook, what it has learned this war, and its stance
function aiW(pid) {
  const p = S.players[pid], a = p && p.ai;
  if (!a) return PERSONAS.classic.w;
  const st = a.stance && STANCES[a.stance] ? STANCES[a.stance].mod : {}, ds = DOCTRINE_STYLE[p.doctrine] || {};
  const out = {};
  for (const k of W_KEYS) out[k] = clamp((a.w[k] || 0) + (a.adj[k] || 0) + (st[k] || 0) + (a.persona === 'classic' ? 0 : (ds[k] || 0)), 0, 3);
  return out;
}
function aiAdjust(pid, k, d, cap) {
  const p = S.players[pid];
  if (!p || !p.ai) return;
  p.ai.adj[k] = clamp((p.ai.adj[k] || 0) + d, -(cap || 0.8), cap || 0.8);
}
// read the board once a round and choose how to fight it
function aiStance(pid) {
  const p = S.players[pid], a = p.ai;
  if (!a || a.stanceRound === S.round) return;
  a.stanceRound = S.round;
  const foe = S.players[1 - pid], w = aiW(pid);
  const mine = fieldMechs(pid), theirs = fieldMechs(1 - pid);
  const nearBase = theirs.filter(e => man(e.x, e.y, p.base.x, p.base.y) <= 4).length;
  const gap = (foe.vp || 0) - (p.vp || 0);
  const myHp = mine.reduce((t, m) => t + hpOf(m) / Math.max(1, maxHpOf(m)), 0) / Math.max(1, mine.length);
  let stance = null;
  if (nearBase && (p.base.hp < (p.base.max || C.BASE_HP) * 0.75 || w.hold + w.caution > 1.2)) stance = 'defend';
  else if (gap <= -C.LEAD_GAP && C.LEAD_GAP) stance = 'press';               // our objectives barely score while we lead: go for the base
  else if (gap >= 3) stance = 'raid';
  else if (theirs.length > mine.length + 1 && myHp < 0.7) stance = 'regroup';
  else if (theirs.some(e => hpOf(e) <= maxHpOf(e) * 0.35) && w.focus + w.aggro > 1.6) stance = 'hunt';
  if (stance !== a.stance) {
    if (stance) log(p.name + ' (' + PERSONAS[a.persona].name + ') ' + STANCES[stance].label + '.', 'p' + pid);
    a.stance = stance;
  }
  // a growing points deficit is a mistake worth correcting for the rest of the war
  if (gap > a.vpGap + 1) aiAdjust(pid, 'objective', 0.2);
  a.vpGap = gap;
}
// where the enemy can hurt us next round: expected damage per tile
function threatMap(pid) {
  const key = S.round + ':' + S.mechs.map(m => m.uid + '@' + m.x + ',' + m.y + (m.activated ? 'a' : '')).join('|');
  if (S._threat && S._threat.pid === pid && S._threat.key === key) return S._threat.t;
  const t = {};
  for (const e of S.mechs) {
    if (e.owner === pid) continue;
    const st = stats(e); let dmg = 0, rng = 0;
    for (const wp of weaponsOf(e)) {
      if (wp.w.repair || wp.inst.hp <= 0) continue;
      dmg = Math.max(dmg, (wp.w.dmg + st.dmgBonus) * (wp.w.shots || 1) * Math.min(95, wp.w.acc) / 100);
      rng = Math.max(rng, effRange(wp.w, st));
    }
    if (!dmg) continue;
    const reach = st.move + rng;
    for (let x = Math.max(0, e.x - reach); x <= Math.min(W - 1, e.x + reach); x++) for (let y = Math.max(0, e.y - reach); y <= Math.min(H - 1, e.y + reach); y++) {
      const d = man(x, y, e.x, e.y);
      if (d < 1 || d > reach) continue;
      t[K(x, y)] = (t[K(x, y)] || 0) + dmg * (d <= rng ? 1.2 : 0.8);
    }
  }
  const b = BASE_POS[1 - pid];
  if (S.players[1 - pid].base.hp > 0) for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (man(x, y, b.x, b.y) <= C.TURRET_RANGE) t[K(x, y)] = (t[K(x, y)] || 0) + C.TURRET_DMG + trait(1 - pid, 'turretDmg');
  S._threat = { pid, key, t };
  return t;
}
// how much taking this objective matters: it scores for us, it stops the enemy scoring, or it only pays supply
function objWorth(o, pid) {
  if (o.type === 'repair') return 0;
  const me = S.players[pid], foe = S.players[1 - pid], lead = (me.vp || 0) - (foe.vp || 0);
  const pts = objVp(o);
  let v = scores(o, pid) ? (C.LEAD_GAP && lead >= C.LEAD_GAP ? 3 : 7) * (pts > 1 ? 1.5 : 1) : 2.5;
  if (o.owner === 1 - pid) v += scores(o, 1 - pid) ? 5 * pts : 1.5;
  return v;
}
// can the side still to act this round bring this enemy down with what it has in range?
function aiKillable(tm, pid) {
  const key = S.round + ':' + tm.uid + ':' + hpOf(tm) + ':' + S.mechs.filter(f => f.owner === pid && !f.activated).length;
  S._kill = S._kill || {};
  if (key in S._kill) return S._kill[key];
  let pot = 0;
  for (const f of S.mechs) {
    if (f.owner !== pid || f.activated) continue;
    const st = stats(f);
    for (const wp of weaponsOf(f)) if (!wp.w.repair && wp.inst.hp > 0 && man(f.x, f.y, tm.x, tm.y) <= effRange(wp.w, st) + st.move) pot += (wp.w.dmg + st.dmgBonus) * (wp.w.shots || 1) * Math.min(95, wp.w.acc) / 100;
  }
  return (S._kill[key] = pot >= hpOf(tm));
}
function withPos(m, x, y, fn) { const ox = m.x, oy = m.y; m.x = x; m.y = y; try { return fn(); } finally { m.x = ox; m.y = oy; } }
function aiWeaponBest(m, wp, st) {
  const w = wp.w;
  if (w.repair || !usable(m, wp.key)) return null;
  if (m.heat + w.heat + st.shotHeat + st.passiveHeat > st.heatCap) return null;
  let best = null;
  const dmgRaw = w.dmg + st.dmgBonus, shots = w.shots || 1;
  for (const t of validTargets(m, wp.key)) {
    const aw = aiW(m.owner);
    if (t.type === 'base') {
      const ev = dmgRaw * (w.siege || 1) * shots * 1.3 * (0.5 + 0.5 * aw.siege);
      if (!best || ev > best.ev) best = { key: wp.key, target: t, part: null, ev };
      continue;
    }
    const tm = fieldMech(t.uid), ts = stats(tm);
    const hull = hpOf(tm);
    for (const part of [null, 'torso', 'core', 'legs', 'armL', 'armR']) {
      let pi = tm.slots.torso;
      if (part) {
        pi = getSlot(tm, part);
        if (!pi || pi.hp <= 0) continue;
        if (part.startsWith('arm') && !DEFS[pi.id].weapon) continue;
      }
      const pc = hitChance(m, wp.key, tm, part) / 100;
      const armor = w.ap ? 0 : (DEFS[pi.id].armor || 0) + ts.armorAll + (tm.braced ? 1 : 0);
      const dmg = Math.max(1, dmgRaw - armor);
      // a finishing shot is worth most; knocking out a core, weapon or legs comes next
      let mult = (part ? 0.9 : 1) * (1 + aw.focus * 0.8 * (1 - hull / Math.max(1, maxHpOf(tm)))) * (aiKillable(tm, m.owner) ? 1.5 : 1);
      if (dmg >= hull) mult = 3 + aw.focus;
      else if (part && dmg >= pi.hp) mult = part === 'core' ? 1.8 : part === 'legs' ? 1.3 : part === 'torso' ? 1.2 : 1.6;
      const ev = pc * dmg * shots * mult + (w.heatDmg ? 0.5 : 0);
      if (!best || ev > best.ev) best = { key: wp.key, target: t, part, ev };
    }
  }
  return best;
}
function aiBestAttack(m) {
  const st = stats(m); let best = null;
  for (const wp of weaponsOf(m)) { const c = aiWeaponBest(m, wp, st); if (c && (!best || c.ev > best.ev)) best = c; }
  return best;
}
function aiAttackValue(m, x, y, n) {
  if (n <= 0) return 0;
  return withPos(m, x, y, () => {
    const st = stats(m);
    const evs = weaponsOf(m).map(wp => { const c = aiWeaponBest(m, wp, st); return c ? c.ev : 0; }).sort((a, b) => b - a);
    return evs.slice(0, n).reduce((a, b) => a + b, 0);
  });
}
function aiMaxRange(m) {
  const st = stats(m);
  const rs = weaponsOf(m).filter(wp => !wp.w.repair && wp.inst.hp > 0 && (wp.inst.ammo == null || wp.inst.ammo > 0)).map(wp => effRange(wp.w, st));
  return rs.length ? Math.max(...rs) : 1;
}
function aiGoal(m) {
  const dm = distMap([[m.x, m.y]]);
  const dTo = (x, y) => {
    if (K(x, y) in dm) return dm[K(x, y)];
    let b = 99;
    for (const [dx, dy] of DIRS) { const k = K(x + dx, y + dy); if (k in dm) b = Math.min(b, dm[k] + 1); }
    return b;
  };
  const cands = [], rng = aiMaxRange(m), armed = hasWeapon(m), aw = aiW(m.owner), defending = S.players[m.owner].ai && S.players[m.owner].ai.stance === 'defend';
  const own = S.players[m.owner].base;
  const siege = weaponsOf(m).some(wp => wp.w.siege && wp.inst.hp > 0);
  for (const o of S.objectives) {
    const d = dTo(o.x, o.y);
    if (o.type === 'repair') { if (isDamaged(m)) cands.push({ x: o.x, y: o.y, cost: (d * 0.9 + 2) / (1 + aw.caution * 0.3), pref: 0 }); continue; }
    // guarding a held objective that the enemy is closing on
    if (o.owner === m.owner) { if (aw.hold > 0.2 && S.mechs.some(e => e.owner !== m.owner && man(e.x, e.y, o.x, o.y) <= 3)) cands.push({ x: o.x, y: o.y, cost: d * 1.1 / aw.hold + 1, pref: 0 }); continue; }
    const occ = mechAt(o.x, o.y);
    if (occ && occ !== m) continue;
    if (S.mechs.some(f => f !== m && f.owner === m.owner && man(f.x, f.y, o.x, o.y) < man(m.x, m.y, o.x, o.y))) continue;
    cands.push({ x: o.x, y: o.y, cost: d / (0.5 + 0.5 * aw.objective) * 7 / Math.max(2, objWorth(o, m.owner)), pref: 0 });
  }
  const crateW = rule('crateVp', 0) ? 0.35 : 0.6;
  for (const c of S.crates || []) {
    if (rule('crateVp', 0) && S.mechs.some(f => f !== m && f.owner === m.owner && man(f.x, f.y, c.x, c.y) < man(m.x, m.y, c.x, c.y))) continue;
    cands.push({ x: c.x, y: c.y, cost: dTo(c.x, c.y) * crateW / (0.5 + 0.5 * aw.objective), pref: 0 });
  }
  for (const w of S.wrecks) cands.push({ x: w.x, y: w.y, cost: dTo(w.x, w.y) * 0.9, pref: 0 });
  if (armed) {
    for (const e of S.mechs) if (e.owner !== m.owner) {
      // wounded prey draws hunters; intruders near home draw defenders
      const prey = 1 + aw.focus * 0.5 * (1 - hpOf(e) / Math.max(1, maxHpOf(e)));
      const intruder = defending && man(e.x, e.y, own.x, own.y) <= 4 ? 2 : 1;
      cands.push({ x: e.x, y: e.y, cost: (dTo(e.x, e.y) * 1.1 - 1) / ((0.5 + aw.aggro) * prey * intruder), pref: rng });
    }
    const b = BASE_POS[1 - m.owner];
    if (!defending) cands.push({ x: b.x, y: b.y, cost: dTo(b.x, b.y) * (siege ? 0.6 : Math.max(0.6, 1.3 - S.round * 0.035)) / (0.5 + 0.5 * aw.siege), pref: rng });
  }
  if (defending) cands.push({ x: own.x, y: own.y, cost: dTo(own.x, own.y) * 0.8, pref: 2 });
  cands.sort((a, b) => a.cost - b.cost);
  return cands[0] || null;
}
function aiBestTile(m) {
  const r = reachable(m), goal = aiGoal(m);
  const dm = goal ? distMap([[goal.x, goal.y]]) : null;
  const aw = aiW(m.owner), threat = aw.caution > 0 ? threatMap(m.owner) : null;
  const hpFrac = hpOf(m) / Math.max(1, maxHpOf(m));
  const allies = S.mechs.filter(f => f.owner === m.owner && f !== m);
  let best = null;
  for (const k in r) {
    const [x, y] = k.split(',').map(Number), stay = x === m.x && y === m.y;
    let v = 10 * (0.5 + aw.aggro) * aiAttackValue(m, x, y, stay ? m.ap : m.ap - 1);
    const o = objAt(x, y);
    if (o && o.type !== 'repair' && o.owner !== m.owner) v += (1 + objWorth(o, m.owner)) * aw.objective;
    // look ahead: how much the enemy could pour into this tile next round, weighed by how much we can take
    if (threat) v -= aw.caution * 0.45 * (threat[k] || 0) * (1.6 - hpFrac);
    // formation: hunters and wardens stay in support range, raiders spread across the map
    if (aw.cohesion > 0.05 || aw.cohesion < 0.3) { const near = allies.filter(f => man(f.x, f.y, x, y) <= 2).length; v += aw.cohesion * Math.min(2, near) * 1.2 - (aw.cohesion < 0.3 ? (0.3 - aw.cohesion) * 3 * allies.filter(f => man(f.x, f.y, x, y) <= 1).length : 0); }
    if (o && o.type === 'repair' && isDamaged(m)) v += 4;
    if (wreckAt(x, y)) v += 3;
    if (crateAt(x, y)) v += 8 + 6 * rule('crateVp', 0) * aw.objective;
    if (terrain(x, y) === 'ruins') v += 1.5;
    if (dm) v -= (k in dm) ? Math.max(0, dm[k] - goal.pref) : 99;
    if (stay) v += 0.01;
    if (!best || v > best.v) best = { x, y, v };
  }
  return best;
}
function aiWantsRetreat(m) {
  const p = S.players[m.owner];
  if (hangarFull(p)) return false;
  // late in a long war, damaged mecha press on instead of cycling back to the hangar
  const aw = aiW(m.owner);
  if (hpOf(m) <= maxHpOf(m) * (S.round > 20 ? 0.2 : clamp(0.35 + 0.08 * aw.caution - 0.1 * (aw.aggro - 0.5), 0.15, 0.6))) return true;
  if (m.slots.core && m.slots.core.hp <= 0) return true;
  return !hasWeapon(m);
}
function aiCombatStep() {
  const pid = S.current, p = S.players[pid];
  let m = S.active != null ? fieldMech(S.active) : null;
  if (!m) {
    const list = activatable(pid);
    if (!list.length) return false;
    aiStance(pid);
    const aw = aiW(pid), th = aw.caution > 0 ? threatMap(pid) : {};
    // shoot first with whoever can kill; the cautious move endangered mecha out early
    m = list.map(x => ({ x, v: aiAttackValue(x, x.x, x.y, 1) + aw.caution * 0.15 * (th[K(x.x, x.y)] || 0) * (1 - hpOf(x) / Math.max(1, maxHpOf(x))) })).sort((a, b) => b.v - a.v)[0].x;
  }
  if (m.ap <= 0) { endActivation(m); return true; }
  if (!hasWeapon(m) && coreBlast(m)) {
    const near = S.mechs.filter(e => e.owner !== m.owner && man(e.x, e.y, m.x, m.y) <= 1).length;
    const eb = BASE_POS[1 - m.owner];
    if ((near || man(eb.x, eb.y, m.x, m.y) <= 1) && selfDestruct(m).ok) return true;
  }
  if (aiWantsRetreat(m)) {
    if (m.entrenched && unentrench(m).ok) return true;
    if (inDeployZone(m)) { enterBase(m); return true; }
    const dm = distMap(deployTiles(pid)), r = reachable(m);
    let best = null;
    for (const k in r) if (k in dm && (!best || dm[k] < best.d)) best = { k, d: dm[k] };
    if (best && best.d < (dm[K(m.x, m.y)] ?? 99)) {
      const [x, y] = best.k.split(',').map(Number);
      if (move(m, x, y).ok) return true;
    }
  }
  if (canEntrench(m)) {
    if (m.entrenched) {
      const atk = aiBestAttack(m);
      if (atk && fire(m, atk.key, atk.target, atk.part).ok) { m.idle = 0; return true; }
      // hold the position a while before giving it up: targets tend to walk into range
      m.idle = (m.idle || 0) + 1;
      if (m.idle >= 3 && aiEntrenchValue(m, m.x, m.y) <= 0 && unentrench(m).ok) { m.idle = 0; return true; }
      endActivation(m);
      return true;
    }
    if (aiEntrenchValue(m, m.x, m.y) > 0 && entrench(m).ok) return true;
    if (m.moves === 0) {
      const r = reachable(m);
      let best = null;
      for (const k in r) { const [x, y] = k.split(',').map(Number); const v = aiEntrenchValue(m, x, y); if (v > 0 && (!best || v > best.v)) best = { x, y, v }; }
      if (best && (best.x !== m.x || best.y !== m.y) && move(m, best.x, best.y).ok) return true;
    }
  }
  if (m.moves === 0) {
    const b = aiBestTile(m);
    if (b && (b.x !== m.x || b.y !== m.y)) { if (move(m, b.x, b.y).ok) return true; }
  }
  const atk = aiBestAttack(m);
  if (canRam(m)) {
    const rt = ramTargets(m).map(e => { const nx = 2 * e.x - m.x, ny = 2 * e.y - m.y, blocked = !passable(nx, ny) || mechAt(nx, ny); return { e, v: RAM_DMG + (blocked ? CRASH_DMG : 0) + (hpOf(e) <= RAM_DMG ? 4 : 0) }; }).sort((a, b) => b.v - a.v)[0];
    if (rt && (!atk || rt.v >= atk.ev) && ram(m, rt.e.uid).ok) return true;
  }
  if (atk && fire(m, atk.key, atk.target, atk.part).ok) return true;
  if (wreckAt(m.x, m.y) && salvage(m).ok) return true;
  if (m.moves === 1) {
    const o = objAt(m.x, m.y), holding = o && o.type !== 'repair' && o.owner !== m.owner;
    if (!holding) {
      const b = aiBestTile(m);
      if (b && (b.x !== m.x || b.y !== m.y) && b.v > 0.5 + aiTileValueHere(m)) { if (move(m, b.x, b.y).ok) return true; }
    }
  }
  if (!m.overwatch && aiWantsOverwatch(m) && overwatch(m).ok) return true;
  if (!m.braced && !m.overwatch && brace(m).ok) return true;
  endActivation(m);
  return true;
}
function aiEntrenchValue(m, x, y) {
  const was = m.entrenched;
  m.entrenched = true;
  try { return aiAttackValue(m, x, y, 1); } finally { m.entrenched = was; }
}
// cover the ground when an enemy that has yet to act could walk into range
function aiWantsOverwatch(m) {
  const st = stats(m);
  const rng = Math.max(0, ...weaponsOf(m).filter(wp => owReady(m, wp.key)).map(wp => effRange(wp.w, st)));
  if (!rng) return false;
  const aw = aiW(m.owner);
  if (aw.overwatch < 0.3 && aiBestAttack(m)) return false;
  return S.mechs.some(e => e.owner !== m.owner && !e.activated && man(e.x, e.y, m.x, m.y) <= rng + stats(e).move + (aw.overwatch > 0.8 ? 1 : 0));
}
function aiTileValueHere(m) {
  const goal = aiGoal(m);
  if (!goal) return 0;
  const dm = distMap([[goal.x, goal.y]]), k = K(m.x, m.y);
  let v = (k in dm) ? -Math.max(0, dm[k] - goal.pref) : -99;
  if (terrain(m.x, m.y) === 'ruins') v += 1.5;
  return v;
}

function aiDesign(p, m) {
  const pool = { torso: [], core: [], legs: [], arm: [], aux: [] };
  for (const c of p.workshop) { const d = DEFS[c.id]; if (pool[d.slot] && c.hp > 0 && !(d.weapon && d.weapon.repair)) pool[d.slot].push(c); }
  const fixed = {};
  for (const { key, inst } of partsOf(m)) fixed[key] = inst;
  const iss = t => issuedTo(p).filter(id => DEFS[id].slot === t);
  const BAS = { torso: ['b_torso'].concat(iss('torso')), legs: ['b_legs'].concat(iss('legs')), arm: ['b_gun'].concat(iss('arm')) };
  let best = null;
  for (let t = 0; t < 300; t++) {
    const used = new Set(), pick = {};
    const tmp = { slots: { torso: null, core: null, legs: null, armL: null, armR: null, aux: [] }, heat: 0 };
    let cost = 0;
    const choose = (type, allowNone, ok) => {
      const opts = pool[type].filter(c => !used.has(c.uid) && (!ok || ok(DEFS[c.id])));
      const bas = (BAS[type] || []).filter(id => !ok || ok(DEFS[id]));
      let i = Math.floor(rnd() * (opts.length + bas.length + (allowNone ? 1 : 0)));
      if (i < opts.length) { used.add(opts[i].uid); cost += opts[i].paid ? 0 : DEFS[opts[i].id].cost; return { inst: opts[i], src: { uid: opts[i].uid } }; }
      i -= opts.length;
      if (i < bas.length) { const id = bas[i]; cost += DEFS[id].cost; return { inst: { id, hp: DEFS[id].hp }, src: { basic: id } }; }
      return null;
    };
    for (const key of ['torso', 'legs', 'armL', 'armR']) {
      if (fixed[key]) { tmp.slots[key] = fixed[key]; continue; }
      const c = choose(slotType(key), key.startsWith('arm'), key.startsWith('arm') ? d => fitsMount(armMount(tmp, key), d) : null);
      if (c) { tmp.slots[key] = c.inst; pick[key] = c.src; }
      if (key === 'torso' && tmp.slots.torso) tmp.slots.core = fixed.core && !pick.torso ? fixed.core : { id: 'r_' + tmp.slots.torso.id, hp: DEFS['r_' + tmp.slots.torso.id].hp };
    }
    if (!tmp.slots.torso) continue;
    if (!tmp.slots.core) tmp.slots.core = fixed.core || { id: 'r_' + tmp.slots.torso.id, hp: DEFS['r_' + tmp.slots.torso.id].hp };
    const nAux = DEFS[tmp.slots.torso.id].auxSlots || 0;
    for (let i = 0; i < nAux; i++) {
      const key = 'aux' + i;
      if (fixed[key]) { tmp.slots.aux[i] = fixed[key]; continue; }
      const c = choose('aux', true);
      tmp.slots.aux[i] = c ? c.inst : null;
      if (c) pick[key] = c.src;
    }
    const st = stats(tmp);
    if (st.size > st.carry || st.used > st.cap) continue;
    if (cost > p.supply + 6) continue;
    let fp = 0, heat = st.passiveHeat + st.moveHeat;
    for (const wp of weaponsOf(tmp)) {
      const w = wp.w;
      if (w.repair) continue;
      if (w.needsEntrench && !DEFS[tmp.slots.legs.id].entrench) continue;
      fp += (w.dmg + st.dmgBonus) * (w.shots || 1) * Math.min(95, w.acc) / 100 * (1 + effRange(w, st) / 8) + (w.ap ? 1 : 0) + (w.siege ? 1 : 0) + (w.heatDmg ? 0.5 : 0);
      heat += w.heat + st.shotHeat;
      fp += (w.burn ? 1.5 : 0) + (w.slow ? 0.8 : 0) + (w.shock ? 1 : 0);
    }
    const td = DEFS[tmp.slots.torso.id];
    const aw = aiW(p.id);
    let score = fp ? 4 * (0.75 + 0.5 * aw.aggro) * fp : -50;
    score += (1 + 0.3 * aw.caution) * (0.5 * (td.hp + ((td.armor || 0) + st.armorAll) * 4 + st.shield * 2) + 0.2 * (DEFS[tmp.slots.legs.id].hp + DEFS[tmp.slots.core.id].hp));
    score += 1.5 * st.move * (0.6 + 0.4 * aw.objective + 0.2 * aw.aggro) + st.selfRepair * 2 + st.heatCap * 0.2 + st.plate * 1.5;
    score += (aw.tech - 0.5) * 3 * [tmp.slots.torso, tmp.slots.core, tmp.slots.legs, tmp.slots.armL, tmp.slots.armR].concat(tmp.slots.aux).filter(i => i && DEFS[i.id].special).length;
    score -= 2.5 * Math.max(0, heat - st.cooling) + (0.35 + 0.4 * (aw.swarm - 0.5)) * cost;
    const ws = weaponsOf(tmp), mode = DEFS[tmp.slots.legs.id].mode;
    const heavyW = ws.filter(wp => mountOf(wp.def) === 'heavy').length, meleeW = ws.filter(wp => wp.w.melee).length;
    score += (st.evasive || 0) * 0.25 + (st.meleeBonus || 0) * meleeW * 3 + (st.bulwark || 0) * 2;
    score += mode === 'jump' ? 2 + aw.objective : mode === 'ram' ? 1.5 + aw.aggro * 2 : mode === 'stable' ? 1 + heavyW * 3 : mode === 'hover' ? 1.5 : mode === 'surefoot' ? 1 : 0;
    // anchored mecha only earn their keep with long guns, since they fire from one spot
    if (DEFS[tmp.slots.legs.id].entrench) { const longest = Math.max(0, ...weaponsOf(tmp).map(wp => wp.w.range || 0)); score -= weaponsOf(tmp).some(wp => wp.w.needsEntrench) ? 0 : longest >= 5 ? 12 : 30; }
    if (!best || score > best.score) best = { score, pick };
  }
  return best && best.pick;
}
function aiOutfit(p, m) {
  const pick = aiDesign(p, m);
  if (!pick) return;
  for (const key of ['torso', 'legs', 'armR', 'armL', 'aux0', 'aux1', 'aux2']) {
    if (!pick[key] || getSlot(m, key)) continue;
    if (!install(p, m, key, pick[key]).ok) break;
  }
}
function aiBuild(p) {
  // flush with supply and short on cards: buy one, then come back to building after the draw
  if (C.REQ_COST && p.supply >= C.REQ_COST + 14 && p.workshop.length <= C.WORKSHOP_MAX - 3 && !canRequisition(p)) { requisition(p); return; }
  for (const c of p.workshop.slice()) if (DEFS[c.id].slot === 'tactic') playTactic(p, c.uid);
  for (const m of p.hangar) for (const { key, inst } of partsOf(m)) {
    if (inst.hp <= 0) { if (key === 'core') repair(p, m, key); else removePart(p, m, key); }
    else if (worn(inst)) repair(p, m, key);
  }
  for (const m of p.hangar) if (!isBlank(m)) aiOutfit(p, m);
  const built = p.hangar.filter(m => !isBlank(m));
  const total = built.length + fieldMechs(p.id).length;
  const allReady = built.every(m => !issues(m).length && hasWeapon(m));
  ensureBlank(p);
  const spare = p.hangar.find(isBlank);
  if (spare && allReady && total < fieldMax(p.id) + (p.supply >= 15 ? 3 : 1) + Math.round(2 * (aiW(p.id).swarm - 0.5)) && p.ep >= 2 && p.supply >= 5) aiOutfit(p, spare);
  while (p.workshop.length > C.WORKSHOP_MAX - 2) {
    const count = {};
    p.workshop.forEach(c => { const s = DEFS[c.id].slot; count[s] = (count[s] || 0) + 1; });
    const worst = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    const pile = p.workshop.filter(c => DEFS[c.id].slot === worst).sort((a, b) => DEFS[a.id].cost - DEFS[b.id].cost);
    scrapCard(p, pile[0].uid);
  }
}
function aiDeploy(p) {
  for (const m of p.hangar.slice()) {
    if (fieldMechs(p.id).length >= fieldMax(p.id)) break;
    if (issues(m).length || !hasWeapon(m)) continue;
    if (hpOf(m) < maxHpOf(m) * (0.5 + 0.15 * aiW(p.id).caution - 0.15 * (aiW(p.id).aggro - 0.5))) continue;
    const free = deployTiles(p.id).filter(([x, y]) => !mechAt(x, y));
    if (!free.length) break;
    const t = free[Math.floor(rnd() * free.length)];
    deploy(p, m, t[0], t[1]);
  }
}
function aiStep() {
  if (!S || S.phase === 'over') return false;
  if (S.phase === 'build') {
    const ai = S.players.find(x => x.isAI && x.stage !== 'done');
    if (!ai) return false;
    if (ai.stage === 'draw') acceptDraw(ai); else { aiBuild(ai); if (ai.stage === 'build') endBuild(ai); }
    return true;
  }
  const p = S.players[S.current];
  if (S.phase === 'deploy') { aiDeploy(p); endDeploy(); return true; }
  if (S.phase === 'combat') { const r = aiCombatStep(); if (!r) advanceTurn(); return true; }
  return false;
}

const api = {
  PERSONAS, aiW,
  getAIMemory() { return AIMEM; },
  setAIMemory(m) { AIMEM = m && m.v === 1 && m.personas ? m : { v: 1, personas: {} }; },
  get W() { return W; }, get H() { return H; }, C, DEFS, DOCTRINES, REQUIRED,
  get S() { return S; },
  load(s) { S = s; if (S) setMap(S.map || 'open'); return S; },
  setMap, MAPS, MAP_IDS, get MAP() { return MAP; }, rule, objVp, START_CHASSIS,
  setRng(f) { rnd = f; },
  newGame, concede, terrain, baseAt, turretTiles, coord, mechAt, wreckAt, objAt, fieldMech, fieldMechs, deployTiles, inDeployZone,
  getSlot, partsOf, auxCount, hpOf, maxHpOf, hullOf, worn, scores, reachZone, sellValue, stats, issues, weaponsOf, usable, hasWeapon, role, slotName, slotType, effRange,
  acceptDraw, canRequisition, requisition, finishBuildPhase, install, installCost, removePart, repair, repairCost, newMech, isBlank, standardFor, SIZE_NAME, sizeOf, carryOf, capOf, pipsUsed, CHASSIS, MOUNT_NAME, mountOf, armMount, fitsMount, locoMode, canRam, ramTargets, ram, trait, fieldMax, hangarMax, plateMax, incomeOf, catchupOf, dismantle, scrapCard, playTactic, endBuild,
  canDeploy, deploy, endDeploy,
  activatable, actGuard, coreBlast, selfDestruct, fieldStrip, overwatch, overwatchCover, crateAt, canEntrench, weaponLock, entrench, unentrench, reachable, validTargets, rangeTiles, hitChance, move, fire, brace, salvage, enterBase, endActivation, passAll,
  radarBonus, isDamaged, aiStep,
  clearFx() { if (S) S.fx = []; }
};
root.MW = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
