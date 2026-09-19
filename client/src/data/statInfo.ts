/**
 * What each attribute does in THIS engine (authored from the server's own combat/level math, not
 * copied from any source): STR -> hitroll+damroll, INT -> mana, WIS -> practices, DEX -> move,
 * CON -> hp, CHA -> shop haggle, LCK -> lucky hits/dodges. Surfaced as hover tooltips.
 */
export const STAT_INFO: Record<string, { name: string; body: string }> = {
  str: { name: "Strength", body: "Melee muscle. Raises your hitroll (chance to connect) and damroll (damage per hit)." },
  int: { name: "Intelligence", body: "Mind. Sets the size of your mana pool and how much mana you recover each level (caster classes)." },
  wis: { name: "Wisdom", body: "Insight. Grants extra practice sessions each time you level, so you learn more skills and spells." },
  dex: { name: "Dexterity", body: "Agility. Increases your movement pool and how much move you gain per level." },
  con: { name: "Constitution", body: "Toughness. Raises your maximum hit points and how much HP you gain each level." },
  cha: { name: "Charisma", body: "Presence. Your haggle lever in shops — higher charisma lowers what you pay and shapes what you're offered." },
  lck: { name: "Luck", body: "Fortune. A lucky attacker connects more often and lands more lucky (bonus-damage) hits; a lucky defender is harder to strike." },
  align: { name: "Alignment", body: "Your place on the good–evil axis (−1000 evil … +1000 good). Some races start good or evil, and it shifts with your deeds." },
};
