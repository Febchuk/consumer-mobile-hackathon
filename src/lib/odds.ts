export function payoutFor(pools: number[], option: number, stake: number, mult = 1) {
  const total = pools.reduce((a, b) => a + b, 0) + stake;
  const side = pools[option] + stake;
  if (side === 0) return 0;
  return Math.floor(((total * stake) / side) * mult);
}

export function multiplier(streak: number) {
  return Math.min(2, 1 + 0.1 * Math.max(0, streak - 1));
}
